# Vantage — sanity, acceptance, and release guide

> Snapshot: 10 September 2026 IST. Run this against disposable or synthetic data. Save the branch, commit, complete dirty-path list, command, exit code, environment, and artifact hashes with every result.

## Before running

Use the checked disposable PostgreSQL harness and fixture. Do not point tests at production data. Record runtime mode (`VANTAGE_LLM`) because deterministic none-adapter evidence cannot support hosted/local-model claims.

```powershell
Set-Location 'D:\Code\Vantage'
npm ci
npm run docs:check
npm run check
npm run bench
npm run build
npm run web:build
docker build -t vantage-local .
```

## Product sanity checklist

- [ ] Retry one event insert and prove no double count; verify normalization, identity merge, time zone, and watermark semantics.
- [ ] Ask supported/unsupported/hostile questions; inspect typed spec, edit/run/cancel, parameterized SELECT, role/timeout, result, and audit history.
- [ ] Run funnel, retention, trend, paths, and count against the hand-computed August fixture.
- [ ] Create/select projects, rotate/copy key once, switch snippets, load fixture, inspect Events, and exercise errors/empty states.
- [ ] Run the real stdio MCP protocol suite and verify no generic SQL/model Ask tool exists.
- [ ] Keyboard-navigate all ten routes and complete the 320 px mobile path without overflow or unnamed controls.
- [ ] Verify auth refusal, payload-safe logs, `/health`, migrations, and clean dependency audit.

## Retained evidence for the current release

- `docs/VERIFICATION.md`: 832-case local gate, all-CTA/320 px browser audit, benchmark, bounded Lighthouse, dependency resolution, and explicit limits.
- `verification-work/portfolio-release-20260910/VANTAGE_RELEASE_SIGNOFF.md`: exact local/public/live SHA, Fly image/release/machine, and post-deploy smoke.
- `/health.release_sha` must equal `git rev-parse HEAD` and `git ls-remote origin main refs/heads/main`; a 200 response without this equality is not release proof.

## Release sequence

1. Review the intended delta and freeze one commit.
2. Run docs/check/bench/build/image and migration rehearsal at that commit.
3. Confirm secret names and backup/restore plan without exposing values.
4. Deploy with approval; record source, CI, image, release, machine, runtime mode, post-deploy flows, and rollback image.

## Claims this guide does not establish

- No free-form model quality claim from `VANTAGE_LLM=none`.
- No tenant isolation, arbitrary SQL, public capacity, field Core Web Vitals, or database recovery proof.
- A local candidate is not a release until CI, image/release metadata, `/health.release_sha`, and post-deploy probes all map to its exact SHA.

A green local run is evidence for the exact tested tree. Call a feature deployed only after recording `source commit -> CI run -> image/release -> post-deploy smoke` for the same bytes.
