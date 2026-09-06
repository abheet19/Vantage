import { describe, expect, it } from 'vitest';
import { MCP_SERVER_NAME } from '@vantage/contracts';
import { CONFIG_PATH, INSTALL_COMMAND, PLACEHOLDER_PATHS, claudeCodeCommand, claudeDesktopConfig } from '../src/lib/mcp.js';

interface Entry {
  command: string;
  args: string[];
  env: Record<string, string>;
}
function vantageEntry(json: string): Entry {
  const parsed = JSON.parse(json) as { mcpServers: Record<string, Entry> };
  const entry = parsed.mcpServers[MCP_SERVER_NAME];
  if (!entry) throw new Error('config has no mcpServers.vantage entry');
  return entry;
}

describe('claudeDesktopConfig', () => {
  it('is valid JSON with an mcpServers.vantage entry carrying an absolute command, the script arg, and the two database URLs', () => {
    const entry = vantageEntry(claudeDesktopConfig());
    expect(entry.command).toBe(PLACEHOLDER_PATHS.nodeAbs); // absolute node, not bare "npx" — the Windows pitfall the installer avoids
    expect(entry.args).toEqual([PLACEHOLDER_PATHS.script]);
    expect(Object.keys(entry.env)).toEqual(['VANTAGE_DATABASE_URL_RW', 'VANTAGE_DATABASE_URL_RO']);
  });

  it('uses the paths it is given', () => {
    const entry = vantageEntry(claudeDesktopConfig({ nodeAbs: '/usr/bin/node', script: '/srv/mcp.js', env: '/srv/.env' }));
    expect(entry.command).toBe('/usr/bin/node');
    expect(entry.args).toEqual(['/srv/mcp.js']);
  });

  it('never carries a plaintext secret — the env values are placeholders the installer fills from .env', () => {
    expect(claudeDesktopConfig()).not.toMatch(/postgres:\/\//);
  });
});

describe('claudeCodeCommand', () => {
  it('is the `claude mcp add vantage` one-liner that reads .env by node, so no password lands on the command line', () => {
    const cmd = claudeCodeCommand();
    expect(cmd).toContain(`claude mcp add ${MCP_SERVER_NAME} --`);
    expect(cmd).toContain('--env-file-if-exists=');
    expect(cmd).toContain(PLACEHOLDER_PATHS.script);
    expect(cmd).not.toMatch(/postgres:\/\//);
  });

  it('uses the paths it is given', () => {
    expect(claudeCodeCommand({ nodeAbs: '/usr/bin/node', script: '/srv/mcp.js', env: '/srv/.env' })).toBe('claude mcp add vantage -- node --env-file-if-exists=/srv/.env /srv/mcp.js');
  });
});

describe('constants', () => {
  it('name the Windows config file and the install command', () => {
    expect(CONFIG_PATH).toContain('claude_desktop_config.json');
    expect(INSTALL_COMMAND).toBe('npm run mcp:install');
  });
});
