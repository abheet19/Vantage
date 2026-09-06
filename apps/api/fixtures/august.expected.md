# august.json — hand-computed expectations

Project timezone `Asia/Kolkata` (UTC+05:30). Every step in `august.json` is posted through the real
`POST /v1/events` / `POST /v1/identify` with the server clock pinned to the step's `server_ts`
(`2026-09-02T00:00:00Z` for every step). The test that asserts these numbers is
`apps/api/test/integration/fixture.spec.ts`; each `it(...)` is named after the row below it checks.

## Persons and their rows (the reviewable part)

| Person | distinct_id(s) | Events (UTC) | Why it is in the fixture |
|--------|----------------|--------------|--------------------------|
| P01 | `p01` | signup 08-03 04:00 · create_project 08-03 05:00 · invite_teammate 08-04 06:00 · view_pricing 08-04 06:30, 08-05 07:00 · view_pricing **2025**-06-01 10:00 | full conversion in 2 days; one event 458 days old → `too_old` |
| P02 | `p02` | signup 08-03 09:00 · view_pricing 08-04 09:30 · create_project 08-12 09:00 · invite_teammate 08-13 10:00 | **no `insert_id`** on any event → all four keys derived; converts at +9 d (14-day window yes, 7-day no) |
| P03 | `p03` | signup 08-05 10:00:00 · view_pricing 08-06, 08-08 · create_project **08-19 10:00:00** (= t1 + 14 d exactly) · invite_teammate 08-19 10:30 | window boundary: exactly 14 d counts (`<=`) |
| P04 | `p04` | signup 08-05 11:00:00 · create_project **08-19 11:00:01** (= t1 + 14 d + 1 s) | one second past the window does not count |
| P05 | `p05` | create_project 08-06 08:00 · signup 08-06 09:00 · invite_teammate 08-06 10:00 · view_pricing 08-07 08:00 | create_project **before** signup: not sequential, counts in `any` |
| P06 | `p06` | signup 08-07 08:00 · view_pricing 08:30 · create_project 09:00 · invite_teammate 09:30 | view_pricing intervenes: sequential yes, strict no |
| P07 | `p07` | signup 08-08 08:00 · signup 08-20 08:00 · create_project 08-23 08:00 | sequential converts only from the **first** signup (+15 d: outside a 14-day window); any order finds the window that starts at the second |
| P08 | `p08` | signup **08-31 18:45Z** · create_project 09-01 02:00Z | 18:45Z = 00:15 IST on **Sep 1**: Sep 1 cohort in Kolkata, Aug 31 in UTC |
| P09 | `anon-9` → `user-9` | anon-9: view_pricing 08-10 07:00, signup 07:10 · user-9: create_project 08-10 08:00, invite_teammate 08-11 08:00 · then `identify(anon-9, user-9)` | identity resolution at query time (V10) |
| P10 | `p10` | signup 08-11 08:00 · create_project 08-11 09:00 (`insert_id: shared-retry-abc`) | first holder of the shared key |
| P11 | `p11` | signup 08-12 08:00 · create_project 08-12 09:00 (`insert_id: shared-retry-abc`) | the retry: **dropped** by `(project_id, insert_id)`; P11 keeps only signup |
| P12 | `p12` | signup 08-14 08:00 · create_project 08-14 08:30, batch `sent_at` = server − 3 h | skew 3 h > 60 s → both shift **forward 3 h** → 11:00, 11:30, `client_shifted` |
| P13 | `p13` | signup **2031**-01-01 · create_project 08-15 10:00 | 2031 → `event_ts = server_ts`, `ts_source: server` |
| P14 | `p14` | signup 08-16 00:00 · 1 000 × view_pricing 08-16 00:01 … 16:40, one per minute (generated) | too many for the paths top-N |
| P15 | `p15` | create_project 08-01 10:00 · signup 08-20 10:00 · create_project 08-21 10:00 | the S2-hardening person: a step redone after a late step 1. Sequential converts from the signup (+1 d); any order must too — the old "spread of first occurrences" (19 d) said it did not |

## Ingest facts (S1 — asserted now)

### Submitted, accepted, duplicates

