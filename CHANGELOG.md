# Changelog

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
  `18/18`; report reliability passed `105/105`; architecture/hygiene, zero-vulnerability audit, deploy dry-run
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

- Closed exactly two TikTok partial-write alerts as `resolved_by_new_generation`; Queue, replay, redrive, DLQ,
  Worker, schedule and Business-data actions were zero. Recent open alert/DLQ since 2026-08-15 are zero.
- D1 is 151.74 MiB across 70 tables/175,855 rows; linear 14-day-rate estimates are 609.35 MiB at one year and
  1.49 GiB at three years. The existing private D1/Lark backups revalidated and a local restore/integrity/
  Migration-0020 drill passed.
- 100x load evidence used 1,208,200 Organic observations and 823,800 Ads daily facts; indexed range queries
  completed in 873.68 ms and 162.99 ms with SQLite integrity `ok`.
- The earlier 19,840-row preview was superseded by the exact live execution above after Facebook was explicitly
  removed from delete scope; its historical plan remains evidence only.
- Repository gates passed: focused `15/15`, full unit `3030/3030`, Workers runtime `18/18`, Report
  reliability `105/105`, architecture/hygiene, zero-vulnerability audit, deploy dry-run and diff check.

## Unreleased — Chatwoot Daily Updated-within Incremental — 2026-08-15

### Changed

- Split Conversation discovery by runtime mode: fresh Daily uses one bounded Provider `updated_within`
  query, while Initial/Reconciliation keeps stable-ID two-pass discovery.
- Kept a three-day immutable overlap plus five-minute clock-skew allowance, exact per-ID detail reads,
  stable D1/Lark keys and existing server-side Reporting Event `since`/`until` pagination.
- Migrated legacy durable state conservatively: any operation with discovery progress continues under the
  old two-pass strategy instead of changing source semantics mid-continuation.

### Safety

- Added strict page-1/unpaginated and row/response bounds for updated-within discovery; no Provider payload,
  Message content or PII is persisted in durable state.
- The rollout sent no Queue/manual Chatwoot run, replay/redrive, schedule or secret change. The prior Daily
  continuation completed before the GET-only Provider preflight and reviewed deployment.
- Focused Chatwoot regression passed `222/222`; full unit passed `3015/3015`; Workers runtime passed
  `18/18`; report reliability passed `105/105`; architecture/hygiene, zero-vulnerability audit and API/Sync
  deploy dry-runs passed.
- The prior Daily operation reached `completed` with zero failed units, exact alerts, DLQ and active locks.
  A GET-only tenant preflight returned 51/51 unique changed Conversations in one unpaginated request.
- PR #643 merged at `77f9c92efe36a6b36d6eed66bffc04e90326fe10`; Integration Worker version
  `9d768d22-4f96-48aa-87d7-f1dd86c991a6` reached 100% traffic. Immediate readback found zero new alerts,
  DLQ entries, active locks and manual Chatwoot Work. Fresh scheduled Daily validation remains pending.

## Unreleased — Non-TikTok Lark RAW Retirement — 2026-08-14

### Changed

- Removed non-TikTok Lark RAW targets from active Meta Organic, Google Ads, YouTube,
  WooCommerce and Chatwoot write/preflight/runtime contracts; customer-facing MKT/Report writes remain.
- Reduced active Chatwoot Lark provisioning/auto-mapping to five MKT tables, WooCommerce to five MKT
  tables, and YouTube RAW provisioning to zero.
- Added D1 migration `0020_youtube_analytics_daily_facts.sql` and an idempotent newer-wins store so
  YouTube Owner Analytics period facts no longer require Lark RAW authority.
- Removed unused Google Ads and Chatwoot RAW Lark projections from the in-memory write set.
- Kept `RAW_TikTok_Creator_Videos` protected and read-only with no contract change.

### Rollout safety

- PR #641 merged at `ffb537958f406f5c44cedc109c657c5f198739d2`; D1 migration `0020` was applied and
  Integration Worker version `7754be21-8be3-43b3-a537-9dc858b6f5b7` reached 100% traffic.
- Captured private D1 and exact 27-table Lark backups before mutation. The Lark backup contains 20,072
  records plus fields, views, full records, stable-key lists and checksums; TikTok Native RAW remains present.
- Sent one fresh YouTube Owner Analytics catch-up for `2026-08-04..2026-08-11`: 837/837 Videos,
  2,532 complete rows, no missing rows, and zero new alert/DLQ. D1 and legacy Lark backup match at
  2,532/2,532 stable keys with equal SHA-256 and no duplicates/extras.
- GET-only consumer audit found zero references to the 27 targets across 46 non-target tables, 931 fields,
  139 hydrated views and the workflow inventory.
- Live deletion remains pending fresh post-deploy scheduled Connector cycles. No manual run is treated as
  scheduled evidence, no table has been deleted, no retained Work was replayed and Production remains blocked.

## Unreleased — Facebook Reactions and Comments Post Summaries — 2026-08-12

### Changed

- Added bounded Facebook Post summary reads for `reactions.limit(0).summary(true)` and
  `comments.limit(0).summary(true)` alongside the existing `shares` field; no user identities or
  Comment text are requested.
- Projected observed summary counts through the existing Raw metric, Canonical ContentDaily, D1 Organic
  history and Lark paths as `reactions_count`/Likes and `comments_count`/Comments.
- Promoted `pages_read_user_content` and `read_insights` into the Facebook readiness contract so a token
  that cannot supply the complete Dashboard metric set fails preflight before scheduled ingestion.
- Preserved metric semantics: an observed zero remains zero, an absent field remains null/N/A and a
  malformed summary fails closed.

### Validation and safety

- Live GET-only capability evidence on 2026-08-12 confirmed the current token grants `read_insights` but
  not `pages_read_user_content`; reactions/comments requests fail with Graph code 10 while `shares`
  succeeds. This is the exact remaining credential gate, not a Dashboard or Lark schema defect.
- Focused Facebook/Meta regression passes `416/416`; full unit `3009/3009`, Workers runtime `18/18`,
  report reliability `105/105`, architecture/hygiene, zero-vulnerability audit and deploy dry-run also
  pass. Deployment and a fresh operation remain blocked until the active User and Page credentials carry
  `pages_read_user_content`.
- No migration, new table, retained-operation replay, DLQ redrive, Live write or deployment is part of the
  repository-only state recorded here.

## Unreleased — YouTube Analytics Signed Daily Counts Hotfix — 2026-08-12

### Changed

- Separated RAW Analytics period counts from cumulative Data API counters: daily `views`, `likes`,
  `comments` and `shares` now preserve signed safe-integer Provider adjustments, while cumulative
  Channel/Video statistics remain non-negative integers.
- Continued to reject fractional, non-finite and unsafe Analytics count values; no rounding, clamping or
  zero fabrication was added.
- Aligned the executable blueprint, Thai Lark descriptions and checked-in workbook with the signed RAW
  period-metric contract.

### Live evidence and safety

- PR #637 merged and Integration Worker version `c56c255f-2ca0-42be-ad2b-552d9b4f0fe5` reached 100%
  traffic, resolving the prior `averageViewPercentage` ceiling.
- The one fresh post-deploy catch-up passed OAuth/channel ownership and complete 100-video inventory, then
  stopped fail-closed at `likes must be a non-negative safe integer`; Business records written remained 0.
- The second failed Work and its two exact alerts are retained and will not be replayed. A fresh operation
  is required only after this second correction completes reviewed merge and deployment.
- Pre-deploy gates pass: focused YouTube/workbook `23/23`, unit `3008/3008`, Workers runtime `18/18`,
  report reliability `105/105`, architecture/hygiene, zero-vulnerability audit, deploy dry-run and workbook
  visual verification across all 10 sheets.
- PR #638 merged at `61cd05afa0f0f1c402c206242c074296c9b47f86`; exact-head CI passed and reviewed
  Worker version `0aff7439-5ea2-4df3-8926-1b7430c98659` received 100% traffic.
