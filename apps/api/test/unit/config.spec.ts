/**
 * config.spec.ts — a missing setting fails at boot with its name; defaults are loopback, 4100 and no model.
 */
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_DEFAULT_MODEL, defaultMigrationsDir, loadConfig, OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_NUM_CTX } from '../../src/infra/config.js';

const base = { VANTAGE_DATABASE_URL_RW: 'postgres://vantage_app:x@127.0.0.1:5432/vantage', VANTAGE_DATABASE_URL_RO: 'postgres://vantage_reader:x@127.0.0.1:5432/vantage' };

describe('loadConfig', () => {
  it('lists every missing database URL by name', () => {
    expect(() => loadConfig({})).toThrow(/VANTAGE_DATABASE_URL_RW, VANTAGE_DATABASE_URL_RO/);
  });

  it('defaults to loopback, port 4100, no owner URL and the repo migrations directory', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ bind: '127.0.0.1', port: 4100, ownerUrl: undefined });
    expect(c.migrationsDir).toBe(defaultMigrationsDir());
    expect(c.migrationsDir.replace(/\\/g, '/')).toMatch(/apps\/api\/migrations$/);
  });

  it('defaults the migration role to vantage_owner and lets VANTAGE_MIGRATION_ROLE override it for a differently named cluster', () => {
    expect(loadConfig(base).migrationRole).toBe('vantage_owner');
    expect(loadConfig({ ...base, VANTAGE_MIGRATION_ROLE: 'schema_admin' }).migrationRole).toBe('schema_admin');
  });

  it('reads the optional owner URL, bind and port', () => {
    const c = loadConfig({ ...base, VANTAGE_DATABASE_URL_OWNER: 'postgres://o', VANTAGE_BIND: '0.0.0.0', VANTAGE_PORT: '5000', VANTAGE_MIGRATIONS_DIR: '/m' });
    expect(c).toMatchObject({ ownerUrl: 'postgres://o', bind: '0.0.0.0', port: 5000, migrationsDir: '/m' });
  });

  it('defaults the LLM adapter to none with the default model names and context window, and reads the LLM variables', () => {
    expect(loadConfig(base).llm).toEqual({ adapter: 'none', ollamaModel: OLLAMA_DEFAULT_MODEL, ollamaNumCtx: OLLAMA_DEFAULT_NUM_CTX, anthropicModel: ANTHROPIC_DEFAULT_MODEL, anthropicApiKey: undefined });
    const c = loadConfig({ ...base, VANTAGE_LLM: 'anthropic', VANTAGE_ANTHROPIC_API_KEY: 'sk-ant-x', VANTAGE_ANTHROPIC_MODEL: 'claude-sonnet-4-5', VANTAGE_OLLAMA_MODEL: 'qwen2.5', VANTAGE_OLLAMA_NUM_CTX: '32768' });
    expect(c.llm).toEqual({ adapter: 'anthropic', ollamaModel: 'qwen2.5', ollamaNumCtx: 32_768, anthropicModel: 'claude-sonnet-4-5', anthropicApiKey: 'sk-ant-x' });
  });

  it('the Anthropic default is the undated Haiku 4.5 alias and the Ollama context default is 16 k', () => {
    expect(ANTHROPIC_DEFAULT_MODEL).toBe('claude-haiku-4-5');
    expect(OLLAMA_DEFAULT_NUM_CTX).toBe(16_384);
  });

  it('rejects a context window that is not a positive integer, by the variable name', () => {
    expect(() => loadConfig({ ...base, VANTAGE_OLLAMA_NUM_CTX: 'big' })).toThrow(/VANTAGE_OLLAMA_NUM_CTX must be a positive integer, got "big"/);
    expect(() => loadConfig({ ...base, VANTAGE_OLLAMA_NUM_CTX: '0' })).toThrow(/VANTAGE_OLLAMA_NUM_CTX/);
    expect(() => loadConfig({ ...base, VANTAGE_OLLAMA_NUM_CTX: '2.5' })).toThrow(/VANTAGE_OLLAMA_NUM_CTX/);
  });

  it('rejects an unknown adapter by name, and anthropic without a key by the variable it needs', () => {
    expect(() => loadConfig({ ...base, VANTAGE_LLM: 'openai' })).toThrow(/VANTAGE_LLM must be one of none, ollama, anthropic, got "openai"/);
    expect(() => loadConfig({ ...base, VANTAGE_LLM: 'anthropic' })).toThrow(/VANTAGE_ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ ...base, VANTAGE_LLM: 'anthropic', VANTAGE_ANTHROPIC_API_KEY: '' })).toThrow(/VANTAGE_ANTHROPIC_API_KEY/);
  });

  it('rejects a port that is not a port', () => {
    expect(() => loadConfig({ ...base, VANTAGE_PORT: 'eighty' })).toThrow(/VANTAGE_PORT/);
    expect(() => loadConfig({ ...base, VANTAGE_PORT: '70000' })).toThrow(/VANTAGE_PORT/);
  });

  it('defaults the query token to undefined (routes stay open ⟨D4⟩) and treats an empty value as unset', () => {
    expect(loadConfig(base).queryToken).toBeUndefined();
    expect(loadConfig({ ...base, VANTAGE_QUERY_TOKEN: '' }).queryToken).toBeUndefined();
  });

  it('reads a query token of at least 16 characters, and rejects a short one by name', () => {
    expect(loadConfig({ ...base, VANTAGE_QUERY_TOKEN: 'a-real-32-char-shared-read-token' }).queryToken).toBe('a-real-32-char-shared-read-token');
    expect(() => loadConfig({ ...base, VANTAGE_QUERY_TOKEN: 'short' })).toThrow(/VANTAGE_QUERY_TOKEN must be at least 16 characters/);
  });
});
