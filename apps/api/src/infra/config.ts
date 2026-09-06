/**
 * config.ts — reads the process environment into one typed object, once, at the entrypoint.
 *
 * Why it exists: every setting the API needs is named here with its variable, so a missing one fails
 * at boot with a list rather than as an undefined deep inside a pool constructor. `VANTAGE_BIND`
 * defaults to loopback ⟨D4⟩: exposing the API is a deliberate act, and `main.ts` logs a warning when
 * the bind address is anything else.
 *
 * The LLM settings live here too: `VANTAGE_LLM` picks the adapter (`none` by default, so the boundary
 * demo needs no model), choosing `anthropic` without `VANTAGE_ANTHROPIC_API_KEY` fails at boot by name,
 * and `VANTAGE_OLLAMA_NUM_CTX` is the context window asked of a local model (a positive integer; the
 * default fits the grammar, a budgeted catalog and the answer).
 *
 * What it must never do: read `process.env` anywhere but through `loadConfig` (the argument exists so
 * tests can pass a plain object), default a database URL — there is no safe guess for one — or log the
 * API key (it is read once and handed to the SDK client).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_ROLE } from './migration-runner.js';

export type LlmAdapterName = 'none' | 'ollama' | 'anthropic';
const LLM_ADAPTERS: readonly LlmAdapterName[] = ['none', 'ollama', 'anthropic'];

/** The undated Haiku 4.5 alias — cheap, fast, and more than enough for a one-object translation; the alias follows the current snapshot so an operator never pins a retired one. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5';
/** A small instruct model most operators already have; any Ollama chat model that honours `format` works. */
export const OLLAMA_DEFAULT_MODEL = 'llama3.1';
/** Ollama's own default is 2 048 tokens, less than the grammar alone; 16 k holds the grammar, a 40 000-character catalog and a 4 k-token answer. */
export const OLLAMA_DEFAULT_NUM_CTX = 16_384;

/** Which model answers `POST /v1/ask`, and with what (LLD §1.1 `LLM_PORT → adapter by env`). `none` is the default: the boundary demo needs no model. */
export interface LlmConfig {
  adapter: LlmAdapterName;
  ollamaModel: string;
  /** `options.num_ctx` for the Ollama adapter. */
  ollamaNumCtx: number;
  anthropicModel: string;
  /** Present only when `VANTAGE_ANTHROPIC_API_KEY` is set; read here, handed to the SDK client, never logged. */
  anthropicApiKey: string | undefined;
}

export interface ApiConfig {
  /** Connection string for `vantage_app`. */
  rwUrl: string;
  /** Connection string for `vantage_reader`. */
  roUrl: string;
  /** Connection string for `vantage_owner`; when present the API runs pending migrations at boot, otherwise it only verifies them. */
  ownerUrl: string | undefined;
  /** The role the owner connection must resolve to before a migration runs; `vantage_owner` unless the cluster names it differently. */
  migrationRole: string;
  bind: string;
  port: number;
  migrationsDir: string;
  llm: LlmConfig;
}

/** `apps/api/migrations`, resolved from this file so it is right whether run from `src` (vitest) or `dist` (node). */
export function defaultMigrationsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
}

/** A positive integer from the environment, or the default when the variable is unset; anything else is named. */
function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const missing = ['VANTAGE_DATABASE_URL_RW', 'VANTAGE_DATABASE_URL_RO'].filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`missing environment variables: ${missing.join(', ')} (copy .env.example to .env, or run tools/db-setup.ps1 which writes one)`);
  }
  const port = Number(env['VANTAGE_PORT'] ?? 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`VANTAGE_PORT must be a port number, got "${env['VANTAGE_PORT']}"`);
  const adapter = env['VANTAGE_LLM'] || 'none';
  if (!isAdapterName(adapter)) throw new Error(`VANTAGE_LLM must be one of ${LLM_ADAPTERS.join(', ')}, got "${adapter}"`);
  const anthropicApiKey = env['VANTAGE_ANTHROPIC_API_KEY'] || undefined;
  if (adapter === 'anthropic' && !anthropicApiKey) throw new Error('VANTAGE_LLM=anthropic needs VANTAGE_ANTHROPIC_API_KEY (set it in .env, which is git-ignored)');
  return {
    rwUrl: env['VANTAGE_DATABASE_URL_RW'] as string,
    roUrl: env['VANTAGE_DATABASE_URL_RO'] as string,
    ownerUrl: env['VANTAGE_DATABASE_URL_OWNER'] || undefined,
    migrationRole: env['VANTAGE_MIGRATION_ROLE'] || MIGRATION_ROLE,
    bind: env['VANTAGE_BIND'] || '127.0.0.1',
    port,
    migrationsDir: env['VANTAGE_MIGRATIONS_DIR'] || defaultMigrationsDir(),
    llm: {
      adapter,
      ollamaModel: env['VANTAGE_OLLAMA_MODEL'] || OLLAMA_DEFAULT_MODEL,
      ollamaNumCtx: positiveInteger(env, 'VANTAGE_OLLAMA_NUM_CTX', OLLAMA_DEFAULT_NUM_CTX),
      anthropicModel: env['VANTAGE_ANTHROPIC_MODEL'] || ANTHROPIC_DEFAULT_MODEL,
      anthropicApiKey,
    },
  };
}

function isAdapterName(value: string): value is LlmAdapterName {
  return (LLM_ADAPTERS as readonly string[]).includes(value);
}
