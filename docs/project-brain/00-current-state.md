# 00 — Current State

## Current release candidate

`v0.9.5-lark-view-live-verified` — 2026-07-14

## TikTok Organic DEV status

The TikTok Organic DEV pipeline and Report Engine are feature-complete and live-UAT proven:

- TikTok Creator ingestion → `MKT_Content` + cumulative `MKT_Content_Daily`
- Canonical keys, idempotency, reconciliation, D1 lock, retry/DLQ/System Alerts
- Scheduled + incremental sync and 24-hour full reconciliation
- Five-table Report schema, 68 metric definitions, 2 report settings
- Daily/Weekly report generation, fixed-rank Top Content, data-quality status, deterministic completed-period dates
- Daily/Weekly idempotency, partial-baseline behavior, stale-rank cleanup/restore, and report lock collision/retry
- First-write failure versus partial-write behavior covered by deterministic regression tests

Detailed evidence: `../tiktok-organic-dev-closeout-v0.9.0.md`

## Verification

- Node unit/integration: 312/312
- Workers runtime: 6/6
- Focused Report reliability: 51/51
- Architecture: 77 source files / 168 local dependencies / 0 cycles
- Repository hygiene and npm audit 0 passed
- Wrangler 4.110.0 dry-run: 362.96 KiB / gzip 74.63 KiB
- Clean extracted-ZIP retest remains the final package gate

## v0.9.5 closeout tooling

- `setup:report-views` installs six managed client-facing Views.
- Live v0.9.0–v0.9.4 attempts failed with generic `1254001`; earlier root-cause claims were hypotheses, not confirmed facts.
- v0.9.5 sends only request fields (`field_id`, `operator`, `value`) and preserves Checkbox values as JSON booleans such as `[true]`.
- The verifier hydrates each managed View through Get View because this tenant's List Views response omits `property`.
- Existing View updates omit `view_name` and `hidden_fields`; missing Views are created first, then filtered separately.
- Hidden fields and `rank` sort are manual Lark UI actions. The installer reports exact field names per View.
- Preview compares only Filter state, remains read-only, never deletes Views/records, and safely resumes if Create succeeds before Filter PATCH fails.
- `enable:tiktok-report-schedules` validates and atomically enables Daily/Weekly report flags in local `wrangler.sync.jsonc`.
- Both tools require explicit Apply command plus `CONFIRM_WRITE=YES` for mutation.

## Live activation status

Client View Apply is complete: all six Views exist, Get View confirms their Filters, and Final Preview reports zero actions/conflicts. Remaining operational activation is:

1. Hide the fields listed by `VIEW_HIDDEN_FIELDS_REVIEW_REQUIRED` and set rank ascending in the six managed Views.
2. Enable report schedule flags through the guarded activator.
3. Deploy `wrangler.sync.jsonc` and observe scheduled Daily/Weekly producers.

These are deployment/observation steps, not unfinished connector logic.

## Client-facing rule

Clients should not use RAW tables, `MKT_Content_Daily`, Sync Log, System Alerts, cursor, lock, or technical IDs as normal working views. Client roles use the six managed Report Views. Production permissions belong to the customer's Lark organization.

## Next implementation workstream

After activation, proceed to Lark AI Summary + Group Notification, then start connector access/preflight and implementation for YouTube, Meta (Facebook/Instagram), WooCommerce, Chatwoot, and Ads. See `10-next-actions.md`.
