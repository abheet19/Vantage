// mcp-install.mjs — registers the Vantage MCP server with Claude Desktop (design §5.2 `vantage mcp install`).
//
// Why it exists: the research brief's Windows finding — `"command": "npx"` in claude_desktop_config.json
// often fails, and one JSON syntax error in that file disables every server. So this tool writes the entry
// the way that works: the absolute path of the running Node (`process.execPath`) as `command`, the absolute
// path of `apps/api/dist/mcp.js` as the argument, and the two database URLs it read from `.env` as `env`.
// It merges into an existing file without touching other servers, backs the file up first, validates the
// result parses before a byte is written, and writes atomically. `--dry-run` prints what would be written
// and writes nothing. The Claude Code one-liner it prints uses `node --env-file-if-exists=<.env>` instead
// of `-e KEY=VALUE`, so no password lands in a terminal, a shell history or a screen recording.
//
// What it must never do: invent a secret, read one from anywhere but `.env`, proceed without `.env` or
// without the built script, or overwrite a config it could not parse.
//
// Usage: node tools/mcp-install.mjs [--dry-run] [--config <path>] [--env <path>] [--script <path>]

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const SERVER_NAME = 'vantage';
export const CONFIG_FILE = 'claude_desktop_config.json';
/** The variables the server needs, and the one optional flag; nothing else from `.env` is copied. */
export const REQUIRED_VARS = ['VANTAGE_DATABASE_URL_RW', 'VANTAGE_DATABASE_URL_RO'];
export const OPTIONAL_VARS = ['VANTAGE_EXPOSE_PLANS'];

/** `KEY=VALUE` lines; `#` comments and blanks skipped; one pair of matching quotes around a value removed. Same dialect Node's `--env-file` reads. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Where Claude Desktop reads its config on this platform; Windows needs `APPDATA`, which every interactive session has. */
export function resolveConfigPath(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    if (!env.APPDATA) throw new Error('APPDATA is not set, so the Claude Desktop config directory cannot be found; pass --config <path>');
    return join(env.APPDATA, 'Claude', CONFIG_FILE);
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', CONFIG_FILE);
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Claude', CONFIG_FILE);
}

/** The variables the server entry carries: the required two (missing → refuse by name) and any optional one `.env` sets. */
export function serverEnv(envVars) {
  const missing = REQUIRED_VARS.filter((k) => !envVars[k]);
  if (missing.length) throw new Error(`.env is missing ${missing.join(', ')}; run tools/db-setup.ps1 or copy .env.example and fill in the two connection strings`);
  const env = Object.fromEntries(REQUIRED_VARS.map((k) => [k, envVars[k]]));
  for (const k of OPTIONAL_VARS) if (envVars[k] !== undefined && envVars[k] !== '') env[k] = envVars[k];
  return env;
}

export function serverEntry({ nodePath, scriptPath, env }) {
  return { command: nodePath, args: [scriptPath], env };
}

/**
 * The existing file's object with `mcpServers.vantage` replaced and everything else kept byte-for-byte in
 * meaning. A file that does not parse is refused: rewriting it would silently discard whatever the operator
 * meant, and Claude Desktop is already ignoring it.
 */
export function mergeConfig(existingText, entry) {
  let config = {};
  if (existingText !== null) {
    try {
      config = JSON.parse(existingText);
    } catch (err) {
      throw new Error(`the existing ${CONFIG_FILE} is not valid JSON (${err.message}); fix it by hand first — Claude Desktop disables every server while it is broken`, { cause: err });
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new Error(`the existing ${CONFIG_FILE} is not a JSON object`);
  }
  const servers = typeof config.mcpServers === 'object' && config.mcpServers !== null && !Array.isArray(config.mcpServers) ? config.mcpServers : {};
  return { ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } };
}

/** Passwords masked in every URL-shaped value: the console is not the config file. */
export function maskSecrets(entry) {
  const env = Object.fromEntries(Object.entries(entry.env).map(([k, v]) => [k, v.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1****@')]));
  return { ...entry, env };
}

export function claudeCodeCommand(nodePath, envPath, scriptPath) {
  return `claude mcp add ${SERVER_NAME} -- ${quote(nodePath)} --env-file-if-exists=${quote(envPath)} ${quote(scriptPath)}`;
}

const quote = (p) => (/\s/.test(p) ? `"${p}"` : p);

/**
 * The whole operation as a function, so tests run it against a temp APPDATA with a temp `.env`.
 * Returns what was (or would be) written; `written` is false on a dry run.
 */
export function install(options = {}) {
  const dryRun = options.dryRun ?? false;
  const envPath = resolve(options.envPath ?? join(root, '.env'));
  const scriptPath = resolve(options.scriptPath ?? join(root, 'apps', 'api', 'dist', 'mcp.js'));
  const nodePath = options.nodePath ?? process.execPath;
  const configPath = resolve(options.configPath ?? resolveConfigPath());
  const now = options.now ?? new Date();

  if (!existsSync(envPath)) {
    throw new Error(`no .env at ${envPath}. Run tools/db-setup.ps1 (it writes one with generated passwords) or copy .env.example to .env and fill in VANTAGE_DATABASE_URL_RW and VANTAGE_DATABASE_URL_RO.`);
  }
  if (!dryRun && !existsSync(scriptPath)) throw new Error(`${scriptPath} does not exist; run \`npm run build\` first so Claude Desktop has something to spawn`);

  const entry = serverEntry({ nodePath, scriptPath, env: serverEnv(parseEnvFile(readFileSync(envPath, 'utf8'))) });
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  const config = mergeConfig(existing, entry);
  const text = `${JSON.stringify(config, null, 2)}\n`;
  JSON.parse(text); // the file Claude Desktop will read must parse before it exists

  let backupPath = null;
  if (!dryRun) {
    mkdirSync(dirname(configPath), { recursive: true });
    if (existing !== null) {
      backupPath = `${configPath}.bak-${now.toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(configPath, backupPath);
    }
    const tmp = `${configPath}.tmp-${process.pid}`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, configPath);
  }

  return { written: !dryRun, configPath, backupPath, config, entry, command: claudeCodeCommand(nodePath, envPath, scriptPath) };
}

function parseArgs(argv) {
  const opts = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--config' || a === '--env' || a === '--script') {
      const value = argv[++i];
      if (!value) throw new Error(`${a} needs a path`);
      opts[{ '--config': 'configPath', '--env': 'envPath', '--script': 'scriptPath' }[a]] = value;
    } else throw new Error(`unknown argument ${a}; usage: node tools/mcp-install.mjs [--dry-run] [--config <path>] [--env <path>] [--script <path>]`);
  }
  return opts;
}

function main() {
  const result = install(parseArgs(process.argv.slice(2)));
  const shown = { ...result.config, mcpServers: { ...result.config.mcpServers, [SERVER_NAME]: maskSecrets(result.entry) } };
  console.log(result.written ? `✓ wrote ${result.configPath}` : `dry run — nothing written; ${result.configPath} would become:`);
  if (result.backupPath) console.log(`  previous config backed up to ${result.backupPath}`);
  console.log(JSON.stringify(shown, null, 2));
  console.log(result.written ? 'Restart Claude Desktop; the vantage server and its eight tools appear under the tools icon.' : '');
  console.log(`Claude Code instead: ${result.command}`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`✗ mcp-install: ${err.message}`);
    process.exit(1);
  }
}
