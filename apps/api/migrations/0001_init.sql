-- 0001_init.sql — LLD §2, applied forward-only by MigrationRunner as vantage_owner.
--
-- Why it exists: the whole schema in one reviewed file, so the fixture test in CI runs against exactly
-- what production has. One deviation from the LLD's text: PostgreSQL does not allow a subquery inside a
-- CHECK constraint ("cannot use subquery in check constraint"), so the timezone check calls a STABLE
-- SQL function that performs the same pg_timezone_names lookup. The intent is preserved and now
-- actually enforced by the database as well as by the app.
--
-- What it must never do: create roles (tools/db-setup.ps1 owns them), grant privileges (migrations/grants.sql
-- owns them and is re-applied after every run), or be edited after it has been applied anywhere — the
-- runner checksums it and refuses to start on a mismatch.

CREATE FUNCTION vantage_is_timezone(tz text) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) $$;

CREATE TABLE projects (
  project_id     uuid PRIMARY KEY,
  name           text NOT NULL,
  timezone       text NOT NULL CHECK (vantage_is_timezone(timezone)),   -- validated in app; CHECK documents intent
  api_key_hash   text NOT NULL UNIQUE,            -- sha256 of the key; the key is shown once
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  project_id  uuid NOT NULL REFERENCES projects,
  person_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE person_distinct_ids (
  project_id   uuid NOT NULL,
  distinct_id  text NOT NULL CHECK (length(distinct_id) BETWEEN 1 AND 200),
  person_id    uuid NOT NULL,
  PRIMARY KEY (project_id, distinct_id),
  FOREIGN KEY (project_id, person_id) REFERENCES persons
);
-- Index reason: the identity join in EVERY query (design §3.5). PK is (project_id, distinct_id);
-- INCLUDE makes the join index-only.
CREATE INDEX pdi_lookup ON person_distinct_ids (project_id, distinct_id) INCLUDE (person_id);

CREATE TABLE person_merges (
  project_id  uuid NOT NULL, merged_at timestamptz NOT NULL DEFAULT now(),
  from_person uuid NOT NULL, into_person uuid NOT NULL, distinct_ids_moved int NOT NULL, reason text NOT NULL
);

CREATE TABLE events (
  project_id   uuid NOT NULL REFERENCES projects,
  event_id     uuid NOT NULL,                       -- UUIDv7 minted by the server: time-ordered, so the heap is append-ordered
  insert_id    text NOT NULL CHECK (length(insert_id) BETWEEN 1 AND 64),   -- ⟨D1⟩
  distinct_id  text NOT NULL CHECK (length(distinct_id) BETWEEN 1 AND 200),
  event        text NOT NULL CHECK (length(event) BETWEEN 1 AND 200),
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(properties) <= 65536),
  client_ts    timestamptz,
  sent_at      timestamptz,
  server_ts    timestamptz NOT NULL,
  event_ts     timestamptz NOT NULL,
  ts_source    text NOT NULL CHECK (ts_source IN ('client','client_shifted','server')),
  key_source   text NOT NULL CHECK (key_source IN ('client','derived')),
  PRIMARY KEY (project_id, event_id)
);
-- Index reasons, each tied to a query (design §3.5):
CREATE UNIQUE INDEX events_dedupe ON events (project_id, insert_id);                       -- §2: idempotency; ON CONFLICT target
CREATE INDEX events_funnel ON events (project_id, event, event_ts) INCLUDE (distinct_id);  -- every `e` CTE, trend, paths start: index-only range scans per event name
CREATE INDEX events_ts_brin ON events USING brin (event_ts) WITH (pages_per_range = 64);   -- cheap range pruning; heap is append-ordered by v7 ids
-- Deliberately absent: an index on properties (GIN). Breakdowns are capped at 50 values and filtered after the range scan; a GIN index is the v2 answer if EXPLAIN says so.

CREATE TABLE asks (                                    -- the audit log (design §4.2 L4); append-only, no UPDATE grant to anyone but migrations
  ask_id        uuid PRIMARY KEY,
  project_id    uuid NOT NULL,
  asked_at      timestamptz NOT NULL DEFAULT now(),
  question      text NOT NULL,
  adapter       text NOT NULL,                        -- anthropic | ollama | none | mcp-client
  raw_output    text,                                 -- verbatim model text; null for MCP (the spec arrived directly)
  spec          jsonb,                                -- the validated QuerySpec, if any
  sql           text,                                 -- the exact SQL executed, if any
  decision      text NOT NULL CHECK (decision IN ('ran','refused','refused_by_database','error')),
  status        text,                                 -- complete | empty | timed_out | truncated
  elapsed_ms    int,
  error_code    text
);
CREATE INDEX asks_recent ON asks (project_id, asked_at DESC);   -- the Ask history screen

CREATE TABLE schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL);

-- Roles (created by tools/db-setup.ps1, idempotent; the app never creates roles):
--   vantage_owner   owns all tables; runs migrations only
--   vantage_app     INSERT on events, persons, person_distinct_ids, person_merges, asks; SELECT on projects, person_distinct_ids, persons; UPDATE on person_distinct_ids (merge); no DELETE, no DDL
--   vantage_reader  SELECT on events, persons, person_distinct_ids, projects, asks; nothing else
--   ALTER ROLE vantage_reader SET default_transaction_read_only = on; ALTER ROLE vantage_reader SET statement_timeout = '5s';
--   ALTER ROLE vantage_app    SET statement_timeout = '30s';