- One fresh non-replay catch-up completed with 837/837 Videos queried, zero failed Videos, 1,919 Analytics
  rows, 2,079 writes, D1 checkpoint commit and zero new alerts.
- GET-only Lark reconciliation verified 1,919 unique stable keys, zero duplicates/mismatches/invalid metrics
  and 13 signed Provider adjustment cells preserved. Integration Owner Analytics is Live PASS; Production
  remains blocked.

## Unreleased — YouTube Analytics Average View Percentage Live Hotfix — 2026-08-12

### Changed

- Removed the incorrect `100` ceiling from RAW YouTube Analytics `averageViewPercentage` while preserving
  finite non-negative validation and the exact Provider value without clamping.
- Aligned the YouTube blueprint and Lark field description with Source semantics: repeated viewing can make
  average watched percentage exceed 100.
- Updated the checked-in multichannel workbook field metadata so the executable blueprint and workbook
  parity contract remain exact.

### Live evidence and safety

- Customer-owner consent completed with exact Channel identity, both approved scopes and a newly active
  encrypted Refresh Token; the previous credential was marked replaced.
- Fresh catch-up `2026-08-04..2026-08-10` passed Owner authorization, then stopped fail-closed with zero
  Business records written when Live data exceeded the old ceiling.
- The failed Work is retained and will not be replayed. Live closure requires reviewed merge/deploy and a
  fresh catch-up operation with D1/Lark reconciliation.
- Pre-deploy gates pass: focused YouTube/workbook `8/8`, unit `3007/3007`, Workers runtime `18/18`, report
  reliability `105/105`, architecture/hygiene, zero-vulnerability audit and deploy dry-run.

## Unreleased — Automatic Weekly Executive Notification Live Activation — 2026-08-11

### Changed

- Promoted the already-reviewed Weekly Executive path to automatic Integration Workspace delivery by enabling the existing Notification runtime/send/mirror gates in `runtime` mode and the dedicated Monday 08:30 Asia/Bangkok producer while preserving Weekly Shared Report at Monday 08:15.
- Kept the existing AI Materialization Automation enabled, Base `Eligible AI Run → Lark Group Notification` Automation disabled, and D1 atomic notification claim as the exact-once delivery authority.
- Corrected the live activation source-Settings boundary in PR #633 so exact canonical `report_setting_key` values are read back as raw Lark records before the existing source-settings resolver validates them.
- Recorded that the current live Worker path imports `node:crypto`; the ignored active `wrangler.sync.jsonc` therefore preserves `nodejs_compat` unless that implementation is later migrated away from the Node built-in.

### Live validation and safety

- Final activation completed on `main@89f9c615f2ae20f798b089e639c3d9dd5f1cb38a` with Worker version `f19492d2-67f4-4b7c-ba78-3bb84fb439e8` serving 100% traffic and eight exact 7D source Reports.
- The first post-hotfix execute had a controlled partial state: three exact 7D Report Settings were activated, Cloudflare rejected Worker version creation before deployment because Node compatibility was absent, and Queue/message counts remained zero. Recovery preserved those Settings and completed with zero additional Setting writes.
- Final runtime state is Notification runtime/send/mirror ON, Automatic Weekly ON at Monday 08:30 Asia/Bangkok, AI Materialization Automation ON, Base Notification Automation OFF, immediate Queue admissions 0, immediate Lark sends 0, and Production BLOCKED.
- The next eligible automatic period is `2026-08-10..2026-08-16`, due Monday `2026-08-17 08:30 Asia/Bangkok`; incomplete/stale source, Native AI failure or Executive Decision Quality Gate failure must fail closed without substituting an older Weekly identity.

## Unreleased — Facebook ContentDaily Live Source Repair — 2026-08-11

### Changed

- Added the Graph-v25 accepted `shares` Post field to the bounded Facebook content inventory and
  projected only observed `shares.count` values into the existing cumulative Organic history path.
- Bound fallback snapshot dates to the requested operation day while retaining the actual fetch
  timestamp for audit and retry identity.
- Added an explicit Organic History `metricDate` context and unchanged historical checkpoints so
  D1 Coverage/observations retain the requested day instead of deriving it from execution time.
- Kept `read_insights` as an optional enhancement instead of a hard admission gate: the active Page
  credential can still ingest explicit Post fields while Insights-only metrics remain unavailable.

### Safety

- Missing views, likes and comments remain null/N/A; the repair does not fabricate zero values.
- Live GET-only preview observed 89 bounded Posts, 64 Post rows with an explicit shares count and
  2,351 total shares for `2026-08-10`, with zero Queue/D1/Lark/deploy/schedule mutations.
- The prior recovery operation remains immutable and is not replayed or redriven; Live admission
  requires a fresh operation ID after reviewed merge and deployment.

### Live validation

- Merged PR #629 and PR #632, deployed merged Worker version
  `5ede6471-b890-4459-a090-e9f8c3d2ca5d` at 100% traffic and kept DLQ redrive disabled.
- Fresh operation `facebook-contentdaily-20260810-r2` completed with 64 distinct ContentDaily keys,
  exact `metric_date=2026-08-10`, 2,352 shares, complete 64/64 Coverage, zero failed rows, zero DLQ
  and zero open alerts.
- Materialized Facebook 1D/3D/7D/30D once each; D1 and GET-only Lark readback return total shares
  2,352 with availability `available` for every window, and the user visually confirmed the existing
  Dashboard renders Facebook.
- Kept Views/Likes/Comments null/N/A because the active runtime token's granted permission list does
  not include `read_insights`; App-level “ready to test” status is not a token grant.

## Unreleased — Chatwoot Stable-identity Pagination Live Closeout — 2026-08-10

### Changed

- Replaced mutable conversation-page fingerprint continuation with PII-free stable numeric ID discovery,
  exact per-ID detail reads and repeated page-1 scans until one complete pass finds no new identity.
- Kept bounded per-invocation processing, stable Queue generation, idempotent D1/Lark keys and retained
  historical terminal evidence; no DLQ bulk redrive was used.
- Raised only the ignored active Chatwoot conversation/API row bounds from 5,000 to 10,000 after a
  read-only Provider count proved 7,720 rows, then deployed and read back the config at 100% traffic.
- Excluded Conversations created after the immutable operation cutoff from convergence progress and detail
  reads while retaining their numeric IDs for page-drift dedupe; this prevents active accounts from keeping
  a verification pass alive solely because new Conversations arrive during the scan.

### Validation

- PR #597 merged after focused Chatwoot `23/23`, full unit `2919/2919`, Workers runtime `18/18`, report
  reliability, architecture/hygiene, zero-vulnerability audit and deploy dry-run gates passed.
- Controlled live operation `r6` completed its first 7,720-ID pass and exposed the post-boundary convergence
  defect on pass 2. It remains evidence, not PASS; reviewed cutoff deployment, completion and D1/Lark
  reconciliation must be recorded before Chatwoot is closed.

## Unreleased — YouTube Customer OAuth Runtime Credential-path Correction — 2026-08-10

### Changed

- Corrected the credential-path defect: the retained connection was connected/validated with a matching
  encrypted Refresh Token reference, while ingestion had bypassed it for legacy static YouTube OAuth.
- Added a read-only D1 authorization gate for exact customer, connector, state, scopes, active credential
  reference and configured Channel identity.
- Routed Analytics-enabled Owner clients through the existing encrypted customer credential repository and
  shared Google refresh provider while keeping Access Tokens memory-only.
- Kept Public YouTube and operator public-only dry-run behavior separate and prohibited legacy Owner OAuth
  fallback when Analytics is enabled.

### Safety

- Reviewed deploy and Live refresh later proved the retained Google grant invalid (`invalid_grant`). OAuth
  app publishing cannot revive it; customer Channel owner consent is required once to issue a new token.
- Two developer-account consent attempts returned no Channel identity and were rejected fail-closed with
  zero Queue/Lark writes; no further developer-account attempts are allowed.
- Repository gates passed, including Workers runtime `18/18`, report reliability `105/105`, architecture and
  hygiene checks, zero dependency vulnerabilities, deploy dry-run and diff check.