| Step | Events submitted | Accepted | Duplicates | Reason |
|------|------------------|----------|------------|--------|
| P01–P08 | 30 | 30 | 0 | P01 6 + P02 4 + P03 5 + P04 2 + P05 4 + P06 4 + P07 3 + P08 2 = 30 |
| P09 anon | 2 | 2 | 0 | |
| P09 user | 2 | 2 | 0 | |
| P10/P11 | 4 | **3** | **1** | two events carry `shared-retry-abc`; the second is a no-op under `ON CONFLICT DO NOTHING` |
| P12 | 2 | 2 | 0 | |
| P13 | 2 | 2 | 0 | |
| P14 signup | 1 | 1 | 0 | |
| P14 generated | 1 000 (two batches of 500) | 1 000 | 0 | |
| P15 | 3 | 3 | 0 | loaded last, after the identify, so the V10 numbers below do not see it |
| **Total** | **1 046** | **1 045** | **1** | rows in `events` = 1 045 |

### Replaying the first batch (V1)

Posting the P01–P08 batch again returns `accepted: 0, duplicates: 30` — including P02's four events,
whose keys were **derived** and derive identically on the retry. Posting it three times in total yields
0 new rows and duplicates summing to 60 across the two replays. `count(*)` stays 1 045.

### Timestamp sources

| `ts_source` | Rows | Which |
|-------------|------|-------|
| `client_shifted` | 2 | P12's two events (`event_ts` = client + 3 h: `2026-08-14T11:00:00Z`, `2026-08-14T11:30:00Z`) |
| `server` | 1 | P13's 2031 signup (`event_ts` = `2026-09-02T00:00:00Z`) |
| `client` | 1 042 | everything else |

`too_old` in the P01–P08 response = **1** (P01's 2025-06-01 view_pricing: 458 days before server_ts; still
stored, with `event_ts = 2025-06-01T10:00:00Z`).

### Key sources

`key_source = 'derived'`: **4** rows (all of P02). Every other row (1 041) has `key_source = 'client'`.

### Identity

- Before `identify`: 15 persons, 15 distinct ids (`anon-9` and `user-9` are separate persons; P15 is not
  loaded yet).
- `identify(anon-9, user-9)`: both known, both with exactly one distinct id → tie → `planMerge` keeps the
  person with the lexically smaller `person_id`; response `merged: true, distinct_ids_moved: 1`.
- After the whole load: **15 persons** referenced by `person_distinct_ids` (16 rows; `anon-9` and `user-9`
  now share a `person_id`; P15 is the 16th id); `persons` holds **16** rows, the merged one carrying
  `merged_into` = the survivor (rows are never deleted); and exactly **1** row in `person_merges` whose
  `distinct_ids_moved` is the one-element list of the id that moved (`anon-9` or `user-9` — whichever
  belonged to the lexically larger `person_id`).
- `identify(anon-9, user-9)` again → `merged: false, distinct_ids_moved: 0`, no new `person_merges` row.

## The query range (S2)

Every S2 number below is over `range: { from: 2026-08-01, to: 2026-08-31 }` in the project timezone
`Asia/Kolkata`, which the compiler turns into the UTC half-open interval

```
[2026-07-31T18:30:00Z, 2026-08-31T18:30:00Z)
```

Rows **outside** it, and therefore invisible to every August query: P01's 2025 view_pricing; P08's signup
(`08-31 18:45Z` ≥ `18:30Z`, i.e. Sep 1 IST) and create_project (09-01); P13's clamped signup
(`event_ts = 2026-09-02T00:00Z`). P13's create_project (08-15) IS in range but P13 has no signup in
range, so P13 never enters a signup-first funnel. P15's three rows are all in range (08-01 10:00Z is
15:30 IST on Aug 1). That leaves **1 041** rows in range.

The test that asserts these numbers is `apps/api/test/integration/insights.spec.ts`.

## Funnel (S2): signup → create_project → invite_teammate

### Step 1 — first signup in range, per person

13 persons: P01 P02 P03 P04 P05 P06 P07 P09 P10 P11 P12 P14 P15. (P08 and P13 are out of range; P07's
two signups are one person; P09 is `anon-9` ∪ `user-9` after the identify.) **Step 1 = 13 in every mode.**

### Sequential (first step 1, then earliest step 2 strictly after it within the window, then earliest step 3 after that still within the window from t1)

