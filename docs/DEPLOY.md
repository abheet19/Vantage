# Deploying Vantage

## Current existing app — 2026-09-10

Routine releases target **`vantage-abheet`** in `sin`; do not run first-install app/database/volume creation again. From this repository, after passing `npm run check` and `npm run docs:check`:

```powershell
$releaseSha = git rev-parse HEAD
if ($releaseSha -notmatch '^[0-9a-f]{40}$') { throw 'Expected a full Git commit' }
fly deploy --app vantage-abheet --remote-only --depot=false --build-arg "VANTAGE_RELEASE_SHA=$releaseSha"
fly status --app vantage-abheet
fly checks list --app vantage-abheet
fly logs --app vantage-abheet --no-tail
$health = Invoke-RestMethod 'https://vantage-abheet.fly.dev/health'
if (-not $health.ok -or $health.release_sha -ne $releaseSha) { throw 'Live release does not match reviewed source' }
```

The commands below this section describe bootstrap/self-hosting. GitHub release automation waits for successful CI on main, builds its exact `head_sha`, and passes that SHA into the container. It does not deploy every unvalidated push. `/health.release_sha` is the executable receipt; compare it with public `origin/main`, not a mutable image tag. The pre-commit hook runs lint/typecheck; the full suite is a separate local/CI gate. See [current verification](VERIFICATION.md) for executed scope.

For rollback, record the previous image reference before releasing and use `fly deploy --app vantage-abheet --image <previous-image-reference>` if needed. Image rollback does not roll back persistent data/migrations. That recovery command was documented, not exercised. `fly secrets list` reveals names only; it cannot retrieve secret values.