- Repository implementation is fixed/deployed, but Live remains unvalidated until the one-time owner consent,
  read-only Owner preflight and controlled Analytics catch-up/reconciliation pass.

## Unreleased — Multichannel Runtime & Schedule LIVE Activation — 2026-08-10

### Changed

- Activated Integration Workspace source and Daily/Weekly Shared Report schedules while retaining the existing Cloudflare cron/Queue topology and external Google Ads producer boundary.
- Bounded Instagram previous-day inventory by the reviewed date range and paginated Meta staged-unit reads at the D1 store cap of 500.
- Added the existing Lark `MKT_Report_Top_Ads` table binding to the ignored active Sync config without applying schema changes.
- Materialized and read back 32 D1/Lark report snapshots for 8 platforms × `1D/3D/7D/30D`, with 1,236 metric rows, 80 Top Content rows, 40 Top Ads rows and zero duplicate stable keys.
- Completed fresh Google Ads LIVE run `609cc147-809b-404a-a484-dcbb82c12a6f`: 7/7 signed chunks, 1,335/1,335 rows, six complete datasets, zero failed rows and one successful Queue admission.
- Reconciled Google Ads D1/Lark parity at 1,105 entity rows and 390 daily facts, then refreshed all four Google Ads report windows with the fresh run watermark.
- Confirmed the enabled Google Ads Manager Script Provider frequency as daily between 06:00 and 07:00; the PREVIEW script remains unscheduled.

### Safety

- Retained the original 8 Paid Ads configuration-failure DLQ entries as evidence; recovery used new `-r2` operation IDs and no DLQ redrive.
- Preserved null/N/A, `partial`, `revisable` and `no_data_confirmed` semantics without fabricating zero values.
- Notification runtime, automatic weekly notification, DLQ redrive and Production remain off. YouTube
  Analytics is repository-fixed but awaits reviewed deploy/live validation; Chatwoot mutable pagination
  remains an external blocker.
- Preserved historical Google Ads run `88351cb4-714d-49ef-91db-d95550a93ebf` without replay and observed zero new Google Ads DLQ entries, alerts or active locks.

## Unreleased — Weekly Executive Decision Report v1 — 2026-08-10

### Changed

- Upgraded the existing Weekly 7D Full-channel Native AI path from descriptive summary to executive decision support without adding a new Report, AI or Notification engine.
- Preserved bounded ranked Organic Content and Paid Ad candidates through the factual and AI evidence boundaries instead of collapsing each channel to rank 1.
- Retained Organic Views/Likes/Comments/Shares/Engagement/Engagement Rate and Paid Spend/CTR/Conversions/Conversion Value/CPC/CPA/ROAS when the Shared Report source provides them.
- Added explicit `[CONTENT]`, `[TEST]`, `[SCALE]`, `[KEEP]`, `[REDUCE]`, `[STOP]` and `[NO-SCALE]` decision actions, named-candidate requirements and deterministic awareness-up/outcome-down Funnel divergence evidence.
- Added Scale safety so upper-funnel evidence alone cannot justify `[SCALE]`, and blocked fabricated Organic↔Paid identity claims until an exact mapping contract exists.

### Safety

- Historical Weekly delivery and AI identities remain terminal and are not rerun, resent, replaced or mutated.
- No Native AI trigger, Lark record/group write, Queue send, Worker deployment, Automation activation, Schedule activation or Production action occurred.
- Automatic Weekly Notification remains blocked until a fresh future-period Executive Decision preview passes the new Quality Gate.

## Unreleased — Multichannel Report & Schedule Final Closure — 2026-08-09

### Changed

- Promoted Meta Ads, Google Ads and Chatwoot connector/job catalogs to active from retained
  Source and Shared Report UAT evidence; all execution and schedule gates remain default false.
- Replaced scheduled legacy TikTok-only Daily/Weekly generation with the shared
  `report.materialization.generate` path for eight reviewed platforms at `1D/3D/7D/30D`.
- Added deterministic prior-day Meta Ads jobs per reviewed account alias and one account-scoped
  Chatwoot daily incremental job on the existing primary cron.
- Preserved Google Ads Manager Script as the external schedule boundary while allowing its signed
  ingress runtime to process scheduled deliveries.
- Added canonical scheduled Report setting keys, stable Queue operation identity and batched Queue
  fan-out with sequential compatibility fallback.

### Safety

- Schedule admission validates producer/consumer gates before Queue mutation; Meta Ads mappings,
  Chatwoot polling/Webhook exclusivity and all Report read gates fail closed.
- Daily/Weekly jobs use the previous completed local day and existing Shared D1/Lark upsert keys,
  preserving null, observed-zero, negative-correction and money display semantics.
- TikTok Ads remains planned, Facebook R2 retained evidence is not replayed, no schema migration is
  introduced and Production remains blocked.

## Unreleased — Meta Ads July Activity Scope — 2026-08-02

### Changed

- Replaced the active Meta Ads full-inventory source plan with bounded account plus ad-level daily Insights for
  one inclusive period of at most 31 days.
- Derived Campaign, Ad Set and Ad identities only from activity observed in that report range; the active path no
  longer enumerates full-history Campaign, Ad Set, Ad or Creative inventories.
- Retained validated detailed daily facts in D1 while projecting only Account and activity entities to Lark.
  Shared checksummed report materializations remain the customer-facing path for 1D/3D/7D/30D and Top Ads.
- Added report-range Coverage for activity entities and daily facts while preserving full-inventory Coverage for
  the exact Account identity.

### Safety

- Rejects Meta Ads periods longer than 31 inclusive days before Provider access and rejects hierarchy drift for
  any repeated activity identity.
- Uses a new operation fingerprint schema so prior full-inventory operations cannot be resumed under the new
  source contract. The prior k2 page-limit operation remains an immutable forensic failure.
- Updated the reviewed Meta history planner to emit only July operations and removed the conditional January–April
  expansion path, so the operator contract cannot recreate the superseded full-history scope.
- Added exact-reviewed-Head targeted execution for `chemistry_k2`/`chemistry_k3`. Target mode executes one July
  operation only, records zero retained Facebook replay/resend, and permits only the exact retained k2 forensic
  Work identity while still requiring zero active locks and no other active Reliability state.
- Materialized the complete Shared all-false runtime authority before targeted Meta read-only validation, including
  required flags absent from the caller's private Environment, so missing values cannot be mistaken for unsafe drift.
- Makes no Provider, Queue, D1, Lark, deployment, Schedule or Production mutation during this implementation.

## Unreleased — Meta Ads Active-progress D1 Verification — 2026-08-02

### Reliability

- Added an explicit same-operation recovery guard for stale, stable Meta Ads partial source staging with
  zero D1/Coverage/Business/Lark writes and no active lock.
- Added sanitized source/D1 phase progress metadata without persisting source cursors, content identities or
  raw Provider payloads.
- Extended the base D1 verifier only while exact durable activity remains fresh, with a configurable progress
  lease and mandatory hard poll cap.
- Kept recovery modes mutually exclusive and target-fingerprint-bound.

### Safety

- Stale progress, terminal errors, invalid Coverage, Lark/full-completion phases, non-Ads targets and the hard
  cap all stop fail-closed through the existing all-false restore path.
- Repository implementation makes no Remote call, deployment, Queue send, D1/Lark write, Schedule or Production
  change; the current Worker remains verified all-false until exact-head CI passes.

## Unreleased — Chatwoot Initial Terminal Failure Recovery — 2026-08-01

### Reliability

- Split each selected Chatwoot Conversation page into one-Conversation durable continuations, retaining only a
  row offset and SHA-256 identity-order fingerprint. This bounds Provider, D1 and Lark work per Queue delivery,
  resumes legacy page state at offset zero and fails closed if the live page identity order changes mid-resume.
- Added the exact attempts-25/unit-3 `QUEUE_RETRY_EXHAUSTED` boundary with page-3 cursor, Coverage 52, DLQ 9 and
  Alert 15 guards. Recovery can replace the retained active Worker with the reviewed current version, send one
  same-Work continuation and still automatically restore all flags false.
