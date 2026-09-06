/**
 * adjust-timestamp.ts — design §1.4 (Amplitude's clock rule) as one total function.
 *
 * Why it exists: a device with a wrong clock is wrong by a constant, and `sent_at` measures that
 * constant at upload time; correcting by it keeps the order of events within a batch while never
 * letting a client place an event in the future. `now` (serverTs) is a parameter so tests can pin it
 * — this file is PURE: no clock, no IO, no randomness.
 *
 * What it must never do: return an `eventTs` later than `serverTs + 60 s` (V8), shift by anything
 * other than exactly the measured skew, or label a value the client did not supply as `client`.
 * On that last point the design's row 2 ("min(client_ts, server_ts), ts_source = client") is read
 * together with its own 60 s tolerance and LLD §9 ("2031 → clamped, ts_source: server"): a clamp of
 * at most 60 s is clock jitter and keeps `client`; a larger clamp means the client's value was
 * discarded, and the row is labelled `server` so `ts_adjusted_share` stays honest.
 */

/** Design §1.4: skew within this is jitter, not a wrong clock. */
export const SKEW_TOLERANCE_MS = 60_000;
/** Design §1.4: older than this is accepted but flagged `too_old` in the response. */
export const TOO_OLD_MS = 366 * 86_400_000;

export type TsSource = 'client' | 'client_shifted' | 'server';

export interface AdjustedTimestamp {
  eventTs: Date;
  source: TsSource;
  tooOld: boolean;
}

/** Design §1.4, as one total function. `now` is a parameter so tests can pin it. */
export function adjustTimestamp(clientTs: Date | null, sentAt: Date | null, serverTs: Date): AdjustedTimestamp {
  const server = serverTs.getTime();
  let eventMs: number;
  let source: TsSource;

  if (clientTs === null) {
    eventMs = server;
    source = 'server';
  } else if (sentAt === null) {
    const client = clientTs.getTime();
    if (client <= server) {
      eventMs = client;
      source = 'client';
    } else {
      eventMs = server;
      source = client - server <= SKEW_TOLERANCE_MS ? 'client' : 'server';
    }
  } else {
    const skew = server - sentAt.getTime();
    if (Math.abs(skew) <= SKEW_TOLERANCE_MS) {
      eventMs = clientTs.getTime();
      source = 'client';
    } else {
      eventMs = clientTs.getTime() + skew;
      source = 'client_shifted';
    }
  }

  if (eventMs > server + SKEW_TOLERANCE_MS) {
    eventMs = server;
    source = 'server';
  }

  return { eventTs: new Date(eventMs), source, tooOld: eventMs < server - TOO_OLD_MS };
}
