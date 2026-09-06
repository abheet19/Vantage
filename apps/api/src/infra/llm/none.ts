/**
 * none.ts — `NoneLlm`: the adapter that is not a model, so the boundary demo never depends on one.
 *
 * Why it exists: design §0 A2 and LLD §3.3 — `VANTAGE_LLM=none` is the default, costs nothing and needs
 * no network, and it must still let the 90-second demo (design §8) run end to end: the August funnel
 * question produces a spec, "drop the events table" produces a refusal. So this adapter maps a fixed set
 * of demo questions, matched after normalisation (case, punctuation and whitespace do not matter), to the
 * spec text a good model would have produced, and answers anything else with one plain sentence — which
 * L1 refuses as `not_json`, exactly as it would refuse a real model's prose. The canned specs describe
 * the fixture month (August 2026, `fixtures/august.json`) and carry no `project`: L1 writes the caller's
 * project in (E26), so the same canned text serves every project. Two of the questions ask for a trend
 * and for paths on purpose: the honest answer in this build is `INVALID_SPEC` "not implemented until S6",
 * and the demo should show that refusal too.
 *
 * What it must never do: pattern-match its way to a spec for an unknown question (a near miss is a
 * refusal, not a guess), or emit anything L1 would not validate.
 */
import type { LlmMessages } from '../../domain/index.js';
import type { LlmCompleteOptions, LlmCompletion, LlmPort } from './port.js';

/** The fixture month: every canned spec ranges over it. */
const DEMO_RANGE = { from: '2026-08-01', to: '2026-08-31' } as const;

const STEPS_3 = [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }];

/** Question → spec (without `project`). The first entry is the design §8 demo question, verbatim. */
export const DEMO_QUESTIONS: ReadonlyArray<{ question: string; spec: Record<string, unknown> }> = [
  {
    question: 'Of the people who signed up in August, how many created a project within a week, and how many of those invited someone?',
    spec: { kind: 'funnel', range: DEMO_RANGE, steps: STEPS_3, order: 'sequential', window: { value: 7, unit: 'days' } },
  },
  { question: 'How many people signed up in August?', spec: { kind: 'count', range: DEMO_RANGE, event: { event: 'signup' } } },
  { question: 'How many people created a project in August?', spec: { kind: 'count', range: DEMO_RANGE, event: { event: 'create_project' } } },
  { question: 'How many people invited a teammate in August?', spec: { kind: 'count', range: DEMO_RANGE, event: { event: 'invite_teammate' } } },
  { question: 'How many people viewed pricing in August?', spec: { kind: 'count', range: DEMO_RANGE, event: { event: 'view_pricing' } } },
  {
    question: 'How many people signed up on the team plan in August?',
    spec: { kind: 'count', range: DEMO_RANGE, event: { event: 'signup', where: [{ key: 'plan', op: 'eq', value: 'team' }] } },
  },
  {
    question: 'Show the signup to create_project to invite_teammate funnel for August',
    spec: { kind: 'funnel', range: DEMO_RANGE, steps: STEPS_3, order: 'sequential', window: { value: 14, unit: 'days' } },
  },
  {
    question: 'Show the strict funnel from signup to create_project to invite_teammate for August',
    spec: { kind: 'funnel', range: DEMO_RANGE, steps: STEPS_3, order: 'strict', window: { value: 14, unit: 'days' } },
  },
  {
    question: 'Show the signup, create_project and invite_teammate funnel for August in any order',
    spec: { kind: 'funnel', range: DEMO_RANGE, steps: STEPS_3, order: 'any', window: { value: 14, unit: 'days' } },
  },
  {
    question: 'Of the people who signed up in August, how many created a project within a day?',
    spec: { kind: 'funnel', range: DEMO_RANGE, steps: STEPS_3.slice(0, 2), order: 'sequential', window: { value: 1, unit: 'days' } },
  },
  {
    question: 'Daily retention of people who signed up in August and came back to view pricing',
    spec: { kind: 'retention', range: DEMO_RANGE, start: { event: 'signup' }, return: { event: 'view_pricing' }, unit: 'day', periods: 14, mode: 'on' },
  },
  { question: 'Weekly retention of August signups', spec: { kind: 'retention', range: DEMO_RANGE, start: { event: 'signup' }, unit: 'week', periods: 4, mode: 'on' } },
  {
    question: 'Of the people who signed up in August, how many had created a project by each following day?',
    spec: { kind: 'retention', range: DEMO_RANGE, start: { event: 'signup' }, return: { event: 'create_project' }, unit: 'day', periods: 14, mode: 'on_or_after' },
  },
  { question: 'How many signups per day in August?', spec: { kind: 'trend', range: DEMO_RANGE, event: { event: 'signup' }, measure: 'events', unit: 'day' } },
  { question: 'What did people do after signing up in August?', spec: { kind: 'paths', range: DEMO_RANGE, start: 'signup', steps: 3 } },
];

/** What the adapter says to every question it does not know; one sentence, not JSON, so L1 refuses it as `not_json`. */
export const NONE_REFUSAL = 'I can only translate analytics questions about the events in this project, and that is not one of the questions I know.';

/** Lower-case letters and digits separated by single spaces: "create_project" and "Create project?" compare equal. */
export function normaliseQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class NoneLlm implements LlmPort {
  private readonly canned = new Map(DEMO_QUESTIONS.map((d) => [normaliseQuestion(d.question), JSON.stringify(d.spec)]));

  async complete(messages: LlmMessages, _opts: LlmCompleteOptions): Promise<LlmCompletion> {
    return { text: this.canned.get(normaliseQuestion(messages.user)) ?? NONE_REFUSAL, model: 'none' };
  }
}