- Deduplicated identical interrupted-controller evidence copies by retained session, baseline and deployment
  identity while continuing to reject distinct candidates as ambiguous.
- Made an interrupted long-running Final UAT controller resumable from the one exact incomplete evidence
  directory. Resume is poll-only for the already-admitted Initial operation, rejects ambiguous sessions and
  cannot submit another Initial Queue message.
- Stopped pinning a short-lived Cloudflare OAuth bearer into long-running Wrangler commands; Wrangler now uses
  its refreshable OAuth session and Queue REST authorization is resolved just in time for each mutation.
- Reduced active-deployment polling to a bounded cadence while retaining first, periodic and completion checks,
  preventing authentication churn during multi-hour durable work.
- Bound Safe restore before resumed remote preflight so any controller exit still owns the existing active flag
  window; the resumed path accepts at most one exact live Chatwoot lock and requires it to close at completion.
- Allowed that same single live lock through the retained source-config incident preflight only when the exact
  controller-resume evidence is present; ordinary source-config recovery still requires zero active locks.
- During exact controller resume, verify that all required Worker Secret names already exist without requiring an
  all-false active version or running Secret bootstrap; the ordinary missing-Secret bootstrap remains Safe-only.
- Aligned Reporting-event names with Chatwoot's authoritative listener contract, retaining opened/bot lifecycle
  evidence and mapping `conversation_resolved` time-to-resolve into resolution duration/count without double-counting
  the bot-resolved companion event; unsupported names still fail closed.
- Added an exact attempts-16/unit-2 boundary for the subsequently observed `conversation_opened` failure while
  preserving the same committed page-1 cursor, Business counts, DLQ 8 and open-Alert 14 evidence.
- Added an exact attempts-14/unit-2 recovery boundary that preserves the committed Conversation page-1 cursor and
  pins its 17 Conversations, 590 Messages, 122 conversation Reporting events, DLQ 7 and open-Alert 12 evidence.
- Canonicalized each Chatwoot message page by external message ID before cursor validation, accepting descending
  live pages while still rejecting duplicate IDs, cross-page overlap and out-of-bound before/after cursors.
- Preserved Conversations whose historical label title no longer resolves to a current external label ID,
  omitting only that relationship and reporting an unresolved-reference reconciliation count without fabrication.
- Treated Chatwoot's out-of-range optional `waiting_since` sentinel as missing instead of failing a Conversation,
  and added exact attempts-7/unit-2 zero-write recovery plus closure for the resulting retained incident.
- Accepted fractional epoch seconds from the Chatwoot conversation API through the Shared date-time contract,
  with exact durable-cursor recovery and incident closure for the observed zero-write terminal boundary.
- Forwarded that known attempts-4/unit-2 candidate through the inspector's shallow admission gate to the existing
  exact phase, error, DLQ, Alert, lock and Business-count validation.
- Deduplicated byte-identical retained UAT session fingerprints and preferred the canonical repository-head path;
  distinct latest fingerprints remain ambiguous and fail closed.
- Added an exact attempts-5 safe-restore race boundary and allowed only its pre-existing failed unit while the Work
  remains active; terminal lifecycle or any incident-count growth still fails immediately.
- Stopped Final UAT polling from classifying a normal `running` unit as terminally failed.
- Added progress-prefix-safe Wrangler JSON parsing and a SELECT-only, retained-session/D1-proven incident
  inspector with sanitized diagnostics and all-false Worker verification.
- Added exact guarded reactivation and one recovery-owned continuation for the same Initial operation, Work,
  generation and requested-at identity; replacement Initial admission remains impossible.
- Scoped the reactivation idle guard to Chatwoot Work so unrelated active connector Work cannot block recovery.
- Reused the existing Stable-key writers and Final UAT flow to preserve partial masters, reconcile Lark lag, verify
  all 15 D1/Lark targets, and prove Initial/Daily replay stability.

### Safety

- Current and retained old incidents close only after accepted UAT, parity and all-false restore evidence.
- Each authorized live UAT failure automatically restored every Chatwoot execution flag to false and left no
  active lock; Schedule/Webhook stayed disabled and Production stayed blocked.

## Unreleased — WooCommerce 2026-only bounded history — 2026-07-30

- Replaced unbounded Order history with an immutable `2026-01-01` through operation-time source
  window persisted across durable continuations.
- Customer/Coupon rows created before 2026 are filtered before D1/Lark writes; current
  Store/Product/Category master snapshots remain available for reporting.
- Added `report_range` Coverage/report validation and a backup-first exact Stable-key cleanup
  operator for pre-2026 Order and derived facts.
- Cleanup retains Reliability audit rows and terminalizes only the replaced Full-history
  Work/Sync identity after backup, exact parity and a zero-active-lock guard.
- Cleanup tolerates an observed partial-write gap only by inventorying and backing up each
  side independently, persisting sanitized gap counts/fingerprints, and verifying both targets
  are empty after their scoped deletes.
- Replaced unsupported Remote D1 SQL `BEGIN/COMMIT` with ordered idempotent statements,
  per-step progress evidence, stdout/stderr fingerprints, and unique non-overwriting backup
  names after Cloudflare returned D1 code `7500`.
- Stopped the prior Full-history rollout at 7,800 Orders from 2022–2023 and restored the
  Development Worker to all-false Safe state; Schedule and Production remain unchanged.

## Unreleased — WooCommerce Exact DLQ Completion Closure — 2026-07-30

### Reliability

- Added a completion-only operator pinned to the three retained DLQ incidents for
  `woo-final-full-e2372e56d52d`.
- Required the successful Final summary, exact completed Remote snapshot, zero lock, fresh D1
  backup and immutable incident metadata before any closure write.
- Made interrupted exact-reference closure resumable and verified zero exact-operation snapshot
  drift after metadata completion.

### Safety

- The operator updates only retained dead-letter status/recovery metadata; it cannot deploy a
  Worker, send/redrive/delete Queue work, or mutate Work, Sync, Coverage, Business or Lark rows.
- Schedule and Production remain blocked.

## Unreleased — WooCommerce Commerce Report Live Closeout — 2026-07-30

### Report reliability

- Extended the existing Report runtime closeout operator with an explicit WooCommerce Commerce
  target while preserving TikTok Organic as the unchanged default.
- Added a guarded one-command wrapper that reuses the shared finalizer, D1 materialization,
  Lark Snapshot/Metric writer, same-job replay and automatic all-false restore.
- Added platform-neutral D1/Lark metric integrity verification for Commerce materializations.

### Safety

- The WooCommerce report-only window enables exactly global D1 Report read, preset
  materialization and WooCommerce Report read.
- Connector ingestion, D1/Lark ingestion writes, full reconciliation, AI and all schedules remain
  disabled; Production remains blocked.

## Unreleased — WooCommerce Snapshot Idempotent Normalization — 2026-07-30

### Reliability

- Made WooCommerce final snapshots normalize identically from raw D1 snake_case rows and already
  normalized camelCase objects.
- Preserved lifecycle, generation, Queue, Coverage, JSON state/completion and all Commerce counts
  across repeated normalization.
- Added regressions proving exact continuation selects the same durable identity from both forms.

### Safety

- Failed preflight attempts stopped before Lark schema, backup, Worker deployment and Queue send.
- No Production, Schedule, Provider, Business, Coverage or Lark mutation occurred.

## Unreleased — WooCommerce Exact Snapshot Semantic Retry — 2026-07-30

### Reliability

- Added bounded read-only retry for successful-but-semantically-empty D1 snapshots during exact
  WooCommerce continuation preflight.
- Reused the existing D1 retry delays and limited retry eligibility to a fully empty
  Sync/Work/Queue/Coverage/Commerce snapshot.
- Kept populated contract mismatches fail-closed without retry.

### Safety

- Semantic retry runs before Lark schema, D1 backup, Worker deployment or Queue submission.
- No Remote mutation occurred during implementation; the same admitted operation remains the
  only continuation target.

## Unreleased — WooCommerce Exact-resume Reactivation — 2026-07-30

### Reliability

- Prevented the source-safe launcher from running generic failed-work recovery when an exact
  continuation operation is pinned.
