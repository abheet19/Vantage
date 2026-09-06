/**
 * limits.ts — the read-only role's statement timeout, named once.
 *
 * Why it exists: the 5 s bound is L3's availability promise (design §4.2) and it is asserted in two
 * places that must never disagree — the boot self-test checks the role's session default, and
 * `QueryRunner` re-issues it as `SET LOCAL` inside every READ ONLY transaction because a default is not a
 * cap (S1 hardening finding 7: the reader can `SET statement_timeout = 0` in its own session, and an
 * operator can `ALTER ROLE` it). One constant, imported by both, is what makes "the self-test expects
 * what the runner enforces" a fact rather than a coincidence. It lives in its own file because the
 * runner imports the database module, which imports the self-test — neither can define it for the other.
 *
 * What it must never do: become configurable — a timeout the environment can raise is not a bound.
 */

/** LLD §2's bound for `vantage_reader`, in PostgreSQL's own notation so `SHOW statement_timeout` compares equal. */
export const RO_STATEMENT_TIMEOUT = '5s';
