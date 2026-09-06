-- db-setup.sql — the three Vantage roles and the database-level hardening, idempotently. Applied by
-- tools/db-setup.ps1 (psql, as a superuser, once the database exists) and by the integration-test
-- harness (which substitutes the :'…' and :"…" variables itself).
--
-- Why it exists: LLD §2 and §10 — roles are defined in exactly one place, the app never creates them,
-- and the boot self-test checks the live effect of what this file sets. Table privileges are NOT here:
-- they need the tables, so they live in apps/api/migrations/grants.sql and are applied by the migration
-- runner as vantage_owner. The database is owned by vantage_owner and PUBLIC loses TEMP, so neither
-- runtime role can create even a temporary table; the self-test's privilege matrix asserts both.
--
-- What it must never do: grant SUPERUSER, CREATEDB or CREATEROLE to any Vantage role, give
-- vantage_reader anything but LOGIN, or contain a password literal (they arrive as psql variables).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vantage_owner') THEN
    CREATE ROLE vantage_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vantage_app') THEN
    CREATE ROLE vantage_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vantage_reader') THEN
    CREATE ROLE vantage_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

\if :set_passwords
ALTER ROLE vantage_owner  PASSWORD :'owner_password';
ALTER ROLE vantage_app    PASSWORD :'app_password';
ALTER ROLE vantage_reader PASSWORD :'reader_password';
\endif

-- LLD §2: the reader is read-only by default and bounded to 5 s; the app is bounded to 30 s. These are
-- session DEFAULTS, not caps — a session may SET them off — so QueryRunner re-asserts the timeout inside
-- its READ ONLY transaction (design §4.2 note); the grants are the boundary.
ALTER ROLE vantage_reader SET default_transaction_read_only = on;
ALTER ROLE vantage_reader SET statement_timeout = '5s';
ALTER ROLE vantage_app    SET statement_timeout = '30s';

ALTER DATABASE :"database" OWNER TO vantage_owner;
REVOKE TEMP ON DATABASE :"database" FROM PUBLIC;
