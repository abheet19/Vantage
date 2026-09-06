// walk.mjs — the one directory walker the repo's tools share.
//
// Why it exists: three tools each carried their own copy with slightly different skip lists; one walker
// means one place where dependency, build and VCS directories are skipped, and one signature to read.
//
// What it must never do: filter by content — callers filter by file name.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git']);

/** Absolute paths of every file under `dir` whose basename satisfies `match`, depth-first; a missing `dir` yields nothing. */
export function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(name)) out.push(p);
  }
  return out;
}