- Restricted generic WooCommerce failed-work recovery to zero-Coverage, zero-Commerce-row work
  at both discovery and guarded mutation time.
- Allowed one-command and Final remote preflight to accept only one pinned active work identity
  with no other active work, no live locks and no pending WooCommerce migration.
- Restored the missing Final operator text helper that previously stopped exact continuation
  before any deployment or Queue send.

### Exact incident repair

- Added a one-row lifecycle reactivation operator pinned to
  `woo-final-full-e2372e56d52d` and the accidental recovery audit identity.
- Guarded the update with the exact failed code, incomplete phase/page, Work/Queue/Fence
  generation, Coverage state and 14 Commerce table counts.
- Preserved phases, work units, generation fences, Queue evidence, Coverage, Business facts and
  Lark records through immutable pre/post verification.

### Safety

- Repository implementation and Live incident inspection performed no Worker, Queue, D1
  lifecycle/Business, Lark, Provider, Schedule, Secret or Production mutation.
- The only authorized post-merge repair is the exact guarded lifecycle row; the existing
  operation must then be resumed without admitting a replacement full operation.

## Unreleased — Platform-neutral Commerce Report Runtime — 2026-07-30

### Report integration

- Registered WooCommerce as an active `commerce` capability in the shared Report platform
  adapter registry and canonical Report settings.
- Adapted the existing D1 Commerce report into validated platform-neutral materializations with
  deterministic metrics and bounded discovered collections.
- Reused the shared D1 materialization, universal Dashboard model and Lark Snapshot/Metric writer;
  no WooCommerce-specific Dashboard renderer or Lark output engine was added.
- Required an isolated report-only runtime window: Commerce report read true while ingestion,
  full reconciliation and Schedule flags remain false.

### Safety

- AI summary and Daily/Weekly schedules remain disabled.
- Commerce collections are bounded before the shared materialization payload limit.

## Unreleased — WooCommerce Exact Durable Continuation — 2026-07-30

### Reliability

- Added a read-only, fail-closed preflight for resuming an already-admitted partial WooCommerce
  operation through its original operation ID, work key, generation and requested-at identity.
- Corrected final-rollout Queue attempt evidence to read `main_queue_attempts` instead of counting
  the single durable operation row.
- Exact continuation is checked before any Lark or Worker mutation, reuses the original full
  reconciliation job and still finishes with the all-false Safe deployment.

### Safety

- The continuation path never abandons durable work or admits a replacement full operation.
- Schedule/Cron remains disabled and Production remains out of scope.

## Unreleased — WooCommerce D1 Bound-parameter Continuation — 2026-07-30

### Repository correction

- Chunked WooCommerce derived-row value reads to 99 values while reserving one D1 bound parameter
  for the account scope.
- Preserved allowlisted table/field validation, prepared statements, deterministic ordering and
  the existing D1/Lark write contracts.
- Added a regression proving a 100-key customer aggregate read becomes two queries with 100 and
  2 total bindings instead of one invalid 101-binding query.

### Safety

- The already-admitted partial operation remains the only continuation target.
- No Worker, Queue, D1/Lark, Schedule, Secret or Production action occurred during implementation.

## Unreleased — WooCommerce Final Safe Closeout — 2026-07-30

### Repository correction

- Replaced the final scheduled-active deployment in the existing WooCommerce one-command rollout
  with a verified all-false Safe closeout deployment.
- Kept the bounded manual UAT, full reconciliation, D1/Lark parity, same-operation replay and
  incremental validation stages unchanged.
- Final evidence now records `executionFlagsAllFalse=true` and `scheduleEnabled=false`.

### Safety

- Both successful closeout and automatic failure restoration use the same all-false Safe config.
- No Production, Schedule/Cron, Queue, D1/Lark, Provider or Worker action occurred during
  repository implementation.

## Unreleased — WooCommerce Exact Failed-operation Recovery 6f43 — 2026-07-30

### Repository correction

- Repinned the existing recovery-only operator to exact operation
  `woo-final-full-6f43ac8ee857` and a dedicated confirmation value.
- Retained the existing read-only pre/post snapshot, failed Sync Run, stale active work,
  no-live-lock, one-Queue-attempt, zero-Coverage and zero-Business-row eligibility guards.
- Kept the single guarded `sync_work_runs` lifecycle mutation isolated from phases, units,
  generation fences, Queue evidence, Business facts, Coverage and Lark.

### Live evidence and safety

- Provider diagnostics passed on merged `main@527cdceda2d4661c82dc000380705d1078343bdf`;
  the isolated Preview window made one Provider GET and restored Preview URLs disabled without
  changing Production deployment.
- The exact operation inspector classified the incident as terminal failed with stale active work,
  zero locks, one Queue attempt and zero rows across all 14 WooCommerce Business tables.
- Repository implementation performed no recovery mutation, deployment, Queue message, D1
  Business/Lark write, Schedule, Secret or Production action.

## Unreleased — WooCommerce Provider Redirect Diagnostics — 2026-07-30

### Repository correction

- Added bounded response redirect, URL-presence, source-origin match and exact-resource-path match
  booleans to invalid-JSON diagnostics after Live Provider HTTP `200` returned HTML/XML under a
  JSON Content-Type.
- Propagated only those booleans through the existing Worker diagnostics HTTP allowlist and
  read-only operation inspector.
- Kept invalid JSON fail-closed and retained the body hash/shape contract without persisting the
  response URL, body, prefix, credentials or unrestricted headers.

### Live safety

- The preceding Preview window uploaded isolated Active/Safe Versions, made one Provider GET,
  restored Preview URLs/workers.dev disabled and left Production deployment/traffic unchanged.
- Provider mutations, Queue messages, D1/Lark writes and Schedule mutations remained zero.

## Unreleased — WooCommerce Preview Alias/Version Pair Classifier — 2026-07-30

### Repository correction

- Classified Wrangler Preview URL evidence as aliased, versioned or invalid/foreign instead of
  rejecting one valid alias plus one valid versioned origin as ambiguous.
- Kept the deterministic alias origin as the only probe and Provider request target.
- Limited extraction to the six declared Preview fields/containers and supported their nested
  target/URL shapes without recursively scanning the whole upload record.
- Rejected malformed URLs, foreign Worker/account identity, custom domains, HTTP, credentials,
  ports, paths, queries, hashes, multiple distinct versioned origins and invalid Version IDs.
- Preserved only redacted fingerprints/counts in diagnostics evidence.

### Safety

- Active/Safe Preview configs, Queue sentinel and at-most-one Provider GET contracts are unchanged.
- Repository implementation performed no Worker Version upload/deployment, Provider request,
  Queue, D1/Lark, Schedule, Secret or Production action.

## Unreleased — WooCommerce Diagnostics Deterministic Preview Origin — 2026-07-30

### Repository correction

- Replaced mandatory Wrangler Preview URL extraction with a deterministic HTTPS origin built from
  validated Preview alias, Worker name and account workers.dev subdomain.
- Added a GET-only account subdomain lookup to the existing authenticated Preview URL wrapper and
  forwarded only the validated DNS label to the child operator.
- Kept exactly one structured `version-upload` and a valid Worker version ID as upload authority;
  any Wrangler URL is now an optional fail-closed equality cross-check.
- Redacted raw origins from operator output and retained only SHA-256 fingerprints in evidence.
- Corrected command-failed evidence so captured file count is independent from failures and a
  successful upload/application-level child failure cannot fabricate a Wrangler failure.
- Added behavior regressions for API parsing/GET-only access, label limits, missing/matching/
  mismatched/ambiguous/malformed URL output, Active/Safe isolation and evidence filtering.

### Safety

- Queue sentinel behavior and Preview-only config isolation remain unchanged.
- No Preview setting mutation, Worker Version upload/deployment, Provider request, Queue message,
  Remote D1/Lark action, Schedule, Secret, Production traffic or Live UAT action occurred.

## Unreleased — WooCommerce Diagnostics Queue Sentinel Hotfix — 2026-07-29

### Repository correction

