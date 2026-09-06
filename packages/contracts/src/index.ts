/**
 * index.ts — the public surface of `@vantage/contracts`.
 *
 * Why it exists: consumers (the API's DTO validation, later the MCP tool schemas and the web) import
 * one module and get the same Zod objects and inferred types. Anything not exported here is not a
 * contract.
 *
 * What it must never do: export anything that is not a Zod schema, an inferred type, or a pure helper
 * over one — no IO, no runtime configuration, no dependency beyond zod.
 */
export * from './json.js';
export * from './ingest.js';
export * from './projects.js';
export * from './query-spec.js';
export * from './results.js';
export * from './ask.js';
export * from './catalog.js';
export * from './mcp.js';
