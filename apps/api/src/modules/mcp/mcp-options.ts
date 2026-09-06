/**
 * mcp-options.ts — the MCP server's own settings: today, only whether `explain_query` may include a plan.
 *
 * Why it exists: LLD §0 D3 — a query plan leaks table statistics, so `plan` is returned only when the
 * operator started the server with `VANTAGE_EXPOSE_PLANS=1`; the default is off and the flag is read
 * once, at the entrypoint, like every other setting. It is read here and not in `infra/config.ts`
 * because that file belonged to the S3 hardening session while S4 was built; folding `exposePlans`
 * into `loadConfig` is the next edit of that file (recorded in 00-GATES.md).
 *
 * What it must never do: default to exposing plans, or accept a value it cannot read as a definite yes
 * or no — a typo must not silently mean "off".
 */

export const MCP_OPTIONS = 'MCP_OPTIONS';

export interface McpOptions {
  /** `explain_query` includes `EXPLAIN (FORMAT TEXT)` output; off unless `VANTAGE_EXPOSE_PLANS=1` ⟨D3⟩. */
  exposePlans: boolean;
}

export function loadMcpOptions(env: NodeJS.ProcessEnv = process.env): McpOptions {
  const raw = env['VANTAGE_EXPOSE_PLANS'] ?? '0';
  if (raw !== '0' && raw !== '1' && raw !== '') throw new Error(`VANTAGE_EXPOSE_PLANS must be 0 or 1, got "${raw}"`);
  return { exposePlans: raw === '1' };
}
