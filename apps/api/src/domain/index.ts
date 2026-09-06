/**
 * index.ts — the public surface of the PURE domain.
 *
 * Why it exists: infra and modules import domain functions from one place, and the dependency linter
 * (`tools/lint-deps.mjs`) can hold the whole directory to one rule: nothing in here imports Nest, pg,
 * infra or modules. Everything here is a function of its arguments.
 *
 * What it must never do: re-export anything that performs IO, reads a clock, or draws randomness.
 */
export * from './adjust-timestamp.js';
export * from './derive-insert-id.js';
export * from './normalize-event.js';
export * from './plan-merge.js';
export * from './hash-api-key.js';
export * from './bucket.js';
export * from './status.js';
export * from './compile/index.js';
export * from './prompt.js';
export * from './parse-spec.js';