| Person | t1 (signup) | create_project | Δ from t1 | step 2 (14 d / 7 d) | invite_teammate | Δ from t1 | step 3 (14 d / 7 d) |
|--------|-------------|----------------|-----------|---------------------|-----------------|-----------|---------------------|
| P01 | 08-03 04:00 | 08-03 05:00 | 1 h | ✓ / ✓ | 08-04 06:00 | 26 h | ✓ / ✓ |
| P02 | 08-03 09:00 | 08-12 09:00 | 9 d | ✓ / ✗ | 08-13 10:00 | 10 d 1 h | ✓ / ✗ |
| P03 | 08-05 10:00 | 08-19 10:00 | **14 d exactly** | ✓ (`<=`) / ✗ | 08-19 10:30 | 14 d 30 min | ✗ (past the window from t1) |
| P04 | 08-05 11:00 | 08-19 11:00:01 | **14 d + 1 s** | ✗ / ✗ | — | | ✗ |
| P05 | 08-06 09:00 | 08-06 08:00 | −1 h (**before** signup) | ✗ / ✗ | 08-06 10:00 | | ✗ (chain broke at step 2) |
| P06 | 08-07 08:00 | 08-07 09:00 | 1 h | ✓ / ✓ | 08-07 09:30 | 1 h 30 min | ✓ / ✓ |
| P07 | 08-08 08:00 (**first** signup) | 08-23 08:00 | 15 d | ✗ / ✗ | — | | ✗ |
| P09 | 08-10 07:10 | 08-10 08:00 | 50 min | ✓ / ✓ | 08-11 08:00 | 24 h 50 min | ✓ / ✓ |
| P10 | 08-11 08:00 | 08-11 09:00 | 1 h | ✓ / ✓ | — | | ✗ |
| P11 | 08-12 08:00 | (dropped retry) | | ✗ | | | |
| P12 | 08-14 11:00 (shifted) | 08-14 11:30 (shifted) | 30 min | ✓ / ✓ | — | | ✗ |
| P14 | 08-16 00:00 | — | | ✗ | | | |
| P15 | 08-20 10:00 | 08-21 10:00 (the 08-01 one is before t1) | 1 d | ✓ / ✓ | — | | ✗ |

- **14 days: 13 → 8 → 4.** Step 2 = P01 P02 P03 P06 P09 P10 P12 P15; step 3 = P01 P02 P06 P09.
  Time to convert (t3 − t1): P01 26 h = 93 600 s · P02 241 h = 867 600 s · P06 1.5 h = 5 400 s · P09
  24 h 50 min = 89 400 s → sorted 5 400, 89 400, 93 600, 867 600 → **median 91 500 s**.
- **7 days: 13 → 6 → 3.** Step 2 loses P02 (9 d) and P03 (14 d): P01 P06 P09 P10 P12 P15; step 3 = P01 P06
  P09 → 5 400, 89 400, 93 600 → **median 89 400 s**.
- **Window boundary (V3), two-step funnel signup → create_project:** 13 d → 7 (P01 P02 P06 P09 P10 P12 P15);
  14 d → **8** (P03 enters at exactly +14 d); 15 d → **10** (P04 at +14 d 1 s and P07 at +15 d enter).
- **P07 starts from the first signup in range:** over August the +15 d gap from the 08-08 signup does not
  convert (step 2 = 8 above). With `range.from = 2026-08-09` the 08-20 signup is P07's first in range and
  create_project is +3 d: step 1 = P07 P09 P10 P11 P12 P14 P15 = **7**, step 2 = P07 P09 P10 P12 P15 = **5**.
- **P15's window** (`range 2026-08-20..2026-08-21`, two steps, 14 d): two signups fall in range — P15's
  on 08-20 and P07's second on 08-20 (whose create_project on 08-23 is outside the range) — so step 1 = 2
  and step 2 = **1**, P15, in sequential, strict and any order alike: **2 → 1**.

### Strict (the event right after step k must be step k + 1 — any other event breaks the chain; ties in time are walked in arrival order)

