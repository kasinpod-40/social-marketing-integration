# Changelog

## Unreleased — Customer Base latest export authority — 2026-08-18

- Replaced the live 17-table `Social MKT Data Hub` Source gate with the exact latest local export `Social MKT Data Hub(20260818-030125).base` as customer migration authority.
- Pinned export SHA-256 `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643` and direct-inspection baseline: 33 Tables, 723 Fields, 35,528 unique Records, 111 Views, 12 Relations, 4 Formulas, 6 Dashboards, 2 Automations and 4 Advanced Permission roles.
- Added canonical `.base` envelope parsing for `gzipSnapshot`, `gzipExtraInfo`, `gzipBaseRole`, `gzipAccessConfig`, `gzipDashboard` and `gzipAutomation`; resource counts dedupe stable IDs across snapshot chunks.
- `--source-export-audit` is now fully local, performs zero remote request, requires no Lark credential and defaults to the exact latest export in the operator Mac Downloads folder when no override path is configured.
- Existing unrelated customer Target tables remain protected and all write/apply modes remain blocked until full clone/remap/verify coverage exists for every export-represented dimension.
- Locked existing `🎵 RAW_TikTok_Creator_Videos` as a Protected Existing Table: only read-only `reuse_exact` is allowed; create-by-name and Field/Record/View mutations are fenced before any OpenAPI write request, and any mismatch must block Apply rather than repair/overwrite the table.

## Unreleased — Automatic Weekly negative-channel Quality Gate repair — 2026-08-17

- Preserve the failed scheduled Weekly identity as immutable forensic evidence after
  `weaknesses_missing_negative_channel`; the fail-closed run created no delivery row and sent no message.
- Require Fresh Weekly Weaknesses to name the exact negative channel and metric from compact `ch/m`
  evidence, while preserving the exact no-negative-comparison fallback and missing-data prohibition.
- Bump the Fresh Executive Decision identity from v4 to v5 instead of resetting or retriggering the
  generated failed row.
- A reviewed v5 controlled recovery passed the negative-channel requirement but exposed the independent
  `insight_missing_business_metric_value` gate; it stopped before delivery and its Alert/DLQ remain forensic.
- Require compact Overview output to cite an exact channel, metric and observed value, then bump to a new
  immutable v6 identity instead of mutating or replaying either failed row.
- GET-only v6 preflight selected the exact period and 8 channels, measured input at 2,027/593 characters,
  and found zero existing v6 rows before release.
- PR #655 and #656 passed CI and merged. Exact merged v6 deployed as Worker
  `da0777dc-447b-452b-b86c-3e96637375c8` at 100% traffic without schedule/secret/binding changes.
- The new v6 controlled recovery completed with the Quality Gate passing, one AI row, one Admission row,
  one D1 `sent/mirrored` delivery with claim count 1, and one Lark Notification Log row marked `sent`.
  Exact new alert/DLQ/active-lock counts were zero; retained failed identities were not replayed or redriven.
- This same-day controlled delivery proves the repair and exactly-once delivery path but does not replace
  the next scheduled automatic-run evidence.
- GET-only Live preflight selected the exact `2026-08-10..2026-08-16` period and 8 Report channels,
  remained within the 2,800/700 input budgets at 2,212/593 characters and found zero existing v5 rows.
- Focused tests passed 22/22, full unit passed 3,048/3,048, Workers runtime passed 18/18, Report reliability
  passed 105/105, architecture/hygiene and zero-vulnerability audit passed, and API/Sync deploy dry-runs
  completed without deployment.

## Unreleased — TikTok Organic Account Master — 2026-08-16

- Added canonical TikTok Organic Account planning and idempotent upsert to validation, legacy, staged/D1-first
  and history sync routes using stable key `tiktok:${accountId}`.
- Account status becomes `connected` only after Content and Daily writes succeed; staged sync preflights once
  and writes once after all units, while deterministic metric-date timestamps avoid daily churn.
- Backfilled exactly one Live `MKT_Accounts` row for `tiktok:chemistry_k`; readback is 4 Organic accounts and
  all 3 prior identities are unchanged. A private 3-row backup and checksum were captured before mutation.
- Focused TikTok tests passed 25/25, D1-first ordering passed 2/2, full unit passed 3048/3048, Workers runtime
  passed 18/18, Report reliability passed 105/105, architecture/hygiene and zero-vulnerability audit passed,
  and API/Sync Worker deploy dry-runs passed without deployment.
- PR #653 merged on top of Facebook PR #652. Exact main `dff7c1e6` deployed as Worker version
  `377bb562-46f0-44af-8aea-13b3e928bcaf` at 100% traffic; immediate new alert/DLQ/lock counts were zero and
  GET-only `MKT_Accounts` readback remained 4/4.

## Unreleased — Non-TikTok Lark RAW Live Deletion Closeout — 2026-08-16

