/**
 * catalog.ts — the event catalog: what a project's events are called and what their properties look like (LLD §3.4).
 *
 * Why it exists: `GET /v1/events/catalog` is what the ask path feeds the model as DATA (design §4.2 L0),
 * what the MCP `list_events`/`describe_event` tools return (S4) and what the web's Events view renders
 * (S5). One shape for all three keeps the prompt, the tools and the UI describing the same facts. It
 * carries names, counts, first/last seen and, per event, property keys with the JSON types seen and a
 * distinct-value count over a bounded sample — never a row and never a value, so nothing a tracked user
 * typed into a property can reach the model through the catalog.
 *
 * What it must never do: include property values or examples (an attacker-controlled string in a
 * property is exactly LLD §9's injection vector), or exceed its caps (500 names, 50 keys per event).
 */
import { z } from 'zod';

export const CATALOG_LIMITS = { events: 500, keysPerEvent: 50, sampleRows: 200 } as const;

/** `jsonb_typeof` values; `cardinality_sample` is the number of distinct values among the sampled rows, so it never exceeds `sampleRows`. */
export const CatalogProperty = z.object({
  key: z.string(),
  types: z.array(z.enum(['string', 'number', 'boolean', 'null', 'object', 'array'])),
  cardinality_sample: z.number().int().min(0).max(CATALOG_LIMITS.sampleRows),
});
export type CatalogProperty = z.infer<typeof CatalogProperty>;

export const CatalogEvent = z.object({
  event: z.string(),
  count: z.number().int(),
  first_seen: z.string().datetime(),
  last_seen: z.string().datetime(),
  properties: z.array(CatalogProperty).max(CATALOG_LIMITS.keysPerEvent),
});
export type CatalogEvent = z.infer<typeof CatalogEvent>;

export const EventCatalog = z.object({
  project: z.string().uuid(),
  timezone: z.string(),
  events: z.array(CatalogEvent).max(CATALOG_LIMITS.events),
});
export type EventCatalog = z.infer<typeof EventCatalog>;

export const CatalogQuery = z.strictObject({ project: z.string().uuid() });
export type CatalogQuery = z.infer<typeof CatalogQuery>;