| Person | event after first signup | step 2 | event after create_project | step 3 |
|--------|--------------------------|--------|----------------------------|--------|
| P01 | create_project 05:00 | ✓ | invite_teammate 08-04 06:00 | ✓ |
| P02 | view_pricing 08-04 | ✗ | | |
| P03 | view_pricing 08-06 | ✗ | | |
| P04 | create_project at +14 d 1 s is outside the window, so nothing follows | ✗ | | |
| P05 | invite_teammate 10:00 (create_project was before signup) | ✗ | | |
| P06 | **view_pricing 08:30** | ✗ | | |
| P07 | signup 08-20 (the second signup intervenes) | ✗ | | |
| P09 | create_project 08:00 (view_pricing was before the signup) | ✓ | invite_teammate 08-11 08:00 | ✓ |
| P10 | create_project 09:00 | ✓ | nothing | ✗ |
| P11 | nothing | ✗ | | |
| P12 | create_project 11:30 | ✓ | nothing | ✗ |
| P14 | view_pricing 00:01 | ✗ | | |
| P15 | create_project 08-21 | ✓ | nothing | ✗ |

**14 days and 7 days alike: 13 → 5 → 2** (every strict conversion is within a day). Median over P01
(93 600 s) and P09 (89 400 s) = **91 500 s**.

### Any order (decision 2026-09-05: there is a window of the given length that holds an occurrence of every step 1..k)

Every event of the person is tried as the window's start; the earliest start from which every step
occurs by `start + window` wins, and the time to convert is the spread of the occurrences it chose (the
earliest of each step inside that window). **Definition change:** until 2026-09-05 any order took each
step's FIRST occurrence and asked whether the spread of those firsts fit the window, which made P07 and
P15 fail step 2 (first signup to create_project = 15 d / 19 d) although both convert sequentially — any
order counted fewer persons than sequential order, which the definition cannot mean. Both now count.

| Person | window start that works (14 d) | steps found | steps 1–3 | 14 d | 7 d |
|--------|--------------------------------|-------------|-----------|------|-----|
| P01 | signup 08-03 04:00 | create_project +1 h, invite +26 h | ✓ | 3 | 3 |
| P02 | signup 08-03 09:00 | create_project +9 d, invite +10 d 1 h | ✓ (14 d only) | 3 | 1 (no 7-day window holds signup and create_project) |
| P03 | signup 08-05 10:00 | create_project +14 d exactly; invite at +14 d 30 min is outside | steps 1–2 only | 2 | 1 |
| P04 | signup 08-05 11:00 | create_project at +14 d 1 s is outside | — | 1 | 1 |
| P05 | **create_project 08-06 08:00** | signup +1 h, invite +2 h | ✓ | 3 | 3 |
| P06 | signup 08-07 08:00 | create_project +1 h, invite +1.5 h | ✓ | 3 | 3 |
| P07 | **signup 08-20 08:00** (the second) | create_project +3 d | steps 1–2 | 2 | 2 |
| P09 | signup 08-10 07:10 | create_project +50 min, invite +24 h 50 min | ✓ | 3 | 3 |
| P10 | signup 08-11 08:00 | create_project +1 h | steps 1–2 | 2 | 2 |
| P11 | — | | | 1 | 1 |
| P12 | signup 08-14 11:00 | create_project +30 min | steps 1–2 | 2 | 2 |
| P14 | — | | | 1 | 1 |
| P15 | **signup 08-20 10:00** (the 08-01 create_project starts no window that reaches the signup, 19 d away) | create_project +1 d | steps 1–2 | 2 | 2 |

- **14 days: 13 → 10 → 5.** Step 2 = P01 P02 P03 P05 P06 P07 P09 P10 P12 P15; step 3 = P01 P02 P05 P06
  P09. Spreads of the five converters: 93 600 · 867 600 · 7 200 (P05: 08:00 → 10:00) · 5 400 · 89 400 →
  sorted 5 400, 7 200, 89 400, 93 600, 867 600 → **median 89 400 s**.
- **7 days: 13 → 8 → 4.** Step 2 = P01 P05 P06 P07 P09 P10 P12 P15; step 3 = P01 P05 P06 P09 → 5 400,
  7 200, 89 400, 93 600 → **median 48 300 s**.
- **P05 counts only in any order:** with a 3-hour window and two steps, sequential = 13 → 5 (P01 P06 P09
  P10 P12) and any = 13 → **6** (+ P05, whose create_project is 1 h before the signup; P07's and P15's
  create_projects are days away from their signups, so neither fits 3 hours).
