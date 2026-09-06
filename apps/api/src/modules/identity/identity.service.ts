/**
 * identity.service.ts — persons, distinct ids, and the merge (design §1.2, LLD §1.1 IdentityModule).
 *
 * Why it exists: a `distinct_id` maps to exactly one person at any time, events are never rewritten,
 * and `identify` either renames (unknown side joins the known person) or merges (repoint the smaller
 * person's ids into the larger, point the merged person at its survivor, record the moved ids in
 * `person_merges`). The three writes of a merge happen in ONE transaction, so a crash between them cannot
 * leave a repoint without its audit row (LLD §7.1 interrupted path). Identity writes for a project run
 * under a transaction-scoped advisory lock keyed by the project: it serialises the create-or-get race
 * (two batches introducing the same new id would otherwise create two persons and orphan one, and
 * vantage_app has no DELETE to clean up) and makes reciprocal `identify(a,b)` / `identify(b,a)` calls
 * converge on one merge with no deadlock. Batches whose ids are all known take no lock at all.
 *
 * What it must never do: touch `events` (identity is resolved at query time by joining
 * person_distinct_ids), run outside the caller's transaction when given a client, or decide the merge
 * direction itself — that is `planMerge`'s job so it can be tested without a database.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { IdentifyResponse } from '@vantage/contracts';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { planMerge } from '../../domain/index.js';
import { PG_RW } from '../../infra/tokens.js';
import { inTransaction } from '../../infra/transaction.js';

/** Any transaction that writes person rows for a project takes this first. `hashtextextended` gives a stable 64-bit key from the project id. */
const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`;

interface PdiRow {
  distinct_id: string;
  person_id: string;
}

@Injectable()
export class IdentityService {
  constructor(@Inject(PG_RW) private readonly rw: pg.Pool) {}

  /**
   * Create-or-get inside the caller's open transaction: every distinct id in `distinctIds` has a person when
   * this returns. Ids already known cost one SELECT; only genuinely new ids take the project lock and write.
   */
  async ensurePersons(client: pg.ClientBase, projectId: string, distinctIds: readonly string[]): Promise<{ created: number }> {
    const unique = [...new Set(distinctIds)];
    if (unique.length === 0) return { created: 0 };
    const missing = await this.missingIds(client, projectId, unique);
    if (missing.length === 0) return { created: 0 };

    await client.query(LOCK_SQL, [projectId]);
    const stillMissing = await this.missingIds(client, projectId, unique);
    if (stillMissing.length === 0) return { created: 0 };

    const personIds = stillMissing.map(() => randomUUID());
    await client.query(`INSERT INTO persons (project_id, person_id) SELECT $1, unnest($2::uuid[])`, [projectId, personIds]);
    await client.query(
      `INSERT INTO person_distinct_ids (project_id, distinct_id, person_id)
       SELECT $1, d, p FROM unnest($2::text[], $3::uuid[]) AS t(d, p)`,
      [projectId, stillMissing, personIds],
    );
    return { created: stillMissing.length };
  }

  /** Design §1.2: rename when one side is unknown, merge when both are known and differ, no-op when they already agree. */
  identify(projectId: string, anonymousId: string, userId: string): Promise<IdentifyResponse> {
    return inTransaction(this.rw, async (client) => {
      await client.query(LOCK_SQL, [projectId]);
      return this.identifyLocked(client, projectId, anonymousId, userId);
    });
  }

  private async identifyLocked(client: pg.ClientBase, projectId: string, anonymousId: string, userId: string): Promise<IdentifyResponse> {
    const known = await client.query<PdiRow>(`SELECT distinct_id, person_id FROM person_distinct_ids WHERE project_id = $1 AND distinct_id = ANY($2::text[])`, [
      projectId,
      [anonymousId, userId],
    ]);
    const anon = known.rows.find((r) => r.distinct_id === anonymousId);
    const user = known.rows.find((r) => r.distinct_id === userId);

    if (anonymousId === userId) {
      const person = anon?.person_id ?? (await this.createPerson(client, projectId, [anonymousId]));
      return { person_id: person, merged: false, distinct_ids_moved: 0 };
    }
    if (!anon && !user) {
      const person = await this.createPerson(client, projectId, [anonymousId, userId]);
      return { person_id: person, merged: false, distinct_ids_moved: 0 };
    }
    if (anon && !user) {
      await this.attach(client, projectId, userId, anon.person_id);
      return { person_id: anon.person_id, merged: false, distinct_ids_moved: 0 };
    }
    if (!anon && user) {
      await this.attach(client, projectId, anonymousId, user.person_id);
      return { person_id: user.person_id, merged: false, distinct_ids_moved: 0 };
    }
    if (anon && user && anon.person_id === user.person_id) {
      return { person_id: anon.person_id, merged: false, distinct_ids_moved: 0 };
    }
    return this.merge(client, projectId, anon as PdiRow, user as PdiRow, `identify(${anonymousId.length} chars, ${userId.length} chars)`);
  }

  /** Repoint the smaller person's ids, mark the merged person, record exactly which ids moved. */
  private async merge(client: pg.ClientBase, projectId: string, a: PdiRow, b: PdiRow, reason: string): Promise<IdentifyResponse> {
    const counts = await client.query<{ person_id: string; n: string }>(
      `SELECT person_id, count(*)::text AS n FROM person_distinct_ids WHERE project_id = $1 AND person_id = ANY($2::uuid[]) GROUP BY person_id`,
      [projectId, [a.person_id, b.person_id]],
    );
    const countOf = (p: string) => Number(counts.rows.find((r) => r.person_id === p)?.n ?? 0);
    const plan = planMerge({ person: a.person_id, count: countOf(a.person_id) }, { person: b.person_id, count: countOf(b.person_id) });

    const moved = await client.query<{ distinct_id: string }>(
      `UPDATE person_distinct_ids SET person_id = $3 WHERE project_id = $1 AND person_id = $2 RETURNING distinct_id`,
      [projectId, plan.from, plan.into],
    );
    const movedIds = moved.rows.map((r) => r.distinct_id);
    await client.query(`UPDATE persons SET merged_into = $3 WHERE project_id = $1 AND person_id = $2`, [projectId, plan.from, plan.into]);
    await client.query(
      `INSERT INTO person_merges (project_id, from_person, into_person, distinct_ids_moved, reason) VALUES ($1, $2, $3, $4::text[], $5)`,
      [projectId, plan.from, plan.into, movedIds, reason],
    );
    return { person_id: plan.into, merged: true, distinct_ids_moved: movedIds.length };
  }

  private async createPerson(client: pg.ClientBase, projectId: string, distinctIds: string[]): Promise<string> {
    const personId = randomUUID();
    await client.query(`INSERT INTO persons (project_id, person_id) VALUES ($1, $2)`, [projectId, personId]);
    await client.query(`INSERT INTO person_distinct_ids (project_id, distinct_id, person_id) SELECT $1, unnest($2::text[]), $3`, [projectId, distinctIds, personId]);
    return personId;
  }

  private async attach(client: pg.ClientBase, projectId: string, distinctId: string, personId: string): Promise<void> {
    await client.query(`INSERT INTO person_distinct_ids (project_id, distinct_id, person_id) VALUES ($1, $2, $3)`, [projectId, distinctId, personId]);
  }

  private async missingIds(client: pg.ClientBase, projectId: string, ids: string[]): Promise<string[]> {
    const r = await client.query<{ d: string }>(
      `SELECT d FROM unnest($2::text[]) AS t(d)
       WHERE NOT EXISTS (SELECT 1 FROM person_distinct_ids p WHERE p.project_id = $1 AND p.distinct_id = t.d)`,
      [projectId, ids],
    );
    return r.rows.map((x) => x.d);
  }
}
