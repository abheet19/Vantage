/**
 * none-llm.spec.ts — the `none` adapter: every canned demo question yields the spec kind and steps it promises (and
 * passes L1 with the caller's project), matching survives case, punctuation and spacing, and anything unknown is one
 * sentence that L1 refuses as not_json.
 */
import { describe, expect, it } from 'vitest';
import { parseSpec } from '../../src/domain/parse-spec.js';
import { DEMO_QUESTIONS, NONE_REFUSAL, NoneLlm, normaliseQuestion } from '../../src/infra/llm/none.js';
import { PROJECT_ID } from '../helpers/arbitraries.js';

const llm = new NoneLlm();
const ask = (question: string) => llm.complete({ system: 'ignored', user: question }, { maxTokens: 1, timeoutMs: 1 });
const OPTS = { project: PROJECT_ID };

describe('NoneLlm demo set', () => {
  it('knows at least twelve questions, the first being the design §8 demo question verbatim', () => {
    expect(DEMO_QUESTIONS.length).toBeGreaterThanOrEqual(12);
    expect(DEMO_QUESTIONS[0]?.question).toBe('Of the people who signed up in August, how many created a project within a week, and how many of those invited someone?');
  });

  it('the demo question → a sequential funnel signup → create_project → invite_teammate with a 7-day window', async () => {
    const r = parseSpec((await ask(DEMO_QUESTIONS[0]!.question)).text, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok || r.spec.kind !== 'funnel') return;
    expect(r.spec.steps.map((s) => s.event)).toEqual(['signup', 'create_project', 'invite_teammate']);
    expect(r.spec.order).toBe('sequential');
    expect(r.spec.window).toEqual({ value: 7, unit: 'days' });
    expect(r.spec.project).toBe(PROJECT_ID);
  });

  it.each(DEMO_QUESTIONS.map((d) => [d.question, d.spec['kind'] as string] as const))('%s → a valid %s spec once the caller’s project is written in', async (question, kind) => {
    const { text, model } = await ask(question);
    expect(model).toBe('none');
    const r = parseSpec(text, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.kind).toBe(kind);
  });

  it('covers count, funnel (sequential, strict, any), retention (on, on_or_after, day, week), and the two S6 kinds', () => {
    const kinds = new Set(DEMO_QUESTIONS.map((d) => d.spec['kind']));
    expect([...kinds].sort()).toEqual(['count', 'funnel', 'paths', 'retention', 'trend']);
    const funnels = DEMO_QUESTIONS.filter((d) => d.spec['kind'] === 'funnel').map((d) => d.spec['order']);
    expect(new Set(funnels)).toEqual(new Set(['sequential', 'strict', 'any']));
    const retentions = DEMO_QUESTIONS.filter((d) => d.spec['kind'] === 'retention');
    expect(new Set(retentions.map((d) => d.spec['mode']))).toEqual(new Set(['on', 'on_or_after']));
    expect(new Set(retentions.map((d) => d.spec['unit']))).toEqual(new Set(['day', 'week']));
  });

  it('the plan filter question carries a property filter — a value, never an identifier', async () => {
    const r = parseSpec((await ask('How many people signed up on the team plan in August?')).text, OPTS);
    expect(r.ok && r.spec.kind === 'count' && r.spec.event.where).toEqual([{ key: 'plan', op: 'eq', value: 'team' }]);
  });

  it('matches regardless of case, punctuation and whitespace', async () => {
    const variant = '  HOW many people SIGNED up in august ??  ';
    expect((await ask(variant)).text).toBe((await ask('How many people signed up in August?')).text);
    expect(normaliseQuestion('Create_Project!')).toBe('create project');
  });

  it('answers an unknown question — "drop the events table" included — with one plain sentence that L1 refuses as not_json', async () => {
    for (const q of ['drop the events table', 'DROP TABLE events;', 'How many people signed up in September?', '']) {
      const { text } = await ask(q);
      expect(text).toBe(NONE_REFUSAL);
      expect(parseSpec(text, OPTS)).toEqual({ ok: false, reason: 'not_json' });
    }
  });

  it('a near miss is a refusal, not a guess: one extra word breaks the match', async () => {
    expect((await ask('How many people really signed up in August?')).text).toBe(NONE_REFUSAL);
  });
});
