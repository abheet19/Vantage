/**
 * mcp-install.spec.ts — `tools/mcp-install.mjs` against a temp APPDATA and a temp `.env`: it creates the Claude Desktop
 * config, merges without clobbering other servers, backs the previous file up, writes nothing on a dry run, refuses
 * without `.env`, without the built script and on a config it cannot parse, and never prints a password.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tools', 'mcp-install.mjs');
const ENV_TEXT = [
  '# written by tools/db-setup.ps1',
  'VANTAGE_DATABASE_URL_OWNER=postgres://vantage_owner:owner-secret@127.0.0.1:5432/vantage',
  'VANTAGE_DATABASE_URL_RW=postgres://vantage_app:app-secret@127.0.0.1:5432/vantage',
  'VANTAGE_DATABASE_URL_RO="postgres://vantage_reader:reader-secret@127.0.0.1:5432/vantage"',
  'VANTAGE_PORT=4100',
  '',
].join('\n');

interface InstallResult {
  written: boolean;
  configPath: string;
  backupPath: string | null;
  config: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> } & Record<string, unknown>;
  command: string;
}
interface InstallOptions {
  dryRun?: boolean;
  configPath?: string;
  envPath?: string;
  scriptPath?: string;
  nodePath?: string;
  now?: Date;
}
/** The tool is plain ESM with no declaration file; it is imported by URL and its exports typed by the shapes this suite asserts. */
interface InstallTool {
  install(o: InstallOptions): InstallResult;
  resolveConfigPath(env: Record<string, string | undefined>, platform: string): string;
  parseEnvFile(text: string): Record<string, string>;
  maskSecrets(entry: { env: Record<string, string> }): { env: Record<string, string> };
}
let install: InstallTool['install'];
let resolveConfigPath: InstallTool['resolveConfigPath'];
let parseEnvFile: InstallTool['parseEnvFile'];
let maskSecrets: InstallTool['maskSecrets'];

beforeAll(async () => {
  const mod = (await import(pathToFileURL(TOOL).href)) as InstallTool;
  ({ install, resolveConfigPath, parseEnvFile, maskSecrets } = mod);
});

let dir: string;
let appdata: string;
let envPath: string;
let scriptPath: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'vantage-mcp-install-'));
  appdata = path.join(dir, 'AppData', 'Roaming');
  envPath = path.join(dir, '.env');
  scriptPath = path.join(dir, 'dist', 'mcp.js');
  mkdirSync(path.dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, '// built\n');
  writeFileSync(envPath, ENV_TEXT);
  configPath = resolveConfigPath({ APPDATA: appdata }, 'win32');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const readConfig = () => JSON.parse(readFileSync(configPath, 'utf8')) as InstallResult['config'];
const options = (over: InstallOptions = {}): InstallOptions => ({ envPath, scriptPath, configPath, nodePath: 'C:\\nodejs\\node.exe', ...over });

describe('resolveConfigPath', () => {
  it('on Windows is %APPDATA%\\Claude\\claude_desktop_config.json and refuses without APPDATA', () => {
    expect(configPath).toBe(path.join(appdata, 'Claude', 'claude_desktop_config.json'));
    expect(() => resolveConfigPath({}, 'win32')).toThrow(/APPDATA/);
  });
});

describe('install into a fresh profile', () => {
  it('creates the directory and the file with an absolute node path, an absolute script path and only the two URLs from .env', () => {
    const r = install(options());
    expect(r.written).toBe(true);
    expect(r.backupPath).toBeNull();
    const cfg = readConfig();
    expect(cfg).toEqual({
      mcpServers: {
        vantage: {
          command: 'C:\\nodejs\\node.exe',
          args: [scriptPath],
          env: {
            VANTAGE_DATABASE_URL_RW: 'postgres://vantage_app:app-secret@127.0.0.1:5432/vantage',
            VANTAGE_DATABASE_URL_RO: 'postgres://vantage_reader:reader-secret@127.0.0.1:5432/vantage',
          },
        },
      },
    });
    expect(path.isAbsolute(cfg.mcpServers['vantage']!.args[0]!)).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('owner-secret');
    expect(JSON.stringify(cfg)).not.toContain('VANTAGE_PORT');
  });

  it('carries VANTAGE_EXPOSE_PLANS only when .env sets it', () => {
    writeFileSync(envPath, `${ENV_TEXT}VANTAGE_EXPOSE_PLANS=1\n`);
    expect(install(options()).config.mcpServers['vantage']!.env['VANTAGE_EXPOSE_PLANS']).toBe('1');
  });

  it('prints a Claude Code one-liner that loads .env through node rather than echoing a password', () => {
    const r = install(options({ nodePath: 'C:\\Program Files\\nodejs\\node.exe' }));
    expect(r.command).toBe(`claude mcp add vantage -- "C:\\Program Files\\nodejs\\node.exe" --env-file-if-exists=${envPath} ${scriptPath}`);
    expect(r.command).not.toContain('secret');
  });
});

