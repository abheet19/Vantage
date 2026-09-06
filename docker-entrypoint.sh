#!/bin/sh
# docker-entrypoint.sh — start the loopback API, wait for it, then hand PID 1 to Caddy (the public edge).
#
# The API applies pending migrations at boot when VANTAGE_DATABASE_URL_OWNER is set (database.module.ts),
# so no separate migrate step is needed as long as the owner URL is provided (compose/Fly do). If the
# owner URL is absent the API only verifies the schema and refuses to boot on a mismatch — run migrations
# yourself first in that case.
#
# The API binds 127.0.0.1 inside the container (VANTAGE_BIND, unchanged ⟨D4⟩); Caddy is the only thing on
# the published port. If the API dies during startup we exit non-zero so the orchestrator restarts us.
set -eu

API_PORT="${VANTAGE_PORT:-4100}"

node --env-file-if-exists=/app/.env /app/apps/api/dist/main.js &
API_PID=$!

# Wait until the API's loopback health route answers (boot runs migrations + the self-test, a few seconds).
ready=0
i=0
while [ "$i" -lt 90 ]; do
	if ! kill -0 "$API_PID" 2>/dev/null; then
		echo "vantage: API process exited during startup" >&2
		wait "$API_PID" || true
		exit 1
	fi
	if node -e "require('http').get({host:'127.0.0.1',port:${API_PORT},path:'/health',timeout:2000},r=>process.exit(0)).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})" 2>/dev/null; then
		ready=1
		break
	fi
	i=$((i + 1))
	sleep 1
done

if [ "$ready" -ne 1 ]; then
	echo "vantage: API did not become ready in time" >&2
	kill "$API_PID" 2>/dev/null || true
	exit 1
fi

echo "vantage: API is up on 127.0.0.1:${API_PORT}; starting Caddy on 0.0.0.0:${PORT:-8080}"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
