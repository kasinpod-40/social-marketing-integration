# TikTok Organic DEV Complete — v0.9.6

## Release purpose

This is the clean handoff baseline for the completed TikTok Organic DEV implementation. It promotes the live-verified v0.9.5 code and operational setup without changing the proven report calculations or external contracts.

## Completed implementation

- TikTok Creator ingestion, canonical keys, normalization, and cumulative Daily snapshots.
- Scheduled five-minute sync, incremental checkpoint/fingerprint processing, and periodic full reconciliation.
- D1 distributed lock, lease renewal, retry, DLQ, Sync Log, System Alerts, and reconciliation recovery.
- Five-table Report schema, 68 metric definitions, Daily/Weekly report settings, 13 report metrics, and five fixed Top Content slots.
- Daily and Weekly generation, stable report IDs, idempotent upsert, partial-baseline handling, stale-rank neutralization, and restoration.
- Report lock collision and retry safety; deterministic tests cover first-write failure and partial-write recovery without destructive live corruption.
- Six Client Views with live-verified Filters and Hidden fields.
- `rank` ascending Automatic sorting on all six Views.
- Lark Advanced Permission role `Client`: report outputs are View only; Daily, AI technical, Sync/System, and RAW tables are No access. No DEV member is assigned.
- Daily and Weekly report schedules enabled in local DEV configuration and deployed to Cloudflare Worker DEV.

## Confirmed Lark View contract

- Update View Filter conditions send only `field_id`, `operator`, and `value`.
- Response-only fields such as `field_type`, `condition_id`, and `condition_omitted` are not echoed into PATCH.
- Checkbox values retain Boolean type inside the JSON-array string: `[true]`, not `["true"]`.
- SingleSelect filters use live option IDs.
- List Views may omit `property`; Get View hydrates full state before idempotency comparison.
- Filter and Hidden fields are applied in separate PATCH requests.

See `lark-report-view-live-fix-v0.9.5.md` for the confirmed root-cause record.

## Live evidence

- Daily report created 1 Snapshot, 13 Metric rows, and 5 Top Content rows; rerun created zero duplicates.
- Weekly report created the same row counts and correctly returned `partial` while prior-week baseline was unavailable; rerun created zero duplicates.
- Top Content limit 5 → 3 neutralized ranks 4–5 to `no_data`; restoring 5 repopulated the same stable rows.
- Report lock returned retryable `SYNC_LOCK_BUSY`; the same Queue message succeeded after lock release with `created=0`.
- Six managed Views completed live Apply and final Preview returned zero create/update actions and zero conflicts.
- Deployed DEV Worker version: `ba6f3968-628c-4c61-b7eb-62647b38f547`.
- First post-deploy cron at 22:01 Asia/Bangkok completed successfully with 40 idempotent skips and no error.

## Clean-tree verification

- Node unit/integration: 312/312
- Workers runtime: 6/6
- Focused Report reliability: 51/51
- Focused View/client: 53/53
- Architecture: 77 source files / 168 local dependencies / 0 cycles
- Repository hygiene: passed
- npm audit offline cache: 0 vulnerabilities
- Wrangler 4.110.0 dry-run: 363.52 KiB / gzip 74.69 KiB
- No forbidden artifacts, empty files, or duplicate file contents were found in the clean tree.

## Release-package policy

The release archive must contain `.gitignore`, `.dev.vars.example`, and safe example Wrangler files. It must not contain:

- `.dev.vars`
- `wrangler.sync.jsonc`
- `.git` or `.wrangler`
- `node_modules`
- `.DS_Store`, `__MACOSX`, or AppleDouble files
- secrets, access tokens, passwords, or customer production credentials

`wrangler.sync.example.jsonc` keeps Daily/Weekly report schedules disabled by default. Activation is explicit and environment-specific.

## Remaining operational observations

- Observe the naturally due Daily report at 08:10 Asia/Bangkok.
- Observe the naturally due Weekly report on Monday at 08:15 Asia/Bangkok.
- Weekly `complete` baseline will be observed after enough prior-period Daily snapshots accumulate.

These observations do not block work on the next connector. Customer Production setup is outside this DEV release and must use customer-owned Lark, Cloudflare, apps, credentials, and platform assets.