- **P06 is not strict:** with a 90-minute window and two steps, sequential = 13 → 5 (P01 P06 P09 P10 P12)
  and strict = 13 → **4** (P06's view_pricing at 08:30 sits between signup and create_project).
- **Orders nest:** strict (5, 2) ≤ sequential (8, 4) ≤ any (10, 5) at every step; the property test
  holds this for random datasets too.

### Funnel before and after P09's identify (V10)

The identify is the fourth fixture step, so at that moment only P01–P07, `anon-9` and `user-9` exist.
Sequential, 14 days:

| | step 1 | step 2 | step 3 |
|--|--------|--------|--------|
| before identify | P01 P02 P03 P04 P05 P06 P07 + `anon-9` (signup only) = **8** | P01 P02 P03 P06 = **4** (`user-9` has create_project but no signup) | P01 P02 P06 = **3** |
| after identify | the same 8 (`anon-9` ∪ `user-9` is one person) | + P09 = **5** | + P09 = **4** |

The identify changes the funnel by exactly **(0, +1, +1)**.

### Same events, project timezone UTC

August in UTC is `[2026-08-01T00:00Z, 2026-09-01T00:00Z)`: P08's signup (08-31 18:45Z) is now IN range
and its create_project (09-01 02:00Z) is not. Sequential 14 d: **14 → 8 → 4** — one more at step 1 than
the Kolkata project, from the same rows. The Kolkata project's numbers are unchanged by loading the
UTC one (no cross-project leak, V14).

## Retention (S2): day cohorts signup → view_pricing, 14 periods

Cohort day = local (IST) day of each person's first signup in range. Return = any view_pricing on the
day `cohort + n` (`on`) or on any day from `cohort + n` up to the cohort's own horizon `cohort + 14`
(`on_or_after`; decision 2026-09-05 — every cohort is judged over the same 15 days, so an early cohort
cannot look further ahead than a late one just because the range ended later). Activity is read from
range start up to the last day any cohort can reach (Aug 31 + 15 d), and no fixture return event lies
between a cohort's day 14 and that bound, so the horizon change moves no number here.

| Cohort (IST) | Persons | view_pricing days (IST) |
|--------------|---------|-------------------------|
| **Aug 3** | P01 (04:00Z = 09:30 IST), P02 (09:00Z = 14:30 IST) | P01: Aug 4 (06:30Z), Aug 5 (07:00Z) · P02: Aug 4 (09:30Z) |
| **Aug 5** | P03, P04 | P03: Aug 6, Aug 8 · P04: none |
| **Aug 6** | P05 | Aug 7 (08-07 08:00Z = 13:30 IST) |
| Aug 7 | P06 | Aug 7 |
| Aug 8 | P07 | none |
| Aug 10 | P09 | Aug 10 (as `anon-9`, 07:00Z) |
| Aug 11 | P10 | none |
| Aug 12 | P11 | none |
| Aug 14 | P12 (11:00Z shifted = 16:30 IST) | none |
| Aug 16 | P14 (00:00Z = 05:30 IST) | Aug 16 (1 000 events, 05:31–22:10 IST) |
| Aug 20 | P15 (10:00Z = 15:30 IST) | none |

11 cohorts × 15 cells (n = 0…14) = **165 rows**, returned oldest cohort first; cohort sizes sum to 13.
Every cell has `in_progress = false` once the wall clock is past Aug 31 IST + 1 h.

| Cohort | size | mode | n = 0 | 1 | 2 | 3 | 4 … 14 |
|--------|------|------|-------|---|---|---|--------|
| Aug 3 | 2 | on | 0 | **2** (both on Aug 4) | **1** (P01 on Aug 5) | 0 | 0 |
| Aug 3 | 2 | on_or_after | 2 | 2 | 1 | 0 | 0 |
| Aug 5 | 2 | on | 0 | **1** (P03 Aug 6) | 0 | **1** (P03 Aug 8) | 0 |
| Aug 5 | 2 | on_or_after | 1 | 1 | 1 | 1 | 0 |
| Aug 6 | 1 | on | 0 | **1** (Aug 7) | 0 | 0 | 0 |
| Aug 6 | 1 | on_or_after | 1 | 1 | 0 | 0 | 0 |

### The per-cohort horizon (decision 2026-09-05), on a project of its own

`signup` Aug 1 returning Sep 10 (40 d later) and `signup` Aug 31 returning Oct 9 (39 d later), 14
periods, `on_or_after`: **neither is retained in any cell** — both returns are past their cohort's day 14.
(Under the old range-end horizon, Aug 31 + 15 d = Sep 15, the Aug 1 cohort was retained at every n and
the Aug 31 cohort at none: identical behaviour, opposite answers.) A third person, `signup` Aug 31
returning Sep 14 (= day 14 exactly), is retained at every n from 0 to 14.

### Truncation cuts whole cohorts

366 daily cohorts of one person × 31 cells (30 periods) = 11 346 cells > the 10 000 row cap:
`status = truncated`, and the answer is the newest **322** cohorts (322 × 31 = 9 982 ≤ 10 000 < 323 × 31)
with all 31 cells each — 2025-10-15 … 2026-09-01; the 44 oldest are the ones cut. Never a cohort with
some of its cells missing.

### P08 and the timezone (V5)

With `range.to = 2026-09-01` in the Kolkata project, P08 (signup 08-31 18:45Z = **Sep 1 00:15 IST**)
is the **2026-09-01** cohort of size 1 and there is no Aug 31 cohort. In the UTC project with the August
range, P08 is the **2026-08-31** cohort and there is no Sep 1 cohort.

## Count (S2)

| Event, August, Kolkata | persons | events | Why |
|------------------------|---------|--------|-----|
| signup | **13** | **14** | the 13 step-1 persons; P07 signed up twice |
| view_pricing | **7** | **1 008** | P01 2 + P02 1 + P03 2 + P05 1 + P06 1 + P09 1 (as anon-9) + P14 1 000 |
| signup where plan = team | 1 | 1 | P02 |
| signup where plan is set | 2 | 2 | P01 (free), P02 (team) |
| signup where plan ≠ team (unset counts as ≠) | 12 | 13 | everyone but P02 |
| view_pricing where page in (pricing, other) | 1 | 1 000 | only P14's generated rows carry `page` |

## Result footer (S2)

For any August query on the Kolkata project: `data_until = 2026-09-02T00:00:00.000Z` (every step's
pinned `server_ts`); `ts_adjusted_share = 2 / 1 041` (P12's two `client_shifted` rows over the 1 041 rows
in range — P13's `server` row is outside it); `persons_merged_since = 1` — the merge was done at the
wall clock on the day the fixture was loaded, which is at or after Aug 1, and a merge is counted from the
range's START with no upper bound (a merge made yesterday reshapes an August funnel); it is **0** for a
range that starts after that day; `timezone = Asia/Kolkata`; `row_cap = 10 000`; `incomplete_buckets = 0`.

## Trend by day (S6)

Trend buckets an event's occurrences by `date_trunc(unit, event_ts AT TIME ZONE 'Asia/Kolkata')` and
counts either every occurrence (`events`) or the distinct persons behind them (`persons`). Over the August
range, a day with no occurrence produces **no row** (a `GROUP BY`, not a gap-fill). The test is
`apps/api/test/integration/insights-s6.spec.ts`.

### `signup` by day

The 14 in-range signups (§Count above) fall on 11 IST days. P07 signed up twice, on **Aug 8** and **Aug
20**, so the two occurrences land in different day buckets — which is why `events` and `persons` are equal
for every bucket here (no single day holds two of one person's signups):

| IST day | persons | events | who |
|---------|---------|--------|-----|
| Aug 3 | 2 | 2 | P01 (04:00Z = 09:30 IST), P02 (09:00Z = 14:30 IST) |
| Aug 5 | 2 | 2 | P03, P04 |
| Aug 6 | 1 | 1 | P05 |
| Aug 7 | 1 | 1 | P06 |
| Aug 8 | 1 | 1 | P07 (first signup) |
| Aug 10 | 1 | 1 | P09 (as anon-9, 07:10Z) |
| Aug 11 | 1 | 1 | P10 |
| Aug 12 | 1 | 1 | P11 |
| Aug 14 | 1 | 1 | P12 (11:00Z shifted = 16:30 IST) |
| Aug 16 | 1 | 1 | P14 |
| Aug 20 | 2 | 2 | P07 (second signup), P15 |

**11 buckets; events sum to 14, persons-per-bucket sum to 14** (P07 counts in two buckets; the 13 distinct
persons of §Count are a whole-month figure, not a per-day one). P08 (Sep 1 IST) and P13 (clamped to Sep 2)
are out of range. Every bucket has `in_progress = false` once the wall clock is past Aug 20 IST + 1 unit;
`incomplete_buckets = 0`.

### `view_pricing` by day — where `events` and `persons` diverge

view_pricing has 1 008 events over 7 persons in range (§Count). By day:

| IST day | persons | events | who |
|---------|---------|--------|-----|
| Aug 4 | 2 | 2 | P01 (06:30Z), P02 (09:30Z) |
| Aug 5 | 1 | 1 | P01 (07:00Z) |
| Aug 6 | 1 | 1 | P03 |
| Aug 7 | 2 | 2 | P05 (08:00Z), P06 (08:30Z) |
| Aug 8 | 1 | 1 | P03 |
| Aug 10 | 1 | 1 | P09 (as anon-9) |
| **Aug 16** | **1** | **1 000** | P14's generated stream, all on one IST day |

**Aug 16 is the discriminating bucket: 1 000 events, 1 person.** Events sum to 1 008. (P01's 2025
view_pricing is out of range.)

## Paths top transitions from `signup` (S6)

Paths sessionises each person's events by a 30-minute gap, walks forward from the first `signup` in each
session with `lead`, and counts the transition at each step depth (1..`steps`). A transition is keyed by
`(step, from, to)`; `pct_of_start` is over the number of sessions that began a walk at `signup`.

**Start walks = 14** — one per in-range `signup` occurrence (no two signups share a session; P09's session
`[view_pricing 07:00, signup 07:10]` begins a walk at the signup but has no event after it, so it counts as
a start with no transition). Only three persons have an event within 30 minutes after their signup:

- **P06** — `signup 08:00 · view_pricing 08:30 · create_project 09:00 · invite_teammate 09:30` (all 30 min
  apart = one session): steps 1→3 give `signup→view_pricing`, `view_pricing→create_project`,
  `create_project→invite_teammate`.
- **P12** — `signup 11:00 · create_project 11:30` (shifted; exactly 30 min = one session): step 1
  `signup→create_project`.
- **P14** — `signup 00:00` then `view_pricing` every minute: steps 1→5 give `signup→view_pricing` then
  `view_pricing→view_pricing` ×4. The remaining ~995 view_pricing events are never walked — five steps
  from the start, not a thousand (the session-explosion defence, LLD §9).

Everyone else's next event is more than 30 minutes after their signup (P01/P05/P10 at 60 min, P02/P03/P04/
P07/P15 days later), so their signup is alone in its session and yields no transition.

**With `steps = 5`, `total_transitions = 8`, all shown (8 ≤ 50):**

| # | step | from → to | count | % of start | median gap | who |
|---|------|-----------|-------|------------|------------|-----|
| 1 | 1 | signup → view_pricing | 2 | 2/14 = 14.3 % | median(60 s, 1 800 s) = 930 s | P06 (30 min), P14 (1 min) |
| 2 | 1 | signup → create_project | 1 | 1/14 = 7.1 % | 1 800 s | P12 |
| 3 | 2 | view_pricing → create_project | 1 | 7.1 % | 1 800 s | P06 |
| 4 | 2 | view_pricing → view_pricing | 1 | 7.1 % | 60 s | P14 |
| 5 | 3 | create_project → invite_teammate | 1 | 7.1 % | 1 800 s | P06 |
| 6 | 3 | view_pricing → view_pricing | 1 | 7.1 % | 60 s | P14 |
| 7 | 4 | view_pricing → view_pricing | 1 | 7.1 % | 60 s | P14 |
| 8 | 5 | view_pricing → view_pricing | 1 | 7.1 % | 60 s | P14 |

Ranked by `(count desc, step, from, to)`, so `signup → view_pricing` (count 2) leads. **With the default
`steps = 3`, `total_transitions = 6`** — P14's step-4 and step-5 `view_pricing→view_pricing` drop off.

### Sessionisation boundary (S6)

On a project of two persons: one signs up and views pricing **exactly 30 minutes later** (one session → the
transition counts); the other views pricing **31 minutes later** (a new session → the signup is alone → no
transition). Both begin a walk, so `starts = 2` and exactly one transition is returned.
