#!/bin/sh
# docker-initdb.sh — first-boot role + database setup for the postgres:17 container.
#
# The postgres image runs files in /docker-entrypoint-initdb.d/ once, on an empty data dir, as the
# superuser. This wrapper is the "adapting" the deploy calls for: tools/db-setup.sql (the single source of
# truth for the three roles and the database-level hardening) uses psql :'…'/:"…" variables, which the
# image's bare-.sql runner cannot supply, so db-setup.sql is mounted OUTSIDE initdb.d (at /vantage/) and
# this script feeds it the variables from the environment. Table privileges are NOT here — they need the
# tables, so grants.sql is applied later by the API's migration runner as vantage_owner (LLD §2/§10).
set -eu

: "${VANTAGE_DB_NAME:=vantage}"

# This local container runs with POSTGRES_HOST_AUTH_METHOD=trust (compose): the database is on the
# internal compose network only, never published, so the three roles are created WITHOUT passwords and
# authenticate by trust. No secret is stored in the repo. A real deployment does the opposite — it runs
# db-setup.sql itself with `set_passwords=true` and real passwords supplied out-of-band (docs/DEPLOY.md).

# 1) The database (CREATE DATABASE cannot run inside db-setup.sql's transaction/DO blocks).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
	-c "CREATE DATABASE \"${VANTAGE_DB_NAME}\";"

# 2) The three roles + hardening, from the repo's db-setup.sql. Passwords are NOT set (trust auth locally).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
	-v set_passwords=false \
	-v database="$VANTAGE_DB_NAME" \
	-f /vantage/db-setup.sql

echo "vantage: roles created (trust auth, no passwords) and database '${VANTAGE_DB_NAME}' hardened; the API will apply migrations + grants at boot."