- Added a fail-closed `queue(batch)` handler to the Preview-only WooCommerce diagnostics
  entrypoint after Cloudflare rejected both Active and Safe Preview Versions with
  `11001 Queue handler is missing`.
- The sentinel calls `batch.retryAll()` exactly once and never acknowledges, reads or processes
  a Queue message.
- Kept Business Queue routing, `createSyncWorker`, Infrastructure, Provider, D1, Lark, Queue
  producer and Schedule code outside the Preview sentinel.
- Reduced generated Active/Safe vars to the exact diagnostics target/source/auth/attestation
  allowlist while retaining no Queue, routes, triggers, D1 or Production bindings.
- Added Node and Workers-runtime regressions for handler exports, retry/no-ack semantics,
  no message/runtime access, fetch isolation, config isolation and Production Queue regression.

### Safety

- Production Worker entrypoint, Queue consumer runtime, deployment and traffic remain unchanged.
- Implementation performed zero Preview URL, Worker Version, Provider, Queue, D1, Lark, Secret,
  Schedule or Production action.
- Live diagnostics rerun remains separately unauthorized.

## Unreleased — Lark Dashboard Backfill Post-Apply Verification Hotfix — 2026-07-29

### Repository correction

- Replaced the single immediate post-Apply replan with five fresh read-only attempts at
  `0/1000/2000/4000/8000ms`, bounded by a 30000ms elapsed budget.
- Kept initial write execution at exactly once; verification retries never execute a Lark write.
- Added fail-closed persistent mismatch diagnostics limited to logical table keys, pending
  row/field-name counts, attempt/elapsed metadata and read strategy.
- Added focused semantic normalization regressions for Text, SingleSelect, integer/decimal Number,
  null and observed zero, plus persistent/eventually-consistent read behavior.
- Added a read-only recovery decision to normal Preview so a prior Apply is not repeated when
  `updateRows=0`.

### Safety

- No Backfill Apply, Remote Lark/D1 mutation, Worker deployment, Queue/DLQ message, Provider call,
  Schedule, Secret, Production or UAT action occurred.

## Unreleased — Lark Dashboard Shared Report Dimensions — 2026-07-29

### Repository implementation

- Added `customer_key`, extensible `capability` and aggregate `coverage_rate` to all four Lark
  Report output contracts; Metric, Top Content and Top Ads also receive `period_kind` and
  `window_days`.
- Preserved Snapshot `baseline_coverage_rate` as the distinct Organic baseline field.
- Preserved its legacy all-capability writer behavior so a Paid Ads rerun cannot clear an
  existing Snapshot value; the new `coverage_rate` remains the universal shared dimension.
- Reused the existing checksummed `report_materializations` reader and `TableSyncEngine`; one
  validated Shared dimension object now feeds Snapshot, Metric, Top Content and Top Ads rows.
- Kept Custom `window_days=null`, missing Coverage as `null`, observed zero as `0`, and every
  existing row Stable key unchanged.
- Strengthened the materialization reader to reject Storage-contract or payload/row metadata
  mismatches before any Lark plan/write.
- Added additive-only schema preview, writer, null/zero, idempotency, extensible capability and
  universal View regressions.

### Safety

- No Lark schema Apply, Table/View/Record write, Remote D1 action, Worker deployment, Queue/DLQ
  message, Schedule/Cron, Secret/config or Production action occurred.
- Existing rows are updated only on a future normal materialization write; any historical
  backfill remains a separate preview/confirmation-gated workstream.

## Unreleased — Report Runtime Closeout Sync Log Stable-key Hotfix — 2026-07-29

### Repository correction

- Aligned the Closeout Lark metadata preflight with the existing Shared Reliability contract:
  `MKT_Sync_Log` uses `sync_id`, not `sync_run_id`, as its Stable key.
- Added a regression that rejects reintroducing the stale Closeout mapping.
- Kept `MKT_REPORT_AI_SUMMARY_ENABLED=false`; no Lark field, Worker, Queue, D1 Business fact,
  Schedule, Secret or Production state was changed.

## Unreleased — Meta Facebook Page-token Runtime Hotfix — 2026-07-28

### Runtime incident

- Recorded a fail-closed Facebook D1-only operation rejected at
  `facebook.content.inventory` with sanitized Graph `190/2069032`.
- Verified zero Business/Coverage/Lark rows, no active lock and an all-false Worker restore at
  100% traffic.
- After Page-token activation, recorded a second fail-closed operation that staged 2,501
  historical content rows before account Insights returned time-window pagination without an
  opaque cursor; Business/Coverage/Lark rows remained zero and the Worker was restored all-false.
- GET-only probes confirmed the reviewed period contains 25 posts on one page and account Insights
  returned an empty requested-period dataset with `next/previous` time windows but no cursor.
- The next accepted D1-only run reached the durable D1 boundary and processed the exact replay,
  but both D1 and Lark operator rerun verifiers timed out because they counted
  `queue_operation_attempts` rows even though `operation_id` is the table primary key.

### Repository correction

- Added `META_FACEBOOK_PAGE_ACCESS_TOKEN` as the distinct Facebook Page business-read credential.
- Kept `META_ACCESS_TOKEN` for discovery and Meta Ads and blocked Facebook source creation when
  the Page credential is absent.
- Updated Facebook D1/Lark rollout preflight to require the Page secret name.
- Added focused regressions for credential separation, Page-only authorization and fail-closed
  behavior.
- Forwarded the reviewed `since`/`until` period to Facebook content inventory.
- Aligned non-cursor Facebook metric reads with the dataset contract by treating each requested
  period as one response while retaining cursor guards for cursor-paginated datasets.
- Removed three Facebook content Insights candidates rejected by the Live Graph v25 capability
  probe and retained the two metrics whose combined GET returned HTTP 200; unsupported engagement
  values remain `null`.
- Changed D1/Lark idempotent-rerun verification to require growth of the durable
  `main_queue_attempts` counter while retaining immutable Business, Coverage and reconciliation
  checks.
- Added an exact-confirmation, clean-tree, ancestor-bound continuation guard for completing the
  already-restored D1 evidence chain across an operator-only hotfix. Worker runtime/config changes
  remain forbidden by that guard.
- Cross-head closeout reuses an existing hash-valid, remotely reverified all-false restore instead
  of deploying an unmerged Worker bundle again.
- Limited Meta Organic Canonical account rows to the approved Live `MKT_Accounts` fields after a
  fail-closed Facebook Lark preflight exposed an unapproved `username` write. Provider identity,
  profile and follower facts remain in Shared RAW and D1 account-daily storage.

## Unreleased — Dashboard Rolling Period Presets and Custom Range — 2026-07-28

### Repository implementation

- Added a shared inclusive completed-day resolver for 3D, 7D, 9D, 15D, 30D, 90D and
  bounded Custom ranges with equal previous-period comparison.
- Added platform-neutral materialization and watermark-bound Custom request contracts that
  reuse `report_requests`, the existing Queue/Reliability path and `report_materializations`.
- Reused the TikTok D1-aware Organic baseline calculator and added shared Ads
  aggregate-then-ratio semantics with explicit null/zero and Coverage status handling.
- Added a repository-only Dashboard binding blueprint for Snapshots, Metric Values,
  Top Content and Top Ads.
- Added Canonical Integration Workspace Lark settings for compatibility 1D/7D, rolling
  3/7/9/15/30/90D and Custom range with shared `period_kind`, `window_days` and
  `dashboard_performance_report` contracts.
- Added an exact-scope guarded Lark reconciler that creates/updates Canonical settings before
  disabling legacy developer-profile rows; historical report references are retained and no
  record is deleted.

### Safety

- Migration required: none; Storage Foundation Migration `0009` already contains the
  approved request/materialization columns and Stable keys.
- Guarded Integration Workspace Lark reconciliation applied nine additive/option schema actions,
  created nine Canonical settings and disabled two exact legacy developer settings.
- No Report setting/history record was deleted; all 27 historical output references were retained.
- No Worker deployment, Remote D1 action, Queue message, Schedule/Cron, LIVE UAT,
  Secret/Production configuration change or Business-fact mutation occurred.