Vantage ships as **one container** behind **one port**. Inside it, the NestJS API listens on loopback
(`127.0.0.1:4100`, unchanged — decision D4) and [Caddy](https://caddyserver.com) is the only thing on the
public port: it serves the built web dashboard (SPA, with deep-link fallback) and reverse-proxies the API
paths (`/v1/*` and `/health`) to the loopback API. The API's port is never published. The pieces:

- [`Dockerfile`](../Dockerfile) — multi-stage: build the API + web bundle, then a slim `node:22-slim`
  runtime with a static `caddy` binary lifted from `caddy:2-alpine`.
- [`Caddyfile`](../Caddyfile) — the edge: SPA + `reverse_proxy` of `/v1/*` and `/health`.
- [`docker-entrypoint.sh`](../docker-entrypoint.sh) — starts the API, waits for it, hands PID 1 to Caddy.
- [`docker-compose.yml`](../docker-compose.yml) — `postgres:17` + the app image; the one-command path.
- [`fly.toml`](../fly.toml) — the Fly.io service (Caddy port, `force_https`, one always-on machine).

## The security gate — `VANTAGE_QUERY_TOKEN`

By design the query/ask/insights routes are unauthenticated and the API binds to loopback (D4). Hosting it
on a public URL breaks that assumption, so **`VANTAGE_QUERY_TOKEN`** closes the gap:

- **Unset (or empty)** → today's exact behaviour: the read routes are open (loopback-only honesty).
- **Set (≥ 16 chars)** → every read route — `POST /v1/{funnel,retention,trend,paths,count}`, `POST /v1/ask`,
  `GET /v1/asks`, `GET /v1/events/catalog` — requires `Authorization: Bearer <that token>`; a missing or
  wrong token is `401 {"code":"INVALID_QUERY_TOKEN", ...}`.

It is a **single shared read token** for the whole instance, **not a project key**. Ingest keeps its own
per-project key (`POST /v1/events` / `POST /v1/identify`, `Authorization: Bearer <project key>`); the two
mechanisms are independent. `/health` is intentionally left open so orchestrator/health probes work — it
exposes no analytics data. Generate a token with e.g. `openssl rand -hex 32`, and keep it in a secrets
store (Fly secrets) or a git-ignored `.env`, never in the image.

## The project-admin gate — `VANTAGE_ADMIN_TOKEN`

The query token protects the analytics **read** surface. Project **administration** is a separate write
surface — `POST /v1/projects` (create a project) and `POST /v1/projects/:id/rotate-key` (rotate a project's
ingest key) — which is likewise unauthenticated under D4. On a public deployment that would be an open
project-admin surface: any visitor could create projects or rotate someone's ingest key. **`VANTAGE_ADMIN_TOKEN`**
closes that gap, mirroring the read gate exactly:

- **Unset (or empty)** → today's exact behaviour: create and rotate-key are open (loopback-only honesty).
- **Set (≥ 16 chars)** → each of `POST /v1/projects` and `POST /v1/projects/:id/rotate-key` requires
  `Authorization: Bearer <that token>`; a missing or wrong token is `401 {"code":"INVALID_ADMIN_TOKEN", ...}`.

It is a **single shared admin token** for the whole instance, **independent** of both `VANTAGE_QUERY_TOKEN`
and the per-project ingest key. Only these two write routes are gated: `GET /v1/projects` (list) stays open —
it exposes only project ids/names and the dashboard needs it — as do all the read/insights/ask/audit/events
routes, ingest, identify, and `/health`. Generate a token with e.g. `openssl rand -hex 32` and keep it in a
secrets store (Fly secrets) or a git-ignored `.env`.

> A public read-only demo should set `VANTAGE_ADMIN_TOKEN` (leave `VANTAGE_QUERY_TOKEN` unset if you want
> reads open to visitors). With it set, the dashboard's **create-project** and **rotate-key** controls will
> return `401 INVALID_ADMIN_TOKEN` for visitors who don't hold the token — that is intended: the demo stays
> read-only while you can still administer projects by supplying the token yourself.

## (a) Local / self-host with Docker Compose

One command brings up Postgres + the app. On first boot the Postgres container creates the three roles
(`vantage_owner` / `vantage_app` / `vantage_reader`) and the `vantage` database from
[`tools/db-setup.sql`](../tools/db-setup.sql) (via `tools/docker-initdb.sh`), and the API applies
migrations + grants at boot (its owner URL is set). The local Postgres runs with **trust auth** on the
internal-only compose network, so the roles have **no passwords** and nothing secret lives in the repo.
Reads are **open locally** (`VANTAGE_QUERY_TOKEN` unset); to require a bearer locally, set it in a
git-ignored `.env` beside the compose file. A real deployment uses real passwords + Fly secrets (below).

```sh
docker compose up -d --build          # build the image and start db + app
docker compose logs -f app            # watch: migrations, self-test, "read routes: require VANTAGE_QUERY_TOKEN"
```

Load the hand-checked fixture into the container's database (1046 submitted / 1045 accepted / 1 duplicate),
which prints the fixture project id:

```sh
docker compose exec app sh -c 'node apps/api/dist/fixture-load.js'
# → fixture loaded into project <PROJECT_ID> (Asia/Kolkata): 1046 submitted, 1045 accepted, 1 duplicates, 1 identify
```

The default Compose setup leaves `VANTAGE_QUERY_TOKEN` unset, so local reads are open. If you explicitly set the token, the same request without a bearer returns `401 INVALID_QUERY_TOKEN` and the request with the shared bearer succeeds:

```sh
PID=<PROJECT_ID>
BODY='{"kind":"funnel","project":"'$PID'","range":{"from":"2026-08-01","to":"2026-08-31"},"steps":[{"event":"signup"},{"event":"create_project"},{"event":"invite_teammate"}]}'

# default (VANTAGE_QUERY_TOKEN unset) → 200
curl -s -X POST http://localhost:8080/v1/funnel -H 'content-type: application/json' -d "$BODY"

# protected mode (VANTAGE_QUERY_TOKEN set) → supply that shared bearer for 200
curl -s -X POST http://localhost:8080/v1/funnel \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer local-dev-query-token-change-me' \
  -d "$BODY"
```

The dashboard is at `http://localhost:8080/`. Tear down with `docker compose down` (add `-v` to also drop
the database volume).

## (b) Go live on Fly.io

Fly terminates TLS and routes to Caddy's `internal_port` (8080); `force_https` is on and one machine stays
running (`min_machines_running = 1`). The database URLs and the query token are **secrets**, never baked
into the image.

1. **Create the app** (matches `app = "vantage-abheet"` in `fly.toml`):

   ```sh
   fly apps create vantage-abheet
   ```

2. **Provision Postgres** — either a Fly Postgres app or any reachable Postgres 17:

   ```sh
   fly postgres create --name vantage-db --region iad
   fly postgres attach vantage-db --app vantage-abheet        # sets DATABASE_URL as the superuser
   ```

3. **Create the three roles + the `vantage` database in it.** This is the fiddly step, and it is honestly
   manual: the roles are defined once in [`tools/db-setup.sql`](../tools/db-setup.sql), which uses psql
   `:'…'` / `:"…"` variables, so you run it yourself as the superuser and supply the passwords. Connect and
   run it (paste the file's contents, or `\i` it if you upload it):

   ```sh
   fly postgres connect -a vantage-db
   -- then, in the psql session (choose real passwords):
   CREATE DATABASE vantage;
   \c postgres
   \set set_passwords true
   \set owner_password  'REPLACE_owner_pw'
   \set app_password    'REPLACE_app_pw'
   \set reader_password 'REPLACE_reader_pw'
   \set database vantage
   \i db-setup.sql      -- or paste the contents of tools/db-setup.sql here
   ```

   (Table privileges are NOT in `db-setup.sql` — the API applies `grants.sql` as `vantage_owner` at boot.)

4. **Set the secrets** — the three role URLs (pointing at your Postgres host), the shared read token, and
   the shared admin token (so visitors cannot create projects or rotate ingest keys):

   ```sh
   fly secrets set \
     VANTAGE_DATABASE_URL_RW='postgres://vantage_app:REPLACE_app_pw@vantage-db.internal:5432/vantage' \
     VANTAGE_DATABASE_URL_RO='postgres://vantage_reader:REPLACE_reader_pw@vantage-db.internal:5432/vantage' \
     VANTAGE_DATABASE_URL_OWNER='postgres://vantage_owner:REPLACE_owner_pw@vantage-db.internal:5432/vantage' \
     VANTAGE_QUERY_TOKEN="$(openssl rand -hex 32)" \
     VANTAGE_ADMIN_TOKEN="$(openssl rand -hex 32)"
   ```

   For a **public read-only demo** where reads should stay open to visitors, set only
   `VANTAGE_ADMIN_TOKEN` and leave `VANTAGE_QUERY_TOKEN` unset — the read routes answer without a token
   while create/rotate require the admin bearer.

   With the owner URL set, the API migrates at boot; drop it later if you prefer to migrate out of band.

5. **Deploy**:

   ```sh
   fly deploy --build-arg "VANTAGE_RELEASE_SHA=$(git rev-parse HEAD)"
   ```

   Then browse `https://vantage-abheet.fly.dev/` and curl a funnel exactly as above, against your Fly URL with the
   token you set. Inspect configured secret names with `fly secrets list` — the values are write-only,
   so store it when you set it.

## Enabling automatic deploys (CI/CD)

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds and pushes
`ghcr.io/abheet19/vantage:{latest,sha}` after successful CI on `main` (using the built-in `GITHUB_TOKEN`), then
deploys to Fly **only if** a `FLY_API_TOKEN` repository secret exists. (The `secrets` context is not usable
in a job `if:`, so a `gate` job reads the secret into an output and the `deploy` job keys off that output.)
The existing test gate in `ci.yml` is untouched.

To turn on the deploy:

```sh
fly tokens create deploy -x 999999h            # a deploy-scoped token
# GitHub → repo → Settings → Secrets and variables → Actions → New repository secret
#   Name: FLY_API_TOKEN   Value: <the token>
```

Without that secret the workflow still builds and publishes the image; it just skips the deploy job.

## Free-tier reality (honest)

- Fly.io no longer has a blanket free allowance; a single `shared-cpu-1x` / 256–512 MB machine plus a small
  Postgres is inexpensive but **not free**, and a Postgres app is itself a billable machine + volume.
- `auto_stop_machines = false` / `min_machines_running = 1` keeps the app warm (no cold-start on the loopback
  API and its pools) — that also means it is always billing. Flip to `auto_stop_machines = true` and
  `min_machines_running = 0` to let it scale to zero and sleep between requests if cost matters more than
  the first-request latency; the self-test + migration check then run on each cold start.
- The published image (`ghcr.io/abheet19/vantage`) is public and free to pull; you can also just run
  `docker compose up` on any host (a $5 VPS) instead of Fly and get the same one-URL app.