- Verified fresh scheduled cycles after the reviewed Worker for WooCommerce, Instagram, Meta/shared Ads,
  YouTube, Chatwoot and Facebook; Facebook completed full-inventory Coverage 89/89 with failed 0 and exact
  D1↔Lark current MKT identity/metric parity 89/89.
- Revalidated all 27 private Lark backup checksums, the D1 backup checksum, YouTube 2,532/2,532 stable-key
  parity, zero target references across 46 non-target tables/931 fields/139 hydrated views, zero active locks,
  and zero current alert/DLQ before mutation.
- Deleted exactly 27 non-TikTok Lark RAW tables one Table ID at a time with per-delete readback. The protected
  `RAW_TikTok_Creator_Videos` identity remained present and every non-target Table ID/name remained unchanged.
- Confirmed `MKT_Content_Daily` at 9,139/10,000 rows with unmanaged 0 and delete candidates 0 after Facebook.
  No replay, redrive, manual Queue run, bulk/prefix deletion, Worker deploy or Production mutation was used.

## 2026-08-15 — Facebook omitted-share normalization

- Treat an omitted `shares` property on a successful Facebook Page Posts inventory row as an
  observed zero, while preserving explicit `shares: null` as unavailable.
- Add regression coverage across RAW metric, Canonical ContentDaily, and D1 Organic history output.
- Audit the fresh Lark Base export read-only: current Views/Likes/Comments are complete, and 7-day
  period metrics remain N/A because baseline coverage is incomplete rather than zero.
- PR #652 passed both CI workflows and merged before PR #653. The combined exact-main Worker release reached
  100% traffic with zero immediate new alert/DLQ/lock; no manual Facebook source run was used as evidence.

## Unreleased — Facebook Authoritative Inventory Dashboard Fix — 2026-08-15

- Proved the active Page credential with a fresh scheduled 91/91 Facebook full-inventory run; D1 and GET-only
  Lark match exactly for Views 1,584,330, Likes 16,069, Comments 70 and Shares 2,439. No new token is required.
- Fixed the generic D1 Organic report reader to exclude stale historical identities only when exact same-period
  complete `full_inventory` Coverage, zero failures and the observed entity count all agree.
- Preserved fail-closed metric semantics: incomplete or inconsistent Coverage does not filter data and any
  contributing unknown metric remains null/N/A rather than becoming a fabricated zero.
- Focused cross-platform regression passed `18/18`; full unit passed `3047/3047`; Workers runtime passed
  `18/18`; report reliability passed `105/105`, architecture/hygiene, zero-vulnerability audit, deploy dry-run
  and diff check passed. PR #649 passed two CI checks and merged at `7f4c3014`.
- Worker `808fe569-8319-469b-b069-2b586642e630` reached 100% traffic. Four unique post-deploy Facebook
  Dashboard jobs completed exactly once with zero alert/DLQ/lock; D1 and Lark match at Views 1,584,330,
  Likes 16,069 and Comments 70 across 1D/3D/7D/30D. Shares remains null/not-observed because 28/91
  authoritative Provider rows omit it; no zero was fabricated.
- Enabled the Facebook connector and 07:30 Bangkok schedule and removed Facebook from the retention defer
  set. The first 07:30 source → 08:05 retention scheduled evidence remains time-gated to 2026-08-16;
  no manual source rerun or retention was used instead.

## Unreleased — Integration Non-wait Closeout — 2026-08-15

### MKT_Content_Daily live retention closeout

- Added a stable scheduled retention job at 08:05 Asia/Bangkok, before Daily Report materialization at 08:10.
- Added exact-ID Lark batch deletion with active-lock checks before every chunk and full retained-identity
  readback; D1 remains historical authority and no D1 row is mutated by retention.
- Preserved every Facebook row through an explicit deferred-platform contract until customer permission is
  ready; malformed/unmanaged rows and latest-per-Content rows remain fail-closed retained.
- Live execution backed up 19,940 rows privately, deleted 10,649 exact TikTok/YouTube rows and converged at
  9,291 rows. Facebook remained 425/425, Instagram 37/37 and protected TikTok RAW was unchanged.
- PR #646 delivered the reviewed one-time operator; PR #647 delivered permanent runtime scheduling. Worker
  version `3d9c363d-d1fc-4cfe-b275-9fa75b0a6ca1` reached 100% traffic with zero immediate new alert, DLQ,
  active lock or manual retention work.

### Added

- Added an exact-confirmation TikTok alert closeout operator pinned to two `SYNC_PARTIAL_WRITE` alerts whose
  original run/work and two newer generations all completed successfully; no broad alert mutation is possible.
- Added a SELECT-only D1 capacity audit with reviewed table counts, index inventory, 14-day growth rates and
  90-day/1-year/3-year projections.
- Added a GET-only `MKT_Content_Daily` bounded-retention preview that keeps the latest row for every Content,
  preserves malformed rows fail-closed, writes private backup/exact-key evidence and performs no Live deletion.
- Added a local Storage Foundation 10x/100x load test and a customer-owned Production cutover runbook.

### Evidence and safety
