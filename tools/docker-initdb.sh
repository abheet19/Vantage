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
: "${VANTAGE_OWNER_PASSWORD:?set VANTAGE_OWNER_PASSWORD for the postgres service}"
: "${VANTAGE_APP_PASSWORD:?set VANTAGE_APP_PASSWORD for the postgres service}"
: "${VANTAGE_READER_PASSWORD:?set VANTAGE_READER_PASSWORD for the postgres service}"

# 1) The database (CREATE DATABASE cannot run inside db-setup.sql's transaction/DO blocks).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
	-c "CREATE DATABASE \"${VANTAGE_DB_NAME}\";"

# 2) The three roles + hardening, from the repo's db-setup.sql with the passwords supplied as psql vars.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
	-v set_passwords=true \
	-v owner_password="$VANTAGE_OWNER_PASSWORD" \
	-v app_password="$VANTAGE_APP_PASSWORD" \
	-v reader_password="$VANTAGE_READER_PASSWORD" \
	-v database="$VANTAGE_DB_NAME" \
	-f /vantage/db-setup.sql

echo "vantage: roles created and database '${VANTAGE_DB_NAME}' hardened; the API will apply migrations + grants at boot."