- Live Lark preview was read-only and found only the nine expected additive schema actions,
  two active legacy settings and 27 historical references.

## Unreleased — YouTube Worker Dry-run Rollout Operator — 2026-07-27

### Repository implementation

- Added the central `youtube_worker_dry_run` trigger and conditional Stable Queue contract with
  explicit `operationId`, `youtube:{operationId}` work key and fixed generation.
- Updated the dedicated YouTube route to use deterministic sync-run/work identity, API-key-only
  Public Data access and fail-closed Business/Lark/Analytics/Schedule/runtime guards.
- Skipped unrelated warning drain and expired-work cleanup only on the guarded operator path;
  normal YouTube behavior remains unchanged.
- Added plan-only rollout orchestration, per-phase exact confirmation, reviewed config comparison,
  full-SHA provenance, canonical SHA-256 evidence chaining, terminal D1 completion proof,
  one-message/no-resend enforcement and a version-guarded safe restore wrapper.
- Added actual Remote contract parsing for Worker version bindings/plain flags/Secret names,
  deployment traffic, Queue consumers, Cron schedules, routes and workers.dev state.
- Added dry-run completion replay preservation and a Workers-runtime/D1 integrated Queue replay
  test, plus zero-write, public-only client, tamper/config/provenance and legacy regressions.

### Safety

- Dry-run permits Shared operational state, Public YouTube GET and Lark planning GET only.
- Business/Coverage/checkpoint/Lark writes, Analytics, OAuth refresh and schedule changes remain
  forbidden.
- No Worker deployment, Remote D1/Lark action, Provider request, Queue/DLQ action, schedule change
  or Production action occurred.

## Unreleased — TikTok Post-Lark Audit Error Code Hotfix — 2026-07-27

### Runtime incident

- Recorded a controlled authenticated GET-only TikTok Audit response with HTTP `400`,
  `error=TikTok audit failed` and a null/missing diagnostic code.
- Restored the Worker to safe-closed HTTP `404` with TikTok Audit, Business-write and
  Schedule flags all `false`.
- Migration `0016` remains applied; no Queue message, Admission, D1/Lark Business write,
  Report cutover, Schedule activation or Production action occurred during the Audit.

### Repository correction

- Added the stable HTTP fallback code `TIKTOK_POST_LARK_AUDIT_FAILED` when shared
  operational sanitization has no source error code.
- Preserved known sanitized codes, including
  `TIKTOK_POST_LARK_AUDIT_UNAUTHORIZED` and connector/configuration codes.
- Added a rollout-operator HTTP failure boundary with local code
  `TIKTOK_POST_LARK_ROLLOUT_AUDIT_HTTP_FAILED` and details limited to
  `httpStatus` plus sanitized `remoteCode`.
- Added Node and Workers-runtime regressions proving generic-error redaction, known-code
  preservation, wrong-token `401`, disabled `404`, non-GET `405`, successful read-only
  behavior and zero Queue use.

### Safety

- This Hotfix performs no Worker deployment, Live Audit, Secret rotation, Remote D1/Lark
  mutation, Queue/DLQ action, Schedule activation or Production action.
- A new Remote Audit requires separate approval after Hotfix review, merge and an
  all-flags-false deployment gate.

## Unreleased — TikTok Organic Post-Lark D1 Parity — 2026-07-26

### Repository implementation

- Added bounded read-only probing of the protected TikTok Native RAW source with an exact Chemistry K identity check, deterministic compact watermark, duplicate rejection and two-read settling.
- Added additive Migration `0016_tiktok_post_lark_pipeline.sql` for durable source-watermark admission; it remains source-only and has not been applied remotely.
- Replaced the blind scheduled TikTok Business sync producer with a watermark probe and locked the scheduled Snapshot date to the previous completed Asia/Bangkok day.
- Added a staged-watermark fence before Business writes and preserved the existing Durable staging, Reliability, Queue/DLQ, D1 history, Coverage and Canonical Lark contracts.
- Added a bounded D1 TikTok Organic Report source supporting more than 800 Content identities, null/zero/correction semantics, Coverage-derived data status and deterministic baseline selection.
- Connected the existing default-false D1 shadow/read/materialization controls to the active Report route and added fail-closed Lark/D1 parity checks.
- Added Coverage-gated, idempotent post-processing Daily Report admission and a guarded GET-only operator audit route.

### Verification and safety

- Branch Verification run `#517` passed on code head `e3c00b93ea95b4a4e564f09cafacc40954b30593`:
  focused staged TikTok 4/4, Node Unit/Integration 868/868, Workers runtime 9/9,
  Report reliability 91/91, dependency audit with zero vulnerabilities and Wrangler dry-run.
- Corrected stale regression fixtures that still expected a blind scheduled TikTok Sync and current-day Snapshot date; the tests now assert the approved watermark-probe and previous-completed-day contracts.
- Opened Draft PR `#65`; it remains unmerged and all new execution/report/schedule flags default to `false`.
- No Remote D1 backup or Migration 0016 apply, Worker deployment, Queue send, DLQ redrive, Lark mutation, Recovery, schedule activation, LIVE UAT or Production action occurred.

## Unreleased — Google Ads Manager Script LIVE UAT Closeout — 2026-07-26

### Runtime completion

- Completed the original signed LIVE run `88351cb4-714d-49ef-91db-d95550a93ebf`
  without rerunning the Manager Script.
- Reconciled all six datasets, seven of seven chunks and 1,375 of 1,375 rows.
- Completed durable admission after four send attempts and closed the Work lifecycle.
- Persisted 1,090 Ads entity rows and 285 Ads daily rows in D1.
- Completed six of six Coverage runs with zero failed rows.
- Completed the eight-destination preflight and the resumable D1/Lark continuation path.

### Recovery evidence

- Redrove the exact third terminal record
  `terminal:f909996a2e4985697f3e67feacfe7c69` once after PR `#63` was merged and the
  bounded Recovery Worker was verified.
- Retained all three terminal records as forensic evidence with status `redriven`;
  none may be deleted, reused or redriven again.
- Preserved the original run generation `1785048890422` and avoided another Manager
  Script LIVE execution.

### Verification and safe close

- The guarded operator returned `ok=true` with exact transport counts, completed
  admission and durable Work, six Coverage rows and redaction of both staged payload
  locations.
- Closed the Recovery Window by deploying the normal Sync configuration at Worker
  version `dcee150f-34cc-4a6f-aafa-5b52ece44093`.
- Verified Google Ads Connector, signed ingress, Queue admission, D1/Lark writes,
  DLQ redrive and Google Ads schedule are all disabled.
- Kept the Manager Script at `DRY_RUN` with delivery disabled and kept Production
  blocked.
- Added the sanitized Project Brain closeout at
  `docs/project-brain/google-ads-manager-script-live-uat-closeout-2026-07-26.md`.

## Unreleased — Google Ads Lark Key-Field Contract Hotfix — 2026-07-26

### Runtime incident

- Confirmed the third controlled processing attempt passed the prior Lark DateTime
  and Canonical Ads v2 field-name defects.
- Recorded the next fail-closed boundary before any D1 or Lark business write:
  `UNHANDLED_SYNC_ERROR: TableSyncEngine requires campaign_key`.
- Verified `send_attempts=3`, zero `ads_entity_state` rows and zero
  `ads_daily_facts` rows for the Google Ads account.
- Kept the exact new terminal DLQ ID pending read-only verification rather than
  inferring or reusing either previously redriven DLQ.

### Source correction

- Aligned the processor Campaign routing key from `campaign_key` to
  `ads_campaign_key`.
- Aligned the Ad Group routing key from `ad_group_key` to
  `ads_ad_group_key`.
- Aligned the Creative routing key from `creative_key` to
  `ads_creative_key`.
- Preserved destination order, table bindings, Canonical row payloads, D1
  contracts, stable-key values, resumable phases, continuations, reconciliation
  and retry semantics.

### Verification and safety

- Added processor-level validation that every planned row contains its configured
  non-empty stable key.
