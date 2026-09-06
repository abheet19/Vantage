// coverage-thresholds.mjs — the coverage gate's numbers, in one place for both enforcers.
//
// Why it exists: `vitest.config.ts` hands these to vitest (whose per-glob matching only fires on
// POSIX paths — see check-coverage-gate.mjs) and `tools/check-coverage-gate.mjs` re-checks the per-area
// floors from the coverage summary on every OS. Two enforcers reading one table cannot disagree about
// what the gate is; two copies could.
//
// What it must never do: be lowered to make a build pass — LLD §7 names these numbers.

/** The floor for the whole tree, checked by vitest's global threshold; it fires on every OS. */
export const GLOBAL = { lines: 90, branches: 80, functions: 90, statements: 90 };

/** LLD §7 per area (posix globs relative to the repo root): domain and contracts 95/90, modules 85/75, infra 80/70. */
export const PER_AREA = {
  'packages/contracts/src/**/*.ts': { lines: 95, branches: 90 },
  'apps/api/src/domain/**/*.ts': { lines: 95, branches: 90 },
  'apps/api/src/modules/**/*.ts': { lines: 85, branches: 75 },
  'apps/api/src/infra/**/*.ts': { lines: 80, branches: 70 },
};
