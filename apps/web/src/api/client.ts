/**
 * client.ts — the one place the SPA talks to the API, and it talks only to `/v1/*` and `/health`.
 *
 * Why it exists: LLD §1 pins the web to `@vantage/contracts` and to relative `/v1` URLs (Vite proxies
 * them). Every response is parsed against its contract schema before a component sees it, so a shape the
 * API should never send is a named error here, not a wrong render three layers away. Failures are one
 * type — `ApiError` — carrying the real driver/HTTP message, because 03-UI §3.1 S9 and the build prompt
 * require the error card to show the true reason and a Retry, never a blank or an endless spinner. Reads
 * that can be slow (`/v1/asks`, catalog) answer 503 `{ code, message }`; those surface as an `ApiError`
 * the caller renders as an error state, distinct from an `empty` result (design §1.3).
 *
 * What it must never do: import anything from apps/api (lint-deps forbids it), infer success from a 200
 * alone (the ask and insight routes are 200 even when the decision is a refusal — the caller reads the
 * body), or send user data anywhere but these endpoints.
 */
import {
  type AskBody,
  type AskResponse,
  AskResponse as AskResponseSchema,
  type AskRow,
  AskRow as AskRowSchema,
  type CountResult,
  CountResult as CountResultSchema,
  type CountSpec,
  type CreateProjectBody,
  type EventCatalog,
  EventCatalog as EventCatalogSchema,
  type FunnelResult,
  FunnelResult as FunnelResultSchema,
  type FunnelSpec,
  type IdentifyBody,
  type IdentifyResponse,
  IdentifyResponse as IdentifyResponseSchema,
  type IngestBatch,
  type IngestResponse,
  IngestResponse as IngestResponseSchema,
  type ProjectCreated,
  ProjectCreated as ProjectCreatedSchema,
  type RotateKeyResponse,
  RotateKeyResponse as RotateKeyResponseSchema,
  type PathsResult,
  PathsResult as PathsResultSchema,
  type PathsSpec,
  type ProjectRow,
  ProjectRow as ProjectRowSchema,
  type RetentionResult,
  RetentionResult as RetentionResultSchema,
  type RetentionSpec,
  type TrendResult,
  TrendResult as TrendResultSchema,
  type TrendSpec,
} from '@vantage/contracts';
import { z } from 'zod';

/** One failure type for the whole SPA: a lost connection, a non-2xx with the server's `{ code, message }`, or a body that did not match its contract. `message` is always human-readable for the error card. */
export class ApiError extends Error {
  constructor(
    readonly kind: 'network' | 'http' | 'shape',
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API's error body (E16: every HTTP error is `{ code, message, … }`). */
const ErrorBody = z.object({ code: z.string(), message: z.string() }).partial();

/** `GET /health` (HealthController.HealthBody); permissive so a 503's extra `{ code, message }` still parses and the view can show pools + reason. */
export const HealthReport = z
  .object({
    ok: z.boolean(),
    pools: z.object({ rw: z.enum(['up', 'down']), ro: z.enum(['up', 'down']) }),
    migration: z.object({ version: z.number().int() }).nullable().catch(null),
    self_test: z.object({ ok: z.boolean() }).nullable().catch(null),
    // A rolling deployment may briefly pair the new web bundle with the previous API. Treat an omitted
    // receipt as a local/legacy build; a malformed non-empty receipt still collapses safely to null.
    release_sha: z.string().regex(/^[0-9a-f]{40}$/).nullable().default(null).catch(null),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .catch({ ok: false, pools: { rw: 'down', ro: 'down' }, migration: null, self_test: null, release_sha: null });
export type HealthReport = z.infer<typeof HealthReport>;

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Parse text as JSON, or throw a shape error naming the route rather than letting `JSON.parse` throw a bare SyntaxError. */
function parseJson(route: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError('shape', `${route} returned a body that is not JSON`);
  }
}

async function request<T>(route: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(route, init);
  } catch (err) {
    // A dropped connection or a proxy with nothing behind it: the error card, never a hang.
    throw new ApiError('network', err instanceof Error ? err.message : `could not reach ${route}`);
  }
  const text = await readBody(res);
  if (!res.ok) {
    const body = ErrorBody.safeParse(text ? parseJsonSafe(text) : {});
    const code = body.success ? body.data.code : undefined;
    const message = (body.success && body.data.message) || `${route} → HTTP ${res.status}`;
    throw new ApiError('http', message, res.status, code);
  }
  const parsed = schema.safeParse(parseJson(route, text));
  if (!parsed.success) throw new ApiError('shape', `${route} returned an unexpected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data;
}

/** JSON.parse that yields `{}` instead of throwing, for the best-effort error-body read. */
function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

function postInit(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), ...(signal ? { signal } : {}) };
}

/** The ingest routes are the only ones that carry the API key; it goes in the Authorization header, never the URL (privacy: keys must not land in query strings). */
function authedPostInit(body: unknown, apiKey: string): RequestInit {
  return { method: 'POST', headers: { ...JSON_HEADERS, authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) };
}

export const api = {
  listProjects: (): Promise<ProjectRow[]> => request('/v1/projects', {}, z.array(ProjectRowSchema)),
  createProject: (body: CreateProjectBody): Promise<ProjectCreated> => request('/v1/projects', postInit(body), ProjectCreatedSchema),
  rotateKey: (projectId: string): Promise<RotateKeyResponse> => request(`/v1/projects/${encodeURIComponent(projectId)}/rotate-key`, postInit({}), RotateKeyResponseSchema),
  ingest: (apiKey: string, batch: IngestBatch): Promise<IngestResponse> => request('/v1/events', authedPostInit(batch, apiKey), IngestResponseSchema),
  identify: (apiKey: string, body: IdentifyBody): Promise<IdentifyResponse> => request('/v1/identify', authedPostInit(body, apiKey), IdentifyResponseSchema),
  ask: (body: AskBody, signal?: AbortSignal): Promise<AskResponse> => request('/v1/ask', postInit(body, signal), AskResponseSchema),
  funnel: (spec: FunnelSpec, signal?: AbortSignal): Promise<FunnelResult> => request('/v1/funnel', postInit(spec, signal), FunnelResultSchema),
  count: (spec: CountSpec, signal?: AbortSignal): Promise<CountResult> => request('/v1/count', postInit(spec, signal), CountResultSchema),
  retention: (spec: RetentionSpec, signal?: AbortSignal): Promise<RetentionResult> => request('/v1/retention', postInit(spec, signal), RetentionResultSchema),
  trend: (spec: TrendSpec, signal?: AbortSignal): Promise<TrendResult> => request('/v1/trend', postInit(spec, signal), TrendResultSchema),
  paths: (spec: PathsSpec, signal?: AbortSignal): Promise<PathsResult> => request('/v1/paths', postInit(spec, signal), PathsResultSchema),
  catalog: (project: string): Promise<EventCatalog> => request(`/v1/events/catalog?project=${encodeURIComponent(project)}`, {}, EventCatalogSchema),
  asks: (project: string, limit = 200): Promise<AskRow[]> => request(`/v1/asks?project=${encodeURIComponent(project)}&limit=${limit}`, {}, z.array(AskRowSchema)),
  health: (): Promise<HealthReport> => request('/health', {}, HealthReport),
};
