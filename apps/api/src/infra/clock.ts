/**
 * clock.ts — the one place the API reads the wall clock.
 *
 * Why it exists: `server_ts` decides every derived timestamp (design §1.4) and therefore every number
 * a query returns. Making the clock a provider lets the fixture test pin `server_ts` per batch and
 * assert `client_shifted` / clamped rows deterministically, and lets `tools/lint-deps.mjs` forbid
 * `Date.now()` and `new Date()` in the pure domain.
 *
 * What it must never do: cache a value — every call is a fresh reading — or be imported by `domain/`.
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock pinned to one instant, for tests and for the fixture loader; `set` moves it between batches. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(next: Date): void {
    this.current = next;
  }
}
