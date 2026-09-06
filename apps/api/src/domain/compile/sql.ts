/**
 * sql.ts — how the compilers put SQL together without ever concatenating a value into it.
 *
 * Why it exists: LLD §3.2 says identifiers are literals in source and every value is a `$n`
 * parameter; `tools/lint-sql.mjs` forbids `${}` in any SQL template literal. What is left is a way to
 * assemble literal fragments and placeholders that stays readable. The answer is the `Sql` brand: a
 * string that only `fill` (a source template with `{name}` holes) and `Params.add` (a placeholder for a
 * pushed value) can produce. A spec value has no path into a `Sql` except by becoming a parameter, and
 * TypeScript enforces it at every hole. `index` admits a step number and nothing else, so CTE and
 * column names such as `s3`/`t3` are derived from a count, never from a name the caller chose.
 *
 * What it must never do: offer a cast from an arbitrary string to `Sql`, or let a template be built at
 * runtime from anything but the literals in this directory.
 */

declare const SQL_BRAND: unique symbol;

/** SQL text whose only variable parts are `$n` placeholders. */
export type Sql = string & { readonly [SQL_BRAND]: true };

export class Params {
  private readonly values: unknown[] = [];
  private readonly labels: string[] = [];

  /** Appends a value and returns its placeholder; `label` is a source literal that feeds the legend, never the value itself. */
  add(value: unknown, label: string): Sql {
    this.values.push(value);
    this.labels.push(label);
    return `$${this.values.length}` as Sql;
  }

  get list(): readonly unknown[] {
    return this.values;
  }

  /** `-- $1 project_id · $2 timezone …` so the SQL panel explains its own parameters; placed after the statement so it still begins with WITH or SELECT. */
  legend(): Sql {
    return `-- ${this.labels.map((label, i) => `$${i + 1} ${label}`).join(' · ')}` as Sql;
  }
}

const HOLE = /\{(\w+)\}/g;

/** Substitutes every `{name}` hole of a source template. An unfilled hole or an unused fragment is a compiler bug and throws, so a test sees it. */
export function fill(template: string, holes: Readonly<Record<string, Sql>> = {}): Sql {
  const unused = new Set(Object.keys(holes));
  const out = template.replace(HOLE, (_match, name: string) => {
    const fragment = holes[name];
    if (fragment === undefined) throw new Error(`fill: no fragment for {${name}}`);
    unused.delete(name);
    return fragment;
  });
  if (unused.size > 0) throw new Error(`fill: fragment(s) ${[...unused].join(', ')} not used by the template`);
  return out as Sql;
}

/** A 1-based step number as SQL text: the only non-template, non-parameter source of SQL characters. */
export function index(n: number): Sql {
  if (!Number.isInteger(n) || n < 1) throw new Error(`index: expected a positive step number, got ${n}`);
  return String(n) as Sql;
}

export function joinSql(parts: readonly Sql[], separator: string): Sql {
  return parts.join(separator) as Sql;
}

/** `name AS ( -- why … )`: each CTE carries the sentence an interviewer can read aloud (design §3.2). */
export function cte(name: string, why: string, body: Sql): Sql {
  const indented = body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${name} AS (\n  -- ${why}\n${indented}\n)` as Sql;
}

/** WITH … SELECT … LIMIT, then the legend. The LIMIT asks for one row over the cap: that extra row is how the runner knows the answer was cut (V9). */
export function assembleStatement(ctes: readonly Sql[], select: Sql, p: Params, rowCap: number): Sql {
  const limit = p.add(rowCap + 1, 'row cap + 1 (the extra row reveals truncation)');
  const head = ctes.length > 0 ? 'WITH ' + ctes.join(',\n') + '\n' : '';
  return (head + select + '\nLIMIT ' + limit + '\n' + p.legend()) as Sql;
}
