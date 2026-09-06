/**
 * projects.service.ts — creates and lists projects; the only code that ever holds a plaintext API key.
 *
 * Why it exists: a project is a timezone, an event namespace and an ingest credential. The key is
 * minted here from 24 random bytes, returned once, and only its sha256 is stored; `findByApiKey` is the
 * lookup the ingest guard runs on every request. The timezone is checked against BOTH authorities that
 * will later use it — `pg_timezone_names`, because the SQL buckets with `AT TIME ZONE`, and
 * `Intl.DateTimeFormat`, because the ask path spells "today" in the project's zone and the web will
 * render local dates — so an invalid zone is a typed 422 at creation, not a wrong bucket or a 500 at
 * query time (LLD §7.1 `domain/bucketOf` denied path). The two lists differ (S3 hardening): PostgreSQL
 * knows `Factory`, `posixrules`, `localtime` and `leapseconds`, which `Intl` rejects, and a project with
 * one of those made every ask a 500 with no audit row.
 *
 * What it must never do: log or persist the plaintext key, or return `api_key_hash` to any caller —
 * the row types below carry no hash field on purpose.
 */
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { CreateProjectBody, ProjectCreated, ProjectRow, RotateKeyResponse } from '@vantage/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { API_KEY_PREFIX, hashApiKey } from '../../domain/index.js';
import { PG_RW } from '../../infra/tokens.js';

/** What the ingest guard attaches to the request: enough to write events, nothing secret. */
export interface ProjectRef {
  project_id: string;
  name: string;
  timezone: string;
}

interface ProjectDbRow {
  project_id: string;
  name: string;
  timezone: string;
  created_at: Date;
}

function toRow(r: ProjectDbRow): ProjectRow {
  return { project_id: r.project_id, name: r.name, timezone: r.timezone, created_at: r.created_at.toISOString() };
}

/** A project id shape check, so a malformed id is a 404 here rather than a 22P02 from the uuid column (rotate-key). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the JavaScript runtime's `Intl` knows the zone — the authority `localDate` and the web rely on. */
export function isIntlTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(PG_RW) private readonly rw: pg.Pool) {}

  /** True when PostgreSQL itself knows the zone; the same authority the SQL will use with AT TIME ZONE. */
  async isTimezone(name: string): Promise<boolean> {
    const r = await this.rw.query<{ ok: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS ok', [name]);
    return r.rows[0]?.ok === true;
  }

  async create(body: CreateProjectBody): Promise<ProjectCreated> {
    if (!(await this.isTimezone(body.timezone))) {
      throw new UnprocessableEntityException({ code: 'INVALID_TIMEZONE', message: `"${body.timezone}" is not a timezone PostgreSQL knows (see pg_timezone_names)`, path: 'timezone' });
    }
    if (!isIntlTimezone(body.timezone)) {
      throw new UnprocessableEntityException({ code: 'INVALID_TIMEZONE', message: `"${body.timezone}" is a timezone PostgreSQL knows but Intl.DateTimeFormat does not; choose an IANA zone both know (for example UTC)`, path: 'timezone' });
    }
    const apiKey = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const r = await this.rw.query<ProjectDbRow>(
      `INSERT INTO projects (project_id, name, timezone, api_key_hash) VALUES ($1, $2, $3, $4)
       RETURNING project_id, name, timezone, created_at`,
      [randomUUID(), body.name, body.timezone, hashApiKey(apiKey)],
    );
    const row = r.rows[0];
    if (!row) throw new Error('INSERT INTO projects returned no row');
    return { ...toRow(row), api_key: apiKey };
  }

  /**
   * Rotate a project's ingest key (S8). Only the sha256 of a key is stored, so the old key cannot be shown —
   * rotation replaces it: a new key is minted, its hash written, and the plaintext returned once, exactly as
   * creation does. The old key stops authenticating the instant the UPDATE commits. An unknown id is a 404
   * (an invalid-shaped id is treated the same, before it can reach the uuid column as a 22P02).
   */
  async rotateKey(projectId: string): Promise<RotateKeyResponse> {
    if (!UUID.test(projectId)) throw new NotFoundException({ code: 'NOT_FOUND', message: `no project ${projectId}` });
    const apiKey = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const r = await this.rw.query<ProjectDbRow>(
      `UPDATE projects SET api_key_hash = $2 WHERE project_id = $1
       RETURNING project_id, name, timezone, created_at`,
      [projectId, hashApiKey(apiKey)],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: `no project ${projectId}` });
    return { ...toRow(row), api_key: apiKey };
  }

  async list(): Promise<ProjectRow[]> {
    const r = await this.rw.query<ProjectDbRow>('SELECT project_id, name, timezone, created_at FROM projects ORDER BY created_at, name');
    return r.rows.map(toRow);
  }

  /** The guard's lookup: hash the presented key and match the hash. Null means 401; the reason is not distinguished. */
  async findByApiKey(apiKey: string): Promise<ProjectRef | null> {
    const r = await this.rw.query<ProjectRef>('SELECT project_id, name, timezone FROM projects WHERE api_key_hash = $1', [hashApiKey(apiKey)]);
    return r.rows[0] ?? null;
  }
}
