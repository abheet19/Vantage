/**
 * select.ts — `createLlm`: one adapter, chosen by configuration, constructed once.
 *
 * Why it exists: LLD §1.1 — `LLM_PORT → adapter by env`. The choice is made here and nowhere else so
 * that `modules/ask` depends on the port, not on any adapter, and so the "anthropic only when a key is
 * set" rule has exactly one home: choosing `anthropic` without a key is a configuration error at boot,
 * named, never a runtime surprise on the first ask. `LlmConfig` is the shape `infra/config.ts` reads
 * from the environment; it is declared there, not here, so config never imports an adapter and the lint
 * rule "only modules/ask imports infra/llm" (design §6.3) holds for the whole tree. The switch is
 * exhaustive twice over: the compiler checks it through the `never` in `default`, and the runtime throws
 * there too, so a name that slips past `loadConfig` can never be answered with the wrong adapter.
 *
 * What it must never do: construct more than one adapter, fall back to another adapter when the
 * configured one cannot be built, or read `process.env` (config does; this takes an argument).
 */
import type { LlmConfig } from '../config.js';
import { AnthropicLlm } from './anthropic.js';
import { NoneLlm } from './none.js';
import { OllamaLlm } from './ollama.js';
import type { LlmPort } from './port.js';

export function createLlm(config: LlmConfig): LlmPort {
  switch (config.adapter) {
    case 'none':
      return new NoneLlm();
    case 'ollama':
      return new OllamaLlm({ model: config.ollamaModel, numCtx: config.ollamaNumCtx });
    case 'anthropic':
      if (!config.anthropicApiKey) throw new Error('VANTAGE_LLM=anthropic needs VANTAGE_ANTHROPIC_API_KEY (set it in .env, which is git-ignored)');
      return new AnthropicLlm({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
    default: {
      const unknownAdapter: never = config.adapter;
      throw new Error(`createLlm: no adapter is named "${String(unknownAdapter)}"`);
    }
  }
}