describe('install over an existing config', () => {
  const OTHER = { mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\docs'] } }, globalShortcut: 'Ctrl+Space' };

  beforeEach(() => {
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(OTHER, null, 4));
  });

  it('adds vantage next to the other servers and keeps every unrelated key', () => {
    install(options());
    const cfg = readConfig();
    expect(cfg.mcpServers['filesystem']).toEqual(OTHER.mcpServers.filesystem);
    expect(cfg['globalShortcut']).toBe('Ctrl+Space');
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['filesystem', 'vantage']);
  });

  it('backs the previous file up, byte for byte, under a timestamped name before writing', () => {
    const r = install(options({ now: new Date('2026-09-05T10:20:30.400Z') }));
    expect(r.backupPath).toBe(`${configPath}.bak-2026-09-05T10-20-30-400Z`);
    expect(readFileSync(r.backupPath!, 'utf8')).toBe(JSON.stringify(OTHER, null, 4));
  });

  it('replaces a previous vantage entry instead of duplicating it', () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { vantage: { command: 'npx', args: ['vantage'] } } }));
    install(options());
    expect(readConfig().mcpServers['vantage']!.command).toBe('C:\\nodejs\\node.exe');
  });

  it('refuses a config that does not parse and leaves it untouched — rewriting it would discard what the operator meant', () => {
    writeFileSync(configPath, '{ "mcpServers": { "x": ');
    expect(() => install(options())).toThrow(/not valid JSON/);
    expect(readFileSync(configPath, 'utf8')).toBe('{ "mcpServers": { "x": ');
    expect(readdirSync(path.dirname(configPath))).toEqual(['claude_desktop_config.json']);
  });
});

describe('dry run and refusals', () => {
  it('--dry-run returns the config it would write and creates no file and no directory', () => {
    const r = install(options({ dryRun: true }));
    expect(r.written).toBe(false);
    expect(r.config.mcpServers['vantage']!.args).toEqual([scriptPath]);
    expect(existsSync(path.dirname(configPath))).toBe(false);
  });

  it('refuses when .env is missing, saying how to get one', () => {
    rmSync(envPath);
    expect(() => install(options())).toThrow(/no \.env at .*db-setup\.ps1/);
    expect(existsSync(configPath)).toBe(false);
  });

  it('refuses when .env lacks a connection string, naming it', () => {
    writeFileSync(envPath, 'VANTAGE_DATABASE_URL_RW=postgres://vantage_app:x@127.0.0.1:5432/vantage\n');
    expect(() => install(options())).toThrow(/missing VANTAGE_DATABASE_URL_RO/);
  });

  it('refuses when the built script is missing (but a dry run still shows the config)', () => {
    rmSync(scriptPath);
    expect(() => install(options())).toThrow(/npm run build/);
    expect(install(options({ dryRun: true })).written).toBe(false);
  });
});

describe('helpers', () => {
  it('parseEnvFile reads KEY=VALUE, skips comments and blanks, strips one pair of quotes', () => {
    expect(parseEnvFile(ENV_TEXT)).toEqual({
      VANTAGE_DATABASE_URL_OWNER: 'postgres://vantage_owner:owner-secret@127.0.0.1:5432/vantage',
      VANTAGE_DATABASE_URL_RW: 'postgres://vantage_app:app-secret@127.0.0.1:5432/vantage',
      VANTAGE_DATABASE_URL_RO: 'postgres://vantage_reader:reader-secret@127.0.0.1:5432/vantage',
      VANTAGE_PORT: '4100',
    });
  });

  it('maskSecrets hides the password of every URL and nothing else', () => {
    const masked = maskSecrets({ env: { VANTAGE_DATABASE_URL_RW: 'postgres://vantage_app:app-secret@127.0.0.1:5432/vantage', VANTAGE_EXPOSE_PLANS: '1' } });
    expect(masked.env).toEqual({ VANTAGE_DATABASE_URL_RW: 'postgres://vantage_app:****@127.0.0.1:5432/vantage', VANTAGE_EXPOSE_PLANS: '1' });
  });
});

describe('the CLI', () => {
  const run = (args: string[]) => {
    try {
      return { status: 0, output: execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: `${e.stdout}${e.stderr}` };
    }
  };

  it('--dry-run prints the masked config and the one-liner, writes nothing, exits 0', () => {
    const r = run(['--dry-run', '--env', envPath, '--config', configPath, '--script', scriptPath]);
    expect(r.status).toBe(0);
    expect(r.output).toContain('dry run — nothing written');
    expect(r.output).toContain('"VANTAGE_DATABASE_URL_RW": "postgres://vantage_app:****@127.0.0.1:5432/vantage"');
    expect(r.output).toContain('claude mcp add vantage --');
    expect(r.output).not.toContain('app-secret');
    expect(existsSync(configPath)).toBe(false);
  });

  it('exits 1 with the reason when .env is missing', () => {
    const r = run(['--env', path.join(dir, 'nope.env'), '--config', configPath, '--script', scriptPath]);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/✗ mcp-install: no \.env at/);
  });

  it('exits 1 on an unknown argument', () => {
    expect(run(['--bogus']).status).toBe(1);
  });
});
