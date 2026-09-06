/**
 * mcp.ts — the exact text the MCP screen (03-UI S8) shows: the claude_desktop_config.json block and the
 * Claude Code one-liner, built the same way tools/mcp-install.mjs builds them (design §5.2, E60).
 *
 * Why it exists: a browser cannot read this machine's absolute node path or the repo location, so the
 * screen shows the SHAPE the installer writes, with labelled placeholders for the two absolute paths, and
 * directs the operator to `npm run mcp:install` (or `--dry-run`) to compute and write the real values.
 * Keeping the string builders here — pure, no DOM — lets a unit test pin their structure to the installer's:
 * an absolute `command` (the bare-`npx` Windows pitfall the installer exists to avoid), the two database
 * URLs the server reads, and no password ever placed on the Claude Code command line.
 *
 * What it must never do: invent a real secret or a real machine path (the placeholders are obviously
 * placeholders), or claim the config is written — writing it is `npm run mcp:install`'s job, not the SPA's.
 */
import { MCP_SERVER_NAME } from '@vantage/contracts';

/** Where Claude Desktop reads its config on Windows; the installer merges into this file (E60). */
export const CONFIG_PATH = '%APPDATA%\\Claude\\claude_desktop_config.json';
export const INSTALL_COMMAND = 'npm run mcp:install';

/** The two absolute paths and the `.env` the installer resolves on the operator's machine; shown as placeholders here. */
export interface McpPaths {
  /** `process.execPath` on the machine running Vantage — absolute on purpose, so Claude Desktop need not resolve `node` off PATH. */
  nodeAbs: string;
  /** The built server the config spawns. */
  script: string;
  /** The `.env` the Claude Code one-liner reads so no database password lands on the command line. */
  env: string;
}

export const PLACEHOLDER_PATHS: McpPaths = {
  nodeAbs: '<absolute path to your node.exe>',
  script: '<repo>\\apps\\api\\dist\\mcp.js',
  env: '<repo>\\.env',
};

/**
 * The `mcpServers.vantage` entry tools/mcp-install.mjs writes: an absolute `command`, the built script as the
 * one argument, and the read/write and read-only database URLs from `.env` as `env` (masked here — the SPA
 * never holds them; the installer copies them from `.env`).
 */
export function claudeDesktopConfig(paths: McpPaths = PLACEHOLDER_PATHS): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: paths.nodeAbs,
          args: [paths.script],
          env: {
            VANTAGE_DATABASE_URL_RW: '<from your .env>',
            VANTAGE_DATABASE_URL_RO: '<from your .env>',
          },
        },
      },
    },
    null,
    2,
  );
}

/** The Claude Code one-liner (E60): the `.env` is read by node, so a password never lands in a shell history. */
export function claudeCodeCommand(paths: McpPaths = PLACEHOLDER_PATHS): string {
  return `claude mcp add ${MCP_SERVER_NAME} -- node --env-file-if-exists=${paths.env} ${paths.script}`;
}
