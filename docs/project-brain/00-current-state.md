# 00 — Current State

## Current release candidate

`v0.10.0-multi-channel-foundation` — 2026-07-15

## Multi-channel foundation

- YouTube Organic source contract, RAW Lark Blueprint, client, adapter, normalization and destination preflight are code-ready but remain `uat_pending`.
- TikTok and YouTube now share Canonical Organic identities/rows/batch/destination planning while platform parsing and identity contracts remain separate.
- Meta Graph transport, WooCommerce/Chatwoot sanitized contracts and Canonical Ads model are present as `planned` foundations without Worker routes.
- No external API, Lark, D1 or Cloudflare resource was mutated. Activation gates are documented in `../multi-channel-foundation-v0.10.0.md`.

## Shared Work/Codex handoff

- `AGENTS.md` is the repository-wide operating contract for ChatGPT Work, Codex, and developers.
- `docs/current-task.md` is the single active task handoff with status, scope, contracts, acceptance criteria, implementation result, and Work review.
- Repository hygiene now requires both files, so a release cannot silently lose shared context.
- The approved six-part foundation is implemented; `docs/current-task.md` records the results and the remaining Live UAT blockers.

## TikTok Organic DEV status

The TikTok Organic DEV pipeline and Report Engine are feature-complete and live-UAT proven:

- TikTok Creator ingestion → `MKT_Content` + cumulative `MKT_Content_Daily`
- Canonical keys, idempotency, reconciliation, D1 lock, retry/DLQ/System Alerts
- Scheduled + incremental sync and 24-hour full reconciliation
- Five-table Report schema, 68 metric definitions, 2 report settings
- Daily/Weekly report generation, fixed-rank Top Content, data-quality status, deterministic completed-period dates
- Daily/Weekly idempotency, partial-baseline behavior, stale-rank cleanup/restore, and report lock collision/retry
- First-write failure versus partial-write behavior covered by deterministic regression tests

Canonical closeout: `../tiktok-organic-dev-complete-v0.9.6.md`; detailed earlier UAT evidence: `../tiktok-organic-dev-closeout-v0.9.0.md`

## Verification

- Node unit/integration: 312/312
- Workers runtime: 6/6
- Focused Report reliability: 51/51
- Architecture: 77 source files / 168 local dependencies / 0 cycles
- Repository hygiene and npm audit 0 passed
- Wrangler 4.110.0 dry-run/deploy: 363.52 KiB / gzip 74.69 KiB; Worker startup 1 ms
- v0.9.6 clean-tree gate: `npm ci`, check/hygiene, unit 312/312, Workers 6/6, Report reliability 51/51, focused View/client 53/53, offline npm audit 0, and Wrangler dry-run 363.52 KiB / gzip 74.69 KiB.
- v0.9.7 workflow gate: unit 312/312, Workers 6/6, Report reliability 51/51, focused View/Lark/build 56/56, Architecture 77/168/0, hygiene pass, npm audit 0, and the same Wrangler bundle because runtime behavior is unchanged.
- v0.10.0 foundation gate: unit 336/336, Workers 6/6, Report reliability 51/51, Architecture 94/189/0, hygiene pass, offline npm audit 0, and Wrangler dry-run 373.71 KiB / gzip 76.31 KiB.

## v0.9.6 closeout baseline

- v0.9.6 packages the live-verified implementation as the clean handoff baseline; it contains no local Wrangler config, secrets, macOS metadata, dependencies, or build artifacts.
- `setup:report-views` installs six managed client-facing Views.
- Live v0.9.0–v0.9.4 attempts failed with generic `1254001`; earlier root-cause claims were hypotheses, not confirmed facts.
- v0.9.5 sends only request fields (`field_id`, `operator`, `value`) and preserves Checkbox values as JSON booleans such as `[true]`.
- The verifier hydrates each managed View through Get View because this tenant's List Views response omits `property`.
- Existing View updates omit `view_name`; Filter and Hidden fields are applied in separate requests.
- Preview compares Filter and Hidden-field state, remains read-only, never deletes Views/records, and safely resumes if Create succeeds before a later mutation fails.
- View OpenAPI has no Sort mutation contract, so the six `rank` sorts and Advanced Permission were completed and verified in Lark UI.
- `enable:tiktok-report-schedules` validates and atomically enables Daily/Weekly report flags in local `wrangler.sync.jsonc`.
- Both tools require explicit Apply command plus `CONFIRM_WRITE=YES` for mutation.

## Live activation status

Client View Apply is complete: all six Views exist, Get View confirms their Filters/Hidden fields, each View uses `rank` ascending with Automatic sorting, and Final Preview reports zero actions/conflicts. Advanced Permissions is enabled with a saved `Client` role: report outputs are View only while Daily, AI technical, Sync/System, and RAW tables are No access. No DEV member is assigned to the role. Schedule flags are enabled and Worker version `ba6f3968-628c-4c61-b7eb-62647b38f547` is deployed. Remaining operational activation is:

1. The first post-deploy cron completed `success` at 22:01 Asia/Bangkok (`skipped=40`, no error). Observe the naturally due Daily/Weekly outputs at their configured times as ongoing operations.

These are deployment/observation steps, not unfinished connector logic.

## Client-facing rule

Clients should not use RAW tables, `MKT_Content_Daily`, Sync Log, System Alerts, cursor, lock, or technical IDs as normal working views. Client roles use the six managed Report Views. Production permissions belong to the customer's Lark organization.

## Next implementation workstream

Run YouTube DEV access/identity preflight, review/apply its RAW schema, and perform Manual Live UAT before activating its route. Open Meta/WooCommerce/Chatwoot access in parallel. See `10-next-actions.md`.
