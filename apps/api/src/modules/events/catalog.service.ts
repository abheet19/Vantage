/**
 * catalog.service.ts — the event catalog for one project (LLD §3.4 `GET /v1/events/catalog`), read as the reader.
 *
 * Why it exists: the ask path needs to tell the model what the project's events are called and what
 * their properties look like, and it must do so without a single row or value (design §4.1: property
 * values are attacker-controlled). One statement does it: names with counts and first/last occurrence
 * over the `events_funnel` index (an index-only GROUP BY), then for each name the newest `sampleRows`
 * events' property keys with the JSON types seen and a distinct-value count over that sample — a count,
 * never a value. The caps are the contract's (`CATALOG_LIMITS`) and arrive as parameters. Every read here
 * goes through `QueryRunner.readOnly` (S3 hardening): `BEGIN READ ONLY`, the 5 s `SET LOCAL` bound and
 * the pool's admission rule, exactly like a compiled statement — the catalog used to run autocommit,
 * bounded only by a role default the reader can raise. The project's timezone is read in the same
 * transaction, and `timezoneIn` is the ONE timezone lookup every reader shares (`InsightsService` calls it
 * too); an unknown project yields an empty catalog in UTC — never an error that confirms or denies the id
 * exists (LLD §7.1, no enumeration). Over HTTP a read the bound stopped is 503 `TIMED_OUT`; on the ask path
 * the service maps the same pg error to a decision. The same statement serves the MCP
 * `list_events`/`describe_event` tools (S4).
 *
 * What it must never do: return a property value, an example or a row; accept a project from anywhere
 * but the caller; or build SQL from anything but the literal below and its parameters.
 */
import { Inject, Injectable } from '@nestjs/common';
import { CATALOG_LIMITS, type CatalogEvent, type CatalogProperty, type EventCatalog } from '@vantage/contracts';
import { asHttpReadFault, QueryRunner, type ReadQuery } from '../../infra/query-runner.js';

interface CatalogDbRow {
  event: string;
  count: number;
  first_seen: Date;
  last_seen: Date;
  properties: CatalogProperty[];
}

/** $1 project · $2 max event names · $3 sample rows per event · $4 max keys per event. */
const CATALOG = `WITH names AS (
  SELECT ev.event, count(*)::int AS count, min(ev.event_ts) AS first_seen, max(ev.event_ts) AS last_seen
    FROM events ev
   WHERE ev.project_id = $1
   GROUP BY ev.event
   ORDER BY count DESC, ev.event
   LIMIT $2
),
sample AS (
  SELECT n.event, s.properties
    FROM names n
    JOIN LATERAL (
      SELECT ev.properties FROM events ev
       WHERE ev.project_id = $1 AND ev.event = n.event
       ORDER BY ev.event_ts DESC
       LIMIT $3
    ) s ON true
),
keys AS (
  SELECT sample.event, kv.key,
         array_agg(DISTINCT jsonb_typeof(kv.value) ORDER BY jsonb_typeof(kv.value)) AS types,
         count(*)::int AS occurrences,
         count(DISTINCT kv.value)::int AS cardinality_sample
    FROM sample, jsonb_each(sample.properties) AS kv
   GROUP BY sample.event, kv.key
)
SELECT n.event, n.count, n.first_seen, n.last_seen,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object('key', k.key, 'types', k.types, 'cardinality_sample', k.cardinality_sample) ORDER BY k.occurrences DESC, k.key)
           FROM (SELECT * FROM keys k WHERE k.event = n.event ORDER BY k.occurrences DESC, k.key LIMIT $4) k
       ), '[]'::jsonb) AS properties
  FROM names n
 ORDER BY n.count DESC, n.event`;

const TIMEZONE = 'SELECT timezone FROM projects WHERE project_id = $1';

/** The project's timezone, or UTC for a project the reader cannot see (no enumeration), read inside the caller's READ ONLY transaction. */
export async function timezoneIn(query: ReadQuery, projectId: string): Promise<string> {
  const r = await query<{ timezone: string }>(TIMEZONE, [projectId]);
  return r.rows[0]?.timezone ?? 'UTC';
}

@Injectable()
export class CatalogService {
  constructor(@Inject(QueryRunner) private readonly runner: QueryRunner) {}

  /** The project's timezone in a bounded transaction of its own; `catalog` reads it alongside the names, so the ask path calls neither twice. */
  async timezoneOf(projectId: string): Promise<string> {
    return this.runner.readOnly((query) => timezoneIn(query, projectId));
  }

  /** Timezone and catalog from one snapshot; a read the 5 s bound stopped is 503 `TIMED_OUT`, a saturated pool 503 `BUSY`, anything else the fault it is. */
  async catalog(projectId: string): Promise<EventCatalog> {
    try {
      return await this.runner.readOnly(async (query) => {
        const timezone = await timezoneIn(query, projectId);
        const rows = await query<CatalogDbRow>(CATALOG, [projectId, CATALOG_LIMITS.events, CATALOG_LIMITS.sampleRows, CATALOG_LIMITS.keysPerEvent]);
        const events: CatalogEvent[] = rows.rows.map((r) => ({
          event: r.event,
          count: r.count,
          first_seen: r.first_seen.toISOString(),
          last_seen: r.last_seen.toISOString(),
          properties: r.properties,
        }));
        return { project: projectId, timezone, events };
      });
    } catch (err) {
      asHttpReadFault(err);
    }
  }
}
