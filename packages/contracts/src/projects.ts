/**
 * projects.ts — the HTTP contract for `POST /v1/projects` and `GET /v1/projects` (LLD §3.4).
 *
 * Why it exists: the LLD names the routes but not the DTO, and the ingest path depends on the project
 * existing with a validated timezone (V5 bucketing is only meaningful for a real IANA zone). The
 * timezone here is only shape-checked; the *name* is validated against `pg_timezone_names` by the
 * service, because PostgreSQL — not this package — is the authority on which zones the SQL can use.
 *
 * What it must never do: carry the API key anywhere but in `ProjectCreated`, the one-time response.
 * `ProjectRow` (the list shape) has no key field by construction.
 */
import { z } from 'zod';
import { StorableText } from './ingest.js';

export const CreateProjectBody = z.object({ name: StorableText(200), timezone: z.string().min(1).max(64) });
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

export const ProjectRow = z.object({
  project_id: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
  created_at: z.string().datetime(),
});
export type ProjectRow = z.infer<typeof ProjectRow>;

/** The only response that ever carries the key. It is shown once; the database keeps only its sha256. */
export const ProjectCreated = ProjectRow.extend({ api_key: z.string() });
export type ProjectCreated = z.infer<typeof ProjectCreated>;

/**
 * `POST /v1/projects/:id/rotate-key` (S8): the same one-time shape as creation. Rotation does not — cannot —
 * reveal a stored key (only its sha256 exists); it mints a NEW key, replaces the hash, and returns the new
 * key once, invalidating the old one. So the response type is `ProjectCreated`: a fresh key shown exactly once.
 */
export const RotateKeyResponse = ProjectCreated;
export type RotateKeyResponse = z.infer<typeof RotateKeyResponse>;
