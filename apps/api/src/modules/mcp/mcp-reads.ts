/**
 * mcp-reads.ts — the two reads the MCP tools need that no existing service offers, as the reader, bounded like every other.
 *
 * Why it exists: `list_projects` promises counts and first/last event per project (LLD §6) and every
 * other tool must answer `NOT_FOUND` for a project id the server does not know — `ProjectsService.list`
 * reads through the write pool and carries neither, and `CatalogService` deliberately answers an unknown
 * project with an empty catalog (no enumeration over HTTP). So this class issues two literal statements
 * through `QueryRunner.readOnly`: `vantage_reader`, `BEGIN READ ONLY`, the 5 s `SET LOCAL` bound and the
 * pool's admission rule, exactly as the catalog and the compiled statements run (E28, E44). Nothing here
 * names the driver: the runner is the only thing the module holds.
 *
 * What it must never do: enumerate projects in an error, build SQL from an argument, or grow a third
 * statement that a service should own instead.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ProjectSummary } from '@vantage/contracts';
import { QueryRunner } from '../../infra/query-runner.js';

export interface ProjectRef {
  project_id: string;
  name: string;
  timezone: string;
}

interface SummaryRow extends ProjectRef {
  events: number;
  persons: number;
  first_event: Date | null;
  last_event: Date | null;
}

/** One row per project; `persons` counts surviving persons (a merged one points at its survivor). */
const SUMMARIES = `SELECT p.project_id, p.name, p.timezone,
       (SELECT count(*) FROM events e WHERE e.project_id = p.project_id)::int AS events,
       (SELECT count(*) FROM persons ps WHERE ps.project_id = p.project_id AND ps.merged_into IS NULL)::int AS persons,
       (SELECT min(e.event_ts) FROM events e WHERE e.project_id = p.project_id) AS first_event,
       (SELECT max(e.event_ts) FROM events e WHERE e.project_id = p.project_id) AS last_event
  FROM projects p
 ORDER BY p.created_at, p.name`;

@Injectable()
export class McpReads {
  constructor(@Inject(QueryRunner) private readonly runner: QueryRunner) {}

  /** The project by exact id, or null; the caller turns null into `NOT_FOUND` without saying what else exists. */
  async findProject(projectId: string): Promise<ProjectRef | null> {
    const r = await this.runner.readOnly((query) => query<ProjectRef>('SELECT project_id, name, timezone FROM projects WHERE project_id = $1', [projectId]));
    return r.rows[0] ?? null;
  }

  async projectSummaries(): Promise<ProjectSummary[]> {
    const r = await this.runner.readOnly((query) => query<SummaryRow>(SUMMARIES));
    return r.rows.map((row) => ({
      project: row.project_id,
      name: row.name,
      timezone: row.timezone,
      events: row.events,
      persons: row.persons,
      first_event: row.first_event?.toISOString() ?? null,
      last_event: row.last_event?.toISOString() ?? null,
    }));
  }
}
