# TikTok Organic DEV Closeout — v0.9.0

วันที่ปิด Release candidate: 2026-07-13  
Environment: `development`  
Customer profile: `dev_ft_pumkin`  
TikTok account key: `ft_pumkin`

## ขอบเขตที่ปิดแล้ว

- Lark Native TikTok ingestion → `MKT_Content` + cumulative `MKT_Content_Daily`
- Canonical stable keys, idempotent upsert, reconciliation, incremental fingerprints/cursors
- D1 Sync Log, lease lock, retry, DLQ, D1/Lark System Alerts
- Scheduled TikTok sync + 24-hour full reconciliation
- Versioned Lark Report Schema installer, 5 tables / 110 fields
- Metric definitions 68 rows and Daily/Weekly report settings 2 rows
- Daily/Weekly Organic Report Engine, comparison periods, data-quality state, fixed-rank Top Content
- Client-view installer for Daily/Weekly Metrics and Daily/Weekly Top Content
- Safe local activator for Daily/Weekly report schedule flags

## Live DEV UAT evidence

### Schema and seed

- Report schema rerun: `createTables=0`, `createFields=0`, `updateFields=0`, conflicts/warnings/manual actions = 0
- Metric seed: first run `created=68`; rerun `skipped=68`
- Report settings seed: first run `created=2`; rerun `skipped=2`

### Daily report

Period: `2026-07-12`; comparison: `2026-07-11`

- First run: Snapshot `created=1`, Metrics `created=13`, Top Content `created=5`
- `dataStatus=complete`, `baselineCoverageRate=1`, `sourceSnapshotCount=40`, `trackedContentCount=20`
- Rerun: `created=0`, updated `1 / 13 / 5`
- Rank 1–5 and all client-value fields verified in Lark

### Weekly report

Period: `2026-07-06..2026-07-12`; comparison: `2026-06-29..2026-07-05`

- First run: Snapshot `created=1`, Metrics `created=13`, Top Content `created=5`
- `dataStatus=partial`, `baselineCoverageRate=0` is expected because the comparison week predates retained snapshots
- Rerun: `created=0`, updated `1 / 13 / 5`

### Top-content stale-rank safety

- Changed Daily limit 5 → 3
- Result: `topContentLimit=3`, `topContentSlotCount=5`, `topContentCount=3`
- Existing ranks 4–5 were neutralized to `no_data`; no rows were deleted or duplicated
- Restored limit to 5; ranks 1–5 returned with `created=0`, `updated=5`

### Report lock collision

- A manual D1 report lock caused `SYNC_LOCK_BUSY`, `retryable=true`, and no writes
- After lock removal, the same Queue message succeeded on retry (`attempts=3`)
- All report tables remained idempotent: `created=0`, updated `1 / 13 / 5`

### Failure/partial-write semantics

Deterministic regression tests are used instead of intentionally corrupting the live DEV Base:

- Failure on the first report table remains `failed`
- Failure after confirmed earlier-table progress becomes `partial_success`
- Retry uses stable keys and does not create duplicate report rows
- Reliable runner persists partial status and critical alert behavior

Run the focused suite with:

```bash
npm run test:report-reliability
```

## Client Views

Installer-managed views:

- `📊 Client Metrics` (safe combined default)
- `📊 Daily Metrics`
- `📈 Weekly Metrics`
- `🏆 Top Content` (safe combined default)
- `🏆 Daily Top Content`
- `🏅 Weekly Top Content`

The installer creates View names/types and applies Filter/Hidden-field PATCH requests. Sort and role permissions remain Lark UI actions because the available View OpenAPI does not expose those states; on 2026-07-14:

- Sort `rank` ascending was saved and verified in all six managed views
- Advanced Permissions was enabled and a least-privilege `Client` role was saved in DEV without assigning a member
- Customer Production still requires real client-member assignment in the customer's Lark organization
- DEV does not expose client credentials and is not a customer production environment

Commands:

```bash
npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply
npm run setup:report-views
```

The final preview must show zero create/update actions and zero conflicts.

## Scheduled report activation

Safe default in the example config remains `false`. After Client Views are applied, activate the local DEV config with:

```bash
npm run enable:tiktok-report-schedules
CONFIRM_WRITE=YES npm run enable:tiktok-report-schedules:apply
npx wrangler deploy --config wrangler.sync.jsonc
```

The activator validates DEV profile, TikTok sync flags, report setting keys/times, and real report table IDs before making an atomic local-file change. It never edits source-controlled examples and `wrangler.sync.jsonc` must remain untracked.

## Operational follow-up, not a release blocker

- Observe one real scheduled Daily producer after 08:10 Asia/Bangkok
- Observe one real scheduled Weekly producer on Monday 08:15 Asia/Bangkok
- Weekly `complete` baseline will occur naturally after enough prior-period snapshots are retained; the expected `partial` path is already live-tested

## Final DEV table IDs

```text
LARK_TABLE_MKT_METRIC_DEFINITIONS=tblk2Ho99sXqLLE2
LARK_TABLE_MKT_REPORT_SETTINGS=tblYzXA6m9G0PvIs
LARK_TABLE_MKT_REPORT_SNAPSHOTS=tbl81gHrMESpDolN
LARK_TABLE_MKT_REPORT_METRIC_VALUES=tbl7rJypEU2ryAcr
LARK_TABLE_MKT_REPORT_TOP_CONTENT=tblQMqeYT6cCWrla
```

These IDs belong to the developer-owned DEV Base. Customer Production must use customer-owned Lark/Cloud/app credentials and its own table IDs.
