/**
 * select-llm.spec.ts — `createLlm` builds the one adapter the configuration names, passes the Ollama context window
 * through, refuses `anthropic` without a key as a named boot error, and throws — rather than answering with the wrong
 * adapter — for a name the exhaustive switch does not know.
 */
import { describe, expect, it } from 'vitest';
import type { LlmAdapterName, LlmConfig } from '../../src/infra/config.js';
import { AnthropicLlm } from '../../src/infra/llm/anthropic.js';
import { NoneLlm } from '../../src/infra/llm/none.js';
import { OllamaLlm, type OllamaOptions } from '../../src/infra/llm/ollama.js';
import { createLlm } from '../../src/infra/llm/select.js';

const base: LlmConfig = { adapter: 'none', ollamaModel: 'llama3.1', ollamaNumCtx: 16_384, anthropicModel: 'claude-haiku-4-5', anthropicApiKey: undefined };

describe('createLlm', () => {
  it('none → NoneLlm', () => {
    expect(createLlm(base)).toBeInstanceOf(NoneLlm);
  });
  it('ollama → OllamaLlm with the configured model and context window', () => {
    const llm = createLlm({ ...base, adapter: 'ollama', ollamaNumCtx: 8_192 });
    expect(llm).toBeInstanceOf(OllamaLlm);
    expect((llm as unknown as { options: OllamaOptions }).options).toMatchObject({ model: 'llama3.1', numCtx: 8_192 });
  });
  it('anthropic with a key → AnthropicLlm; without one → an error naming the variable', () => {
    expect(createLlm({ ...base, adapter: 'anthropic', anthropicApiKey: 'sk-ant-x' })).toBeInstanceOf(AnthropicLlm);
    expect(() => createLlm({ ...base, adapter: 'anthropic' })).toThrow(/VANTAGE_ANTHROPIC_API_KEY/);
  });
  it('a name the switch does not know throws by name — never a silent fallback to another adapter', () => {
    expect(() => createLlm({ ...base, adapter: 'openai' as LlmAdapterName })).toThrow(/no adapter is named "openai"/);
  });
});
