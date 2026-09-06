/** Test helpers for stubbing the network the client speaks to, and building the shapes it expects. */
import type { EventCatalog, ProjectRow } from '@vantage/contracts';
import { vi } from 'vitest';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Route requests by URL suffix; an unmatched route is a 404 so a test that forgets one fails loudly. */
export function stubFetch(routes: Record<string, () => Response | Promise<Response>>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [suffix, make] of Object.entries(routes)) {
      if (url.startsWith(suffix) || url.includes(suffix)) return make();
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const PROJECT: ProjectRow = {
  project_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'August fixture',
  timezone: 'Asia/Kolkata',
  created_at: '2026-08-01T00:00:00.000Z',
};

export const CATALOG: EventCatalog = {
  project: PROJECT.project_id,
  timezone: 'Asia/Kolkata',
  events: [
    { event: 'signup', count: 13, first_seen: '2026-08-01T00:00:00.000Z', last_seen: '2026-08-31T00:00:00.000Z', properties: [{ key: 'plan', types: ['string'], cardinality_sample: 2 }] },
    { event: 'create_project', count: 6, first_seen: '2026-08-01T00:00:00.000Z', last_seen: '2026-08-31T00:00:00.000Z', properties: [] },
  ],
};