- Added the exact eight-table key-field sequence for destination preflight and
  verified one-table-per-continuation Lark writes reuse the same contract.
- Branch Verification run `#510` passed syntax/architecture/hygiene, focused
  TikTok regression, 825 Node Unit/Integration tests, 9 Workers runtime tests,
  70 report reliability tests, dependency audit and Wrangler deployment dry-run.
- No Remote D1 mutation, Queue send, DLQ redrive, Lark write/schema mutation,
  Worker deployment, Manager Script execution, schedule or Production action
  occurred in this implementation.

## Unreleased — Google Ads Canonical Lark Mapping Hotfix — 2026-07-26

### Runtime incident

- Confirmed the first exact redrive passed the prior `RAW_Ads_Daily.metric_date`
  serialization defect and reached the Canonical Ads destination preflight.
- Recorded the second fail-closed boundary at `MKT_Ads_Accounts.ads_account_id`:
  the runtime adapter emitted a pre-migration alias that does not exist in the
  already-applied Canonical Ads v2 schema.
- Retained the new terminal DLQ
  `terminal:6b1c7a5142f1eedb12a2b40b0a7cba78` as `open`; the original DLQ remains
  `redriven` forensic evidence.
- Verified the second failure remained non-partial with zero D1 Ads business rows
  and zero Lark business writes.

### Source correction

- Replaced stale Canonical field aliases across Accounts, Campaigns, Ad Groups,
  Ads, Creatives and Daily output while preserving existing stable-key values and
  all D1 contracts.
- Preserved the Canonical Campaign `objective` field when supported by the signed
  source and omitted ungrounded ownership metadata from the generic adapter.
- Normalized Google Ads source statuses to the reviewed Canonical options
  `active`, `paused`, `removed` and `unknown`.
- Normalized Search, Display, YouTube, Demand Gen, Performance Max, Shopping, App
  and fallback channels to reviewed Canonical options.
- Derive Canonical Daily channel from the Campaign source enum when the signed v1
  transport uses its legacy `google_other` fallback.
- Resolve Campaign date-only fields to source-timezone local-midnight epoch values
  for Lark DateTime fields.
- Map Google video assets to Canonical Creative identity fields and convert average
  CPV micros to the Canonical display-unit `average_cpv` field.

### Verification and safety

- Added exact per-table Canonical field allowlists and forbidden-alias regression
  assertions so stale v1 names cannot silently return.
- Added value coverage for all six Canonical destinations, stable identities,
  nullable objective, status normalization, source-timezone dates and modern
  channel normalization.
- Final Branch Verification run `#505` passed syntax/architecture/hygiene, focused
  TikTok regression, 825 Node Unit/Integration tests, 9 Workers runtime tests,
  70 report reliability tests, dependency audit and Wrangler deployment dry-run.
- No Remote D1 mutation, Queue send, DLQ redrive, Lark mutation/write, Worker
  deployment, Manager Script execution, schedule or Production action occurred in
  this implementation.

## Unreleased — Google Ads LIVE Lark Date and Failed-Permanent Redrive Hotfix — 2026-07-26

### Runtime incident

- Recorded the first guarded Manager Script LIVE run
  `88351cb4-714d-49ef-91db-d95550a93ebf` with all six datasets, seven chunks and
  1,375 rows received.
- Confirmed processing failed permanently during Lark destination preflight before
  any D1 Ads fact or Lark business write.
- Identified the exact mismatch: source `metricDate` was forwarded as `YYYY-MM-DD`
  into Lark DateTime fields that require an epoch value or ISO-8601 instant with an
  explicit timezone.

### Source correction

- Convert Google Ads Lark daily `metric_date` values to epoch milliseconds at local
  midnight in the signed source timezone.
- Preserve D1 `metric_date`, Shared RAW/Canonical stable keys, Coverage identities
  and source payload JSON as the original date-only value.
- Add guarded `failed_permanent` exact-redrive support that clears terminal admission
  `completed_at` only when the same-generation staged LIVE payload is complete and
  unredacted.
- Continue to fail closed for completed/superseded Work, active locks, identity drift,
  redacted payloads, missing chunks and incomplete run counts.

### Safety and rollout

- Retain the original DLQ reference and staged transport payload for exact recovery;
  no new Manager Script LIVE run is required.
- Keep Script delivery, API/Sync Google Ads flags and schedules disabled throughout
  implementation.
- No Remote D1 mutation, Queue send, Lark write, Worker deployment or Production
  action is part of this branch.

## Unreleased — Google Ads Manager Script LIVE Gate Hotfix — 2026-07-26

### Architecture correction

- Locked the primary Google Ads ingestion path to Manager Script signed delivery:
  `Google Ads → Manager Script → HMAC ingress → reference-only Queue → D1 → Lark`.
- Decoupled Manager Script LIVE authorization from direct Google Ads API
  developer-token approval.
- Kept `google_ads_api_access_pending` as an informational state for the optional
  future direct API path instead of a Manager Script blocker.

### Security and reliability

- Manager Script LIVE still requires connected customer consent, the exact
  `adwords` OAuth scope, an active encrypted refresh-token reference, and exact
  approved Manager/advertiser mappings.
- Existing signed-delivery HMAC, key ID, timestamp, nonce/replay, runtime identity,
  manifest completeness, payload bounds, reference-only Queue, resumable D1/Lark
  phases, reconciliation and staged-payload redaction remain unchanged.
- API-derived currency/timezone metadata is checked when present, but is not
  required while direct API access is pending because signed Script/runtime
  identity remains authoritative for the Manager Script path.

### Tests and rollout

- Added focused Unit, HTTP integration, operator and executable SQLite/D1 coverage
  for API-pending and API-validated Manager Script consent.
- Updated the guarded rollout gate and runbook so pending Developer Token access
  does not stop Remote rollout or manual LIVE UAT.
- Remote D1 backup, Migration `0015`, Worker deployment, LIVE Queue processing and
  D1/Lark business writes remain unexecuted until the protected operator environment
  is available.
- Google Ads schedule and Production remain disabled.

## Unreleased — Google Ads Secret provisioning and External Signed PREVIEW Closeout — 2026-07-26

### Runtime validation

- Completed one-time Google Ads Manager Script Signing Secret provisioning from
  the actual Manager account with a five-minute capability Ticket, exact runtime
  identity binding and HMAC confirmation.
- Confirmed the Ticket reached `confirmed`; the provisioning route was restored
  to disabled / `404` and temporary Ticket-bearing Helper/clipboard material was
  cleared.
- Ran the actual Google Ads Manager Script External Signed PREVIEW using
  `AdsApp`, `AdsManagerApp`, Google Ads API `v24`, canonical JSON, HMAC and
  `UrlFetchApp`.
- Reconciled all six datasets, seven chunks and 1,375 rows; the D1 transport Run
  reached `preview_validated` and every staged payload was redacted.
- Verified zero Ads Business fact, Queue, DLQ, alert and Lark drift and zero
  Google Ads mutation.

### Final safety state

- Restored Signed ingress and Secret provisioning routes to disabled / `404`.
- Kept Google Ads Connector and Business-write gates disabled.
- Restored Script Properties to `DRY_RUN` and delivery `false`, removed the
  temporary delivery endpoint property and restored the clean Repository Script.
- Kept Queue admission, Sync Worker Business processing, D1 Ads facts, Shared
  RAW/Lark writes, schedules, LIVE and Production outside this Closeout.
- Recorded sanitized evidence in
  `docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md`.

### Documentation

- Updated Current Task, Project Brain, Current State and Next Actions for the
  completed safe-closed runtime gates.
- Preserved the full prior Current Task and Changelog records verbatim under
  `docs/archive/` before replacing the active files with current concise
  authorities.
- The next separately approved implementation boundary is Local reference-only
  Queue admission from completed authenticated transport references only.

## Historical changelog

The complete Changelog through `2026-07-25` is preserved verbatim at:

```text
docs/archive/CHANGELOG-before-google-ads-external-preview-closeout.md
```

That archive remains immutable historical evidence. New entries continue in
this active `CHANGELOG.md`.
