-- grants.sql — the whole truth about the two runtime roles' privileges; re-applied by MigrationRunner after every run.
--
-- Why it exists: roles are created by tools/db-setup.ps1 before any table exists and GRANT needs the
-- table, so roles live in db-setup and privileges live here, applied as vantage_owner. The file starts
-- by REVOKING everything from both roles so it is a description, not a lower bound: a GRANT added by
-- hand on the live database disappears on the next migration run, and the boot self-test
-- (infra/self-test.ts) compares the live catalog to this same list and refuses to start on a difference
-- in either direction.
--
-- What it must never do: give vantage_reader anything but SELECT; give vantage_app DELETE, whole-row
-- UPDATE or DDL; grant UPDATE on `asks` to anyone (the audit log is append-only); or be applied on a
-- cluster older than PostgreSQL 15, where `public` is not owned by the database owner.
--
-- Beyond the LLD §2 role table (each recorded in 00-GATES.md):
--   E1  vantage_app: INSERT on projects (ProjectsModule writes through the RW pool) and column-level SELECT
--       on events (project_id, insert_id) — PostgreSQL needs SELECT on the arbiter columns for ON CONFLICT.
--   E2  both roles: SELECT on schema_migrations, for /health and the boot schema check.
--   S1 hardening: UPDATE is column-level — person_distinct_ids.person_id (the merge repoint) and
--       persons.merged_into (the merge pointer, migration 0002); nothing else on either table is writable.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vantage_app, vantage_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, vantage_app, vantage_reader;
GRANT USAGE ON SCHEMA public TO vantage_app, vantage_reader;

GRANT INSERT ON projects, events, persons, person_distinct_ids, person_merges, asks TO vantage_app;
GRANT SELECT ON projects, persons, person_distinct_ids, schema_migrations TO vantage_app;
GRANT SELECT (project_id, insert_id) ON events TO vantage_app;
GRANT UPDATE (person_id) ON person_distinct_ids TO vantage_app;
GRANT UPDATE (merged_into) ON persons TO vantage_app;
-- S8: rotate-key replaces a project's api_key_hash in place (POST /v1/projects/:id/rotate-key); column-level, so
-- vantage_app still cannot change a project's name or timezone, only its credential.
GRANT UPDATE (api_key_hash) ON projects TO vantage_app;

-- S2: the reader also reads person_merges — every result footer reports `persons_merged_since` (design §1.3).
GRANT SELECT ON events, persons, person_distinct_ids, person_merges, projects, asks, schema_migrations TO vantage_reader;
