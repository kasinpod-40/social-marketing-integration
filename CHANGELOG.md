# Changelog

## Unreleased — YouTube resumable-sync reliability hardening — 2026-07-19

### Fixed
- Added a durable generation/requested-at fence and guarded checkpoint compare-and-set so an older Queue retry cannot overwrite newer Lark data or roll back the cursor.
- Added fail-closed Analytics row validation for requested video, owner channel, and date scope before durable staging.
- Added a deterministic warning outbox and completed-work replay so reconciliation alerts survive primary alert-store failure without rerunning Source or creating duplicate business alerts.
- Added terminal/superseded/completed staging lifecycle, terminal audit/expiry metadata, DLQ/Permanent marking, guarded TTL cleanup, and a new-generation-only redrive contract.

### Data and release safety
- Added additive migration `0005_resumable_sync_reliability.sql` plus generation/status/expiry indexes without changing existing Business stable keys.
- Blocked nested ZIPs, `.mkt-locks`, SQLite runtime sidecars, macOS metadata, local config, secrets, outputs, and dependencies from clean releases.
- Verified stale A(100) → newer B(200) → A retry, 837-video resume/idempotency, row-scope rejection, warning replay, Permanent/DLQ cleanup, TikTok/Core regressions, empty/existing migration replay, audit, architecture, hygiene, and Wrangler dry-run.
- This source patch did not call Live APIs, apply Remote D1 migration, enqueue jobs, deploy, change schedules, mutate secrets, or touch Production.

## Unreleased — YouTube large-account resumable sync — 2026-07-19

### Fixed
- Raised the 837-video Analytics scope issue to a release blocker and kept daily Content traversal at 100 recent videos without narrowing Owner Analytics inventory.
- Added exact expected-versus-queried video markers so a valid zero-row response remains distinguishable from an incomplete Analytics scope.
- Added fail-closed completeness validation; an incomplete/corrupt scope cannot be reported as a complete success.

### Added
- Added additive D1 migration `0004_resumable_sync_work.sql` with generic work/phase/unit staging for durable page/chunk resume.
- Added a single-page uploads API and resumable Content inventory, Video resource, and Analytics page/chunk orchestration.
- Added total tracked/selected/queried/skipped/failed/pages/chunks/completeness counters to the sync result and D1 Sync Log details.
- Added 837-video fixtures for Full traversal, Content-100/Analytics-837 separation, page failure resume, mid-Analytics retry, scope corruption, and Stable-key full rerun.

### Architecture and safety
- `sync_work_*` remains temporary staging; `source_record_states` and `sync_cursors` still commit only after all Lark business writes succeed.
- Staged units are read in bounded pages, all destination tables are planned before the first write, and Account remains last.
- Documented the shared large-account contract for Instagram 1,941 posts, TikTok hundreds, and Facebook hundreds-to-thousands; those connectors remain planned/fail-closed.
- Passed Unit/Integration 397/397, Workers runtime 8/8, Report reliability 60/60, focused YouTube/Scheduler/Queue/Reliability/Resumable-work 69/69, Architecture 111/232/0, repository hygiene, offline audit 0, SQLite migration replay, and Wrangler dry-run 480.80 KiB / gzip 97.58 KiB.
- No Live API, Lark, Queue, D1 remote migration, deployment, Secret, or Production mutation occurred in this source patch.

### DEV rollout
- Pushed commit `44377ce`, applied remote D1 migration `0004_resumable_sync_work.sql`, verified all three work tables, and deployed Worker version `2037232c-152a-4e26-95fa-fca044f65bd9` at 100% traffic.
- Verified both Cron triggers remain `*/5 * * * *` and `50 0,6,12,18 * * *`; Meta, Instagram, WooCommerce, Chatwoot, and Production remain disabled.
- Full and incremental Queue smoke runs completed with `success`, retry 0, and no newly created Stable-key rows.
- Owner Analytics smoke completed with tracked=selected=queried 2/2/2, skipped=0, failed=0, one page/chunk, and completeness `complete`.
- Final D1 state has no staged work, active lock, or open YouTube alert; read-only Lark verification found zero duplicate Stable keys across Account, RAW, Content, and Daily tables.
- The allowlisted DEV channel has 2 videos. Deterministic 837 fixtures pass, but Customer-owned 837-video Live UAT is still required before Production release.

## Unreleased — YouTube scheduler and Analytics review hardening — 2026-07-19

### Fixed
- Decoupled Owner Analytics tracked-video scope from the Content incremental recent-video limit by combining all D1 checkpoint video IDs with the current uploads traversal.
- Reused the complete tracked-video scope for Analytics reconciliation so previously observed facts for older videos cannot silently fall outside the re-fetch scope.
- Rejected enabled `MKT_YOUTUBE_ANALYTICS_TIME` values that the dedicated YouTube Cron cannot reach in the configured timezone.
- Replaced negative Cron routing with an explicit Primary/YouTube whitelist; unknown Cron values enqueue no TikTok, YouTube, or Report jobs.

### Safety and verification
- Preserved Data API recent-window traversal, stable keys, idempotency, plan-before-write, Account-last, checkpoint-after-write, lock/retry/DLQ/Alert behavior, and fail-closed release examples.
- Added a 105-video incremental regression with a 100-video Content limit, old-video Analytics reconciliation, unsupported-time failure, and Unknown/Primary/YouTube Cron routing coverage.
- Passed Unit/Integration 388/388, Workers runtime 8/8, focused Report reliability 60/60, focused YouTube/Scheduler/Reliability 60/60, Architecture 109/230/0, repository hygiene, offline audit 0, and Wrangler dry-run 446.77 KiB / gzip 91.73 KiB.
- No Live API, Lark, D1, Queue, Schema, deployment, Secret, or Production mutation occurred in this review fix.

## 0.11.0 — YouTube Organic DEV activation — 2026-07-19

### Added
- Promoted the YouTube connector and Queue job from `uat_pending` to `active`.
- Added a dedicated Cloudflare Cron (`50 0,6,12,18 * * *`) for a YouTube Data API sync every six hours without duplicating TikTok/report jobs.
- Added a once-daily Owner Analytics policy at 07:50 Asia/Bangkok with a bounded seven-day overlap over completed `America/Los_Angeles` source dates.
- Added Queue-level Analytics least privilege: a job can opt out, but cannot enable Analytics above the runtime feature flag.
- Replaced the UAT-only payload helper with `npm run job:youtube-sync`.

### Live DEV activation
- Public/OAuth preflight and final Lark Schema Preview passed; Preview remained zero drift across all three RAW tables.
- Deployed active connector, Owner Analytics, and both Cron triggers to Cloudflare DEV Worker version `f46c0c7f-0119-4f78-8e8d-2d37e17823a5`.
- Active Data API smoke test completed `success` with retry 0; it created the expected new daily snapshot rows for the new metric date, left no active lock, and created no open YouTube alert.
- Active Owner Analytics smoke test completed `success` with retry 0 and created the first real RAW Analytics row from the bounded Pacific-date window; read-only Lark verification confirmed count 1.
- Release examples remain fail-closed: every connector and schedule flag is still `false` until the target environment passes its own Schema/UAT gates.

### Verification
- Unit/Integration 384/384, Workers runtime 7/7, Report reliability 58/58, Architecture 109/230/0, repository hygiene and Wrangler dry-run passed.

## 0.11.0-rc.2 — YouTube Lark Schema and core Queue UAT — 2026-07-17

### Fixed
- Corrected YouTube Hyperlink fields from `ui_type=URL` to the official case-sensitive Lark enum `Url` and added regression coverage.
- Added managed Thai Field info for all 42 YouTube RAW fields while preserving existing Lark field properties and Select option IDs during full updates.
- Added emoji-prefixed create names and backward-compatible aliases for the three YouTube RAW tables.
- Set all six YouTube RAW DateTime fields to `yyyy/MM/dd HH:mm` with `auto_fill=false`.
- Classified Channel/Owner identity mismatches as permanent `YOUTUBE_CHANNEL_IDENTITY_MISMATCH` errors instead of unstructured `TypeError`.

### Live DEV verification
- Granted the `Social MKT Sync` application `Can manage` access in the developer Base.
- Recovered safely from a partial Apply that had created Channels before Lark rejected the first Hyperlink-bearing table.
- Created all three YouTube RAW tables and confirmed the final read-only Preview has zero actions, conflicts, warnings, or manual actions.
- Renamed the live tables with `📺`/`🎬`/`📊`, moved them under `🧪 Raw Integration Tables`, applied Thai Field info to all 42 fields, and verified a Thai tooltip in the Lark UI.
- Re-ran Preview after the presentation changes; all emoji-prefixed names resolved with zero schema drift.
- Stored returned Table IDs only in ignored local configuration; no Live IDs or secrets were added to Source.
- Deployed the DEV Worker behind the separate YouTube UAT gate and completed First Full, idempotent Full rerun, checkpoint-driven incremental, and Owner Analytics valid no-data runs.
- Verified five successful D1/Lark Sync Log rows, zero failed/partial/alerts, and stable Lark counts after reruns: Channel 1, Video 2, Analytics 0, Account 1, Content 2, and Daily 2.
- Verified the Client role already has `No access` for all three YouTube RAW tables.
- Completed controlled lock collision/retry and timeout exhaustion → DLQ → mirrored D1/Lark Critical Alert; restored safe settings, passed a retry-0 healthy run, and retained the Test incident as `resolved`.
- Completed Live OAuth read-only identity mismatch classification/redaction and non-destructive production-path fault tests for missing resources, quota/rate-limit, lease renewal/loss and alert persistence.
- Restored the final safe deployment with normal YouTube, Owner Analytics, and YouTube Schedule disabled; Activation review remains pending.

### Verification
- Unit/Integration 377/377, Workers runtime 6/6, Report reliability 53/53, focused Reliability faults 34/34, Architecture 109/231/0, repository hygiene, audit 0 and Wrangler dry-run 444.25/90.99 KiB passed.

## 0.11.0-rc.1 — YouTube Organic Manual DEV UAT implementation — 2026-07-15

### Added
- Added guarded YouTube RAW schema Preview/Apply derived from the approved v0.10.2 Blueprint.
- Added Public Data and optional Owner Analytics access preflight with channel-owner identity validation.
- Added API-key, short-lived OAuth, and refresh-token clients with placeholder rejection before External requests.
- Added RAW Channel/Video/Analytics writes, field-grain validation, Canonical Content/Daily mapping, and Account write-last behavior.
- Added Manual Queue routing, D1 checkpoint, recent-window incremental mode, periodic full reconciliation, Sync Log/Lock/Retry/DLQ reuse, and reconciliation warning alerts.

### Fixed
- Reconciled only previously observed Owner Analytics stable keys inside the exact re-fetch Video/date scope; disappeared rows are retained and emit one deterministic warning without fabricating never-observed gaps.
- Made D1 warning-alert persistence a real Queue acknowledgement gate; primary failure is retryable and cannot be swallowed after business writes succeed.
- Centralized operational redaction across Workers logs, D1 error/details/payloads, and the Lark reliability mirror while preserving safe counts and error codes.
- Restored placeholder-only release examples, removed local macOS metadata and the byte-identical Blueprint copy, and corrected the handoff link to the canonical workbook.
- Made packaging reflect deliberate working-tree deletions and reject duplicate Manifest entries; stale generated Manifest/verification files are no longer kept in Source.

### Safety
- YouTube remains `uat_pending`; Manual UAT requires a separate flag while the normal connector flag remains false.
- No YouTube Scheduler producer, Live API call, Lark Schema Apply, Queue mutation, deployment, Meta work, or Production activation occurred in the source build.
- Official foundation baseline is `v0.10.2-multi-channel-foundation-approved`.

### Verification
- Hardened source and fresh-archive gates passed: Unit 376/376, Workers 6/6, reliability 53/53, Architecture 109/230/0, audit 0, and Wrangler dry-run 443.78/90.89 KiB. Archive verification found zero blocked, missing, sensitive, or duplicate artifacts.

## 0.10.2-rc.2 — YouTube Blueprint and clean artifact corrections — 2026-07-15

### Fixed
- Added deterministic YouTube Analytics `sort=day,video` before bounded pagination.
- Standardized cumulative daily stable keys and mapping on `metric_date`.
- Split never-observed Video×Day gaps from previously observed rows missing on re-fetch; no fabricated zero or noisy Cartesian warnings.
- Expanded YouTube canonical mapping to destination-field granularity and source metadata to all 42 fields.
- Added Workbook/source parity regression tests.
- Restored safe `.gitignore` and `.dev.vars.example`, corrected release required paths, and removed duplicate D1 sensitive scanning.
- Archived the deprecated Canva-ready schema note and excluded local config/output artifacts from releases.

### Safety
- No Lark Schema Apply, YouTube API call, route/schedule activation, deployment, or Meta implementation.
- Official baseline remains `v0.9.7-agent-workflow-foundation`; user Blueprint approval remains pending.


## Unreleased — YouTube Organic Blueprint v0.10.2

### Contract revision
- Revised the YouTube Channel RAW grain to one latest-state row per Channel and added an activation gate for a missing uploads playlist.
- Added `subscriber_count_hidden` plus explicit hidden/rounded subscriber-count semantics.
- Added `last_seen_at`, `source_availability_status`, and `missing_since` with retain/warn/no-delete/no-zero reconciliation rules.
- Fixed Phase 1 canonical classification at `content_type=video`; Shorts classification remains deferred.
- Defined Owner Analytics by exact Pacific `source_metric_date`, bounded `day,video` query/pagination rules, latest-available-date behavior, and explicit metric units.
- Kept Owner Analytics RAW-only in Phase 1 so period metrics cannot overwrite cumulative `MKT_Content_Daily` snapshots.
- Added explicit canonical mappings for `MKT_Accounts`, `MKT_Content`, and cumulative `MKT_Content_Daily`.

### Blueprint and safety
- Added the visually verified 10-sheet `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx` with 9 tables, 105 fields, a YouTube mapping sheet, and an approval sheet.
- Upgraded the repository contract to `youtube-organic-v2` and added focused regression coverage for fields, query/date/unit semantics, reconciliation, and canonical isolation.
- This revision does not Apply Lark Schema, call Live APIs, enable routes/schedules, deploy Workers, or expand into Meta implementation.
- User approval and authorized DEV preflight remain blocking gates.
- Verification passed: Unit/Integration 348/348, Workers-runtime 6/6, Report reliability 51/51, Architecture 99/195/0, repository hygiene, offline audit 0, and Wrangler dry-run 373.74 KiB / gzip 76.31 KiB.

## 0.10.2-rc.1 — 2026-07-15

### Configuration safety
- Added `LARK_TABLE_MKT_ACCOUNTS` to both safe examples and a shared YouTube required-table preflight covering Account, three RAW tables, Content, and Daily.
- Disabled every connector and schedule in release examples; customer profile, handle, D1 name, report-setting keys, and Table IDs remain placeholders.
- Kept `wrangler.sync.jsonc` local-only and did not mutate Lark, D1, Cloudflare, Queues, or external APIs.

### Release hygiene
- Added deterministic Clean ZIP packaging plus independent Allowlist/Blocklist, Secret/DEV ID, duplicate-artifact, Manifest, and SHA-256 verification.
- Expanded Repository hygiene for AppleDouble/macOS metadata and release-blocked tracked paths.
- Removed the ignored duplicate Blueprint under `outputs/v0.10.1/` and retained only the canonical workbook under `docs/`.
- Removed actual DEV Lark Table IDs from release documentation; mappings now live only in Local configuration.

### Status
- This is `clean_candidate_pending_user_blueprint_approval`, not an approved baseline.
- YouTube Account destination write, Worker routing, Schema Apply, OAuth, Live UAT, and schedules remain out of scope and fail-closed.

### Verification
- Clean `npm ci`, Unit/Integration 347/347, Workers-runtime 6/6, Report reliability 51/51, Architecture 99/195/0, repository hygiene, online/offline npm audit 0, and Wrangler dry-run 373.74 KiB / gzip 76.31 KiB passed.
- TypeScript, separate lint, and production-build commands are N/A because this JavaScript repository has no such scripts; syntax/architecture/hygiene and Wrangler bundle are the applicable gates.

## 0.10.1-multi-channel-foundation-reviewed — 2026-07-15

### Fixed
- Removed unsupported `maxResults` from `videos.list` requests filtered by `id`, while retaining 50-ID batching.
- Classified YouTube `quotaExceeded` as terminal `YOUTUBE_QUOTA_EXHAUSTED` instead of a short retry; rate limits and backend failures retain bounded retry behavior.
- Made `docs/current-task.md` use one honest status: `review_complete_pending_live_uat`.

### Data model
- Upgraded Canonical Ads to v2 with separate `Ad` and reusable `Creative` entities and added `MKT_Ads_Ads` plus its environment mapping.
- Made `spend_micros` and `conversion_value_micros` integer source-of-truth fields; report currency amounts and rates are derived from micros.
- Added strict decimal-string-to-micros parsing without JavaScript floating-point input.

### Blueprint
- Added `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.1.xlsx` with 9 tables, 101 fields, keys/metrics/null contracts, Select options, source traceability, and blocking UAT checklist.
- Rendered and visually verified all 8 workbook sheets; formula-error scan returned no matches.

### Safety
- YouTube remains `uat_pending`; Meta, WooCommerce, Chatwoot, and Ads remain `planned` and fail-closed.
- No Live API, Lark, D1, Cloudflare, Queue, or customer resource was mutated.

### Verification
- Clean `npm ci`, Node unit/integration 340/340, Workers-runtime 6/6, Report reliability 51/51, Architecture 94/189/0, repository hygiene, offline npm audit 0, workbook integrity/visual/formula verification, and Wrangler dry-run 373.74 KiB / gzip 76.31 KiB passed.

## 0.10.0-multi-channel-foundation — 2026-07-15

### Added
- Added a YouTube Organic source contract, three-table Lark RAW Blueprint, bounded Data/Analytics API client, channel/video adapter, normalization batch, and destination preflight.
- Added Canonical Organic identities, normalized rows, batch isolation/dedupe, and two-table destination planning shared by TikTok and YouTube.
- Added a versioned Meta Graph transport client with bearer auth, bounded cursor pagination, safe URL handling, and transient/permanent error classification.
- Added sanitized WooCommerce order and Chatwoot conversation contracts, fixtures, and validators without customer PII or credentials.
- Added a platform-neutral Ads Account/Campaign/Ad group/Creative/Daily contract with account-scoped stable keys and centrally calculated CTR/CPC/CPM/actual ROAS.

### Safety
- YouTube is explicitly `uat_pending`; Meta, WooCommerce, Chatwoot and Ads remain `planned`. No unverified Worker route or schedule was activated.
- Added placeholder-only config examples and raw YouTube table mappings; no Secret, token, customer data, D1 mutation, Lark mutation, deployment, or Live API call is included.
- Updated the Cloudflare example to compatibility date `2026-07-15` with `nodejs_compat` while retaining Wrangler 4.110.0-compatible schema.

### Verification
- Node unit/integration 336/336 and Workers-runtime 6/6 passed.
- Architecture passed at 94 source files / 189 local dependencies / 0 cycles; repository hygiene passed.
- Focused report reliability 51/51, offline npm audit 0, and Wrangler dry-run 373.71 KiB / gzip 76.31 KiB passed; see `docs/multi-channel-foundation-v0.10.0.md`.

## 0.9.7-agent-workflow-foundation — 2026-07-15

### Added
- Added repository-wide `AGENTS.md` as the shared operating contract for ChatGPT Work, Codex, and developers.
- Added `docs/current-task.md` as the single active handoff for status, scope, contracts, acceptance criteria, implementation evidence, and Work review.
- Seeded the next proposed workstream as YouTube Organic Data Model/Access Preflight while explicitly blocking connector coding until user approval and Blueprint completion.

### Changed
- Repository hygiene now requires `AGENTS.md` and `docs/current-task.md` so clean releases cannot lose agent context.
- Updated Project Brain, README, and Next Actions with the shared reading order and Work/Codex responsibilities.
- Bumped package/build metadata without changing deployed TikTok runtime behavior.

### Verification
- Node unit/integration 312/312, Workers runtime 6/6, focused Report reliability 51/51, and focused View/Lark/build 56/56 passed.
- Architecture passed at 77 source files / 168 local dependencies / 0 cycles; repository hygiene and npm audit reported no issues.
- Wrangler dry-run remained 363.52 KiB / gzip 74.69 KiB because deployed TikTok runtime behavior is unchanged.

## 0.9.6-tiktok-organic-dev-complete — 2026-07-14

### Release closeout
- Promoted the live-verified TikTok Organic DEV implementation to the clean handoff baseline after all ingestion, reliability, report, View, permission, and schedule activation work passed.
- Preserved the confirmed v0.9.5 Lark View fix: request-only filter fields, Checkbox Boolean `[true]`, Get View hydration, and separate Filter/Hidden-field PATCH operations.
- Recorded the deployed DEV Worker version `ba6f3968-628c-4c61-b7eb-62647b38f547`, six live Client Views, `Client` least-privilege role, enabled Daily/Weekly report schedules, and the successful first post-deploy cron.
- Added `docs/tiktok-organic-dev-complete-v0.9.6.md` as the canonical closeout and handoff record.

### Package hygiene
- Restored `.gitignore` and `.dev.vars.example` to the source package.
- Excluded `.dev.vars`, local `wrangler.sync.jsonc`, `.git`, `.wrangler`, `node_modules`, `.DS_Store`, `__MACOSX`, and AppleDouble metadata from the release archive.
- Removed the byte-identical `approved-for-dev` Blueprint duplicate, corrected the handoff link to the canonical workbook, and made release packaging ignore tracked files deliberately deleted from the working tree.
- Kept `wrangler.sync.example.jsonc` safe by leaving report schedule flags disabled by default; activation remains an explicit local operation.

### Verification
- Clean-tree gates passed: Node unit/integration 312/312, Workers runtime 6/6, focused Report reliability 51/51, focused View/client 53/53, Architecture 77 source files / 168 local dependencies / 0 cycles, repository hygiene, and offline npm audit 0.
- Wrangler 4.110.0 dry-run passed at 363.52 KiB / gzip 74.69 KiB; the final archive is extracted and retested before handoff.
- No production/customer credentials or customer-owned resources are included. Customer Production setup remains a separate phase.

## 0.9.5-lark-view-live-verified — 2026-07-14

### Fixed
- Matched the official Update View request contract: filter conditions now send only `field_id`, `operator`, and `value`; response-only `field_type` and `condition_omitted` are never echoed into PATCH.
- Preserved Checkbox values as JSON booleans, so the encoded filter value is `[true]` instead of `["true"]`.
- Added `getView()` hydration because this Lark tenant's List Views endpoint omits `property`; idempotent verification now reads the full Filter state from Get View.
- Kept Filter and Hidden-field mutations isolated in separate PATCH requests; Sort and Production permission remain UI work.

### Live verification
- Updated the two existing combined Views and created the four Daily/Weekly Views in the developer Lark Base.
- Get View confirmed all six Filters, including Checkbox and SingleSelect option-ID conditions.
- Final read-only Preview: `createViews=0`, `updateViews=0`, `conflicts=0`, `warnings=0`.
- Verification: Node unit/integration 312/312, Workers runtime 6/6, focused View 55/55, Report reliability 51/51, syntax pass, and Architecture 77 source files / 168 local dependencies / 0 cycles.
- Idempotent live Apply rerun completed with `ok=true`, `plannedActions=0`, and zero remaining actions/conflicts.
- Hidden fields applied and verified across all six managed Views; Daily/Weekly schedules enabled and Cloudflare Worker version `ba6f3968-628c-4c61-b7eb-62647b38f547` deployed.
- Lark UI saved and verified `rank` ascending with Automatic sorting across all six managed Views.
- Enabled Advanced Permissions and saved a `Client` role: Report Metric/Top Content outputs are View only; Daily, AI technical, Sync/System, and RAW tables are No access. DEV member assignment remains intentionally empty.
- Final gates: unit 312/312, Workers runtime 6/6, Report reliability 51/51, repository hygiene pass, npm audit 0, dry-run 363.52 KiB / gzip 74.69 KiB.
- Clean extracted-package retest passed all gates; first cron after deploy completed `success` at 22:01 Asia/Bangkok with 40 idempotent skips and no error.

## 0.9.4-lark-view-filter-only-patch — 2026-07-14

### Fixed
- Historical failed hypothesis: serialized `field_type` and `condition_omitted` into the request. Live v0.9.4 still failed with `1254001`; v0.9.5 removed these response-only fields.
- Replaced the combined View PATCH with a minimal filter-only PATCH. Existing View updates no longer send `view_name` or `hidden_fields`; missing Views are created first, then filtered in a separate request.
- Delegated Hidden fields and Sort to explicit `manualActions`, preventing presentation settings from blocking report filtering.
- Preview idempotency now compares only the managed Filter contract, so manual Hidden-field choices do not produce endless update plans.
- Added partial-create diagnostics (`viewCreatedBeforeFailure`, `createdViewId`, `viewMutationStage`) so a Create-success/PATCH-failure can resume safely on the next run.
- Corrected prior release notes: v0.9.1–v0.9.3 were hypotheses tested against a generic `1254001`; none was confirmed because the live tenant continued rejecting the first combined View PATCH.

### Verification
- Focused View/client tests cover string `field_type`, `condition_omitted`, filter-only mutation, manual Hidden-field actions, idempotency, and partial-create recovery.
- 310 Node unit/integration tests, 6 Workers-runtime tests, and focused Report reliability 51/51.
- Architecture audit: 77 source files / 168 local dependencies / 0 cycles; repository hygiene and npm audit 0 passed.
- Wrangler 4.110.0 dry-run passed; Worker bundle 362.96 KiB / gzip 74.63 KiB.
- Clean extracted-ZIP retest is part of the release gate.

## 0.9.3-lark-view-primary-field-fix — 2026-07-14

### Fixed
- Attempted to remove each table's Primary/Index field from `property.hidden_fields`; the live tenant still rejected the first combined PATCH, so this was not the complete root cause.
- Removed both Primary fields from the managed Client View hidden-field contract.
- Added a runtime safety guard that detects any Primary field requested for hiding, excludes it from the PATCH body, and emits `VIEW_PRIMARY_FIELD_CANNOT_BE_HIDDEN` instead of sending an invalid mutation.
- Kept the official View PATCH shape from v0.9.2: `view_name`, `property.filter_info`, JSON-array filter values, and non-primary `hidden_fields` only.
- The failed v0.9.2 Apply reported `appliedActionCount=0`, so no View was changed and no rollback is required.

### Verification
- Added regression coverage proving Primary fields never reach `hidden_fields`.
- 308 Node unit/integration tests, 6 Workers-runtime tests, and focused Report reliability 51/51.
- Architecture audit: 77 source files / 168 local dependencies / 0 cycles; repository hygiene, npm audit 0, and Wrangler dry-run passed.
- Worker dry-run bundle: 362.69 KiB / gzip 74.56 KiB.
- Clean extracted ZIP retest is part of the release gate.

## 0.9.2-lark-view-patch-request-fix — 2026-07-13

### Fixed
- Attempted to remove numeric `field_type` from View PATCH conditions. Live Apply still failed, and v0.9.4 later aligned the field with the generated SDK schema as a string.
- Preserved numeric field type internally for filter validation, Checkbox/SingleSelect value resolution, response normalization, and idempotent Preview comparison.
- Kept filter values as JSON-array strings (`["true"]`, `["opt..."]`) and kept live SingleSelect option-ID resolution from v0.9.1.
- Added safe `viewMutationBody` diagnostics to View PATCH errors so any future contract mismatch exposes the exact non-secret request body.
- A failed v0.9.1 Apply with `appliedActionCount=0` changed no View and requires no rollback.

### Verification
- 307 Node unit/integration tests and 6 Workers-runtime tests.
- Focused Report reliability suite 51/51.
- 77 source files, 168 local dependencies, 0 cycles, repository hygiene, npm audit 0, Wrangler dry-run.
- Worker dry-run bundle: 362.69 KiB / gzip 74.56 KiB.
- Clean extracted ZIP retest is part of the release gate.

## 0.9.1-lark-report-view-filter-fix — 2026-07-13

### Fixed
- Attempted to add numeric `field_type`; the generated SDK model later showed the field is represented as a string, and the combined mutation still failed live.
- Encoded each View filter `value` as a JSON-array string instead of sending a raw scalar.
- Resolved SingleSelect contract names to the live Lark option IDs before mutation; missing or duplicate options now fail closed during Preview.
- Canonicalized Checkbox values and live View responses so Preview after Apply is idempotent across string/boolean response shapes.
- Included the managed View name in PATCH mutations and preserved the existing no-delete, explicit Preview/Apply safety model.
- A failed v0.9.0 View Apply with `appliedActionCount=0` changed no View and can be retried safely after upgrading.

### Verification target
- 305 Node unit/integration tests and 6 Workers-runtime tests.
- Focused Report reliability suite 51/51.
- 77 source files, 168 local dependencies, 0 cycles, repository hygiene, npm audit 0, Wrangler dry-run, and clean extracted ZIP retest.

## 0.9.0-tiktok-organic-dev-complete — 2026-07-13

### Added
- Added idempotent Lark Report Client View installer for Daily/Weekly Metrics and Top Content.
- Added Lark View API adapters for list/create/patch with pagination, filter, and hidden-field contracts.
- Added guarded local Report Schedule activator that validates DEV prerequisites and atomically enables Daily/Weekly flags.
- Added focused `test:report-reliability` suite and TikTok Organic DEV closeout evidence/runbook.

### Verified
- Live Daily/Weekly creation and idempotent reruns.
- Expected partial weekly baseline, fixed-rank stale cleanup/restore, and report lock collision/retry without duplicates.
- Deterministic tests distinguish first-table failure from later partial writes and preserve retry idempotency.

### Operations
- Client View sort and customer-role permissions remain explicit Lark UI/Production setup actions because they are outside the current View API mutation contract.
- Example report schedule flags remain disabled by default; the guarded activator changes only local `wrangler.sync.jsonc`.
- Customer Production deployment remains out of this DEV release scope.

### Verification target
- 303 Node unit/integration tests and 6 Workers-runtime tests.
- Focused Report reliability suite 51/51.
- 77 source files, 168 local dependencies, 0 cycles, repository hygiene, npm audit 0, Wrangler dry-run, and clean extracted ZIP retest.

## 0.8.2-lark-number-formatter-fix — 2026-07-13

### Fixed
- Replaced spreadsheet-style Number formatter patterns (`#,##0`, `#,##0.0000`) with Lark OpenAPI formatter enums (`1,000`, `0.0000`) across the versioned Report Schema.
- Added a shared Number-formatter compatibility layer so legacy aliases are normalized before Field Create/Update requests.
- Added regression coverage for every Number field in the five-table Report Schema and for the exact Lark mutation request body.
- A failed v0.8.1 Apply with `appliedActionCount=0` can be retried safely after upgrading; no rollback is required.

### Verification target
- `285` Node unit/integration tests and `6` Workers-runtime tests.
- `70` source files, `151` local dependencies, 0 cycles, repository hygiene, npm audit, Wrangler dry-run, and clean extracted ZIP retest.

## 0.8.1-lark-schema-installer-safety-fix — 2026-07-13

### Fixed
- Plain `npm run setup:report-schema` is now read-only even when `CONFIRM_WRITE=YES` remains exported in the shell.
- Apply now requires the explicit `setup:report-schema:apply` command together with `CONFIRM_WRITE=YES`.
- Removed Checkbox/UI-only field properties from Lark Create/Update payloads; Checkbox fields no longer send `styleId` or any `property` object.
- Canonicalized Lark field mutations to official OpenAPI keys such as `date_formatter` and `auto_fill`, while dropping unsupported keys such as `optionsType`, `timeFormat`, and `extractExternalUrl`.
- Added `ui_type` and field descriptions to mutation payloads when defined by the schema contract.
- Schema action failures now include the failed table/field action and the number of actions already applied, making partial installer progress recoverable and auditable.
- The installer remains idempotent, so a v0.8.0 run that stopped part-way can be resumed safely after a fresh Preview.

### Verification target
- `281` Node unit/integration tests and `6` Workers-runtime tests.
- `70` source files, `151` local dependencies, 0 cycles, repository hygiene, npm audit, Wrangler dry-run, and clean extracted ZIP retest.

## 0.8.0-lark-report-schema-installer — 2026-07-12

- Added `npm run setup:report-schema` with read-only Preview by default and guarded Apply via `CONFIRM_WRITE=YES`.
- Added the versioned five-table Report Schema contract (110 fields) for existing and new customer-owned Lark Bases.
- Added Lark OpenAPI adapters for listing/creating tables and creating/updating fields.
- Installer is idempotent, preserves existing Select option IDs/options, never deletes schema, and fails closed on type conflicts or unresolved configured Table IDs.
- New report tables are created with their stable key first; existing Primary-field mismatches are surfaced as explicit manual review actions.
- Added regression tests for Preview safety, alias/ID resolution, placeholder handling, option merging, type-conflict blocking, apply verification, and Lark request contracts.
- Report schedules remain disabled pending Schema Apply, Seed, and Live DEV Daily/Weekly UAT.

### Verification target
- 274 Node unit/integration tests and 6 Workers-runtime tests.
- 68 source files, 146 local dependencies, 0 cycles, repository hygiene, npm audit, Wrangler dry-run, and clean extracted ZIP retest.

## 0.7.2-completed-report-period — 2026-07-12

### Fixed
- Scheduled Daily/Weekly Report jobs now persist the previous completed local day as `periodEnd`, derived from the original `scheduledTime`.
- Added explicit month, year, and leap-day boundary regression coverage so Queue delay/retry cannot move a report onto an incomplete current day.
- Release package now includes required dotfiles and excludes `wrangler.sync.jsonc`, `.DS_Store`, `__MACOSX`, AppleDouble files, secrets, build caches, and local locks.
- Added an operator runbook for safely clearing an orphan Local file-lock mutation guard.

### Safety
- TikTok `metricDate` remains the scheduled local day; only Report `periodEnd` uses the previous completed day.
- Daily/Weekly Report schedules remain disabled until Lark schema, seeds, manual Daily/Weekly UAT, and idempotent rerun pass.
- Existing repositories that previously tracked `wrangler.sync.jsonc` still must run `git rm --cached wrangler.sync.jsonc` once; a ZIP cannot modify an existing Git index.

### Verification target
- 261 Node unit/integration tests and 6 Workers-runtime tests.
- 65 source files, 139 local dependencies, 0 cycles, repository hygiene, npm audit, Wrangler dry-run, clean extracted ZIP retest.

## 0.7.1-report-reliability-hardening — 2026-07-12

### Fixed
- Kept first-table report rejection as `failed`; `partial_success` now requires actual confirmed or unknown write progress.
- Bound scheduled TikTok `metricDate` to the local scheduled day and report `periodEnd` to the previous completed local day, both derived from the original `scheduledTime` for deterministic retries.
- Unified Queue/setting Top Content limit, bounded it to 1–100, and neutralized stale ranks with `data_status=no_data`.
- Made expired lease assertions fail closed and validated renewed lease expiry.
- Preserved prior confirmed Lark chunk progress when `beforeChunk` fails.
- Kept exhausted HTTP 429 / Lark `1254290` as retryable rejection instead of `LARK_BATCH_WRITE_UNKNOWN`.
- Serialized local file-lock mutation with an exclusive guard to prevent owner renewal/takeover races.
- Added repository hygiene rejection for tracked `.dev.vars` and `wrangler.sync.jsonc`.

### Operations
- Added persisted DEV Workers Logs/Traces to `wrangler.sync.example.jsonc`; customer Production sampling remains environment-owned configuration.
- Report schedules remain disabled pending Lark schema, seed, and Live DEV UAT.
- Added targeted regression tests and `docs/report-reliability-hardening-v0.7.1.md`.

### Verification target
- 258 Node unit/integration tests and 6 Workers-runtime tests.
- 65 source files, 138 local dependencies, 0 cycles, repository hygiene, npm audit, Wrangler dry-run, clean extracted ZIP retest.

## 0.7.0-tiktok-organic-report-foundation — 2026-07-12

### Added
- Added the reviewed TikTok Organic Report data-model blueprint before implementation.
- Added customer-scoped Daily/Weekly report settings seed with stable `report_setting_key`.
- Added TikTok report metric definitions with aggregation/null/formula metadata.
- Added cumulative-snapshot report calculation with previous-period comparison, new-content baseline, partial-baseline status, negative platform corrections, and weighted watch/completion metrics.
- Added normalized `MKT_Report_Metric_Values` and fixed-rank `MKT_Report_Top_Content` output contracts for client-facing Lark views.
- Added idempotent Daily/Weekly report jobs with plan-all-tables-before-write, reliability lock/log/DLQ integration, and timezone-aware scheduled producers.
- Added `seed:report-settings` and report schedule/table configuration examples.
- Added report calculation, schema loader, output, idempotency, scheduling, and Workers-runtime regression tests.

### Safety
- Daily/Weekly report schedules remain disabled until the Lark Report schema is updated, new Table IDs are configured, seed jobs pass, and Live DEV UAT is complete.
- `MKT_Content_Daily` remains a system cumulative snapshot table; client-facing users should use the normalized report views instead of raw/system tables.
- Fixed-rank Top Content rows use explicit no-data replacement values so Lark does not retain stale values when null cells are omitted.

### Verification target
- 245 Node unit/integration tests and 6 Workers-runtime tests.
- Syntax, architecture, repository hygiene, Wrangler dry-run, clean extracted ZIP retest, and npm audit.

## 0.6.0-tiktok-incremental-sync — 2026-07-12

### Added
- Added D1 migration `0003_incremental_sync.sql` with `sync_cursors` and `source_record_states`.
- Added deterministic SHA-256 fingerprints for RAW TikTok records and the Lark classification dictionary.
- Added automatic Full/Incremental planning with safe Full fallback for the first run, a new metric date, dictionary changes, source-record removal, and periodic reconciliation.
- Added checkpoint persistence after successful Lark business writes only; record states are chunked and the cursor is committed last so Queue retry remains idempotent.
- Added Lark record metadata (`createdTime`, `lastModifiedTime`, `lastModifiedBy`) and requests `last_modified_time=true`.
- Added integration tests for initial checkpoint creation, no-change destination-I/O avoidance, changed-record-only updates, and retryable checkpoint failure.

### Changed
- Scheduled TikTok jobs explicitly request `syncMode=auto`.
- DEV Sync config enables `MKT_TIKTOK_INCREMENTAL_ENABLED=true` and performs a forced Full reconciliation every 24 hours.
- Incremental runs still validate every RAW row and the entire dictionary for safety, but only changed records enter destination schema lookup, diff, and write planning.
- Package/build version updated to `0.6.0-tiktok-incremental-sync`.

### Live prerequisite
- Apply `0003_incremental_sync.sql` to the remote DEV D1 before deploying this release with incremental mode enabled.
- The first run after migration is intentionally Full and creates the checkpoint; later same-day unchanged runs should report `selectedRecords=0` and write nothing.

### Verification target
- 216+ Node unit/integration tests and 5 Workers-runtime tests.
- Syntax, architecture, repository hygiene, migration replay, Wrangler dry-run, clean extracted ZIP retest, and npm audit.

## 0.5.3-cloudflare-fetch-context-fix — 2026-07-12

### Fixed
- Wrapped the default Cloudflare Workers `globalThis.fetch` with the correct runtime binding before storing it on `LarkBitableClient`.
- Prevented injected Fetch implementations from being called with the `LarkBitableClient` instance as their accidental `this` value.
- Added a regression test that reproduces the incorrect Fetch invocation context observed during Live Queue UAT.
- Added the required `.dev.vars.example`, repository `.gitignore`, and removed macOS metadata from the release package.

### Live UAT context
- Main Queue routing and retry classification worked on Cloudflare DEV.
- The first live Queue request failed before receiving an HTTP response from Lark with `LARK_NETWORK_ERROR`; this release addresses the runtime Fetch invocation defect before continuing Distributed Lock and DLQ UAT.

### Verification target
- 200 Node unit tests and 5 Workers-runtime tests.
- Syntax, architecture, repository hygiene, public-registry lockfile, Wrangler dry-run, clean extracted ZIP retest.

## 0.5.2-portable-npm-lockfile — 2026-07-11

### Fixed
- Replaced internal build-environment Artifactory URLs in `package-lock.json` with portable `https://registry.npmjs.org/` tarball URLs so `npm ci` works on developer and customer machines.
- Added a repository hygiene gate that rejects non-public HTTPS registry hosts in `package-lock.json`, preventing internal registry leakage from future release packages.

### Verification target
- `npm ci` from a clean extracted ZIP using the public npm registry.
- Existing Node tests, Workers-runtime tests, repository checks, migrations, and Wrangler dry-run remain unchanged from v0.5.1.

## 0.5.1-cloudflare-deploy-hardening — 2026-07-11

### Fixed
- Moved the Sync Worker Wrangler example to the repository root so Worker entrypoint and D1 migration paths resolve correctly; `wrangler 4.110.0 deploy --dry-run` now passes.
- Made D1 the mandatory operational primary store and Lark a best-effort mirror; D1 failures now prevent Queue acknowledgement.
- Added chunk-aware Lark write progress and whole-sync `partial_success` accounting for later-chunk failures and ambiguous writes.
- Changed Queue routing to a strict whitelist for the Main Queue and DLQ; unknown queues are quarantined and never execute normal jobs.
- Added owner-scoped D1/local lease renewal, heartbeat guards before write chunks, and lost-lock detection.
- Moved TikTok source identity rejection before destination schema/search requests.
- Changed the local CLI to structured skipped/failed output instead of uncaught stack traces for expected operational errors.
- Removed the non-functional npm workspaces declaration and added repository hygiene checks for `.dev.vars` permissions and `.DS_Store`.

### Added
- Added a real scheduled Queue producer binding and hourly Cron example.
- Added Workers-runtime tests using `@cloudflare/vitest-pool-workers` for Main Queue, DLQ, unknown Queue, and scheduled producer paths.
- Added CI gates for unit tests, Workers-runtime tests, repository checks, and Wrangler dry-run.
- Added regression tests for later-chunk partial writes, D1 renewal, valid renewal, lost ownership, and fail-fast source identity.

### Verification target
- 199 Node unit tests and 5 Workers-runtime tests.
- Wrangler 4.110.0 dry-run, syntax checks, architecture audit, repository hygiene, SQL migration replay, and extracted ZIP retest.

## 0.5.0-reliability-layer — 2026-07-11

### Added
- Added `sync_run_id` lifecycle and persisted `MKT_Sync_Log` mirror for every TikTok write run.
- Added `MKT_System_Alerts` mirror with critical/warning alerts for partial, permanent, lock-release, and DLQ failures.
- Added D1 migration `0002_reliability.sql` with `sync_runs`, `sync_locks`, `dead_letter_jobs`, and `system_alerts`.
- Added atomic D1 lease lock keyed by customer profile, platform, account key, and sync type.
- Added local file lease lock to prevent two Terminal processes writing the same DEV Base concurrently.
- Added automatic Content/Daily consistency analysis and reconciliation metadata.
- Added retryable `SYNC_PARTIAL_WRITE` with the completed content result when Daily write fails.
- Added Cloudflare Dead Letter Queue consumer that persists failed messages, mirrors alerts to Lark when configuration is available, and never executes the dead-lettered job again.
- Added D1/Lark composite reliability store and secret-like key redaction for stored JSON payloads.
- Added reliability, D1/DLQ, composite-store, local-lock, Lark-mirror, partial-write, and reconciliation regression tests (191 total tests).

### Changed
- TikTok local write now requires `LARK_TABLE_MKT_SYNC_LOG` and `LARK_TABLE_MKT_SYSTEM_ALERTS`.
- Cloudflare TikTok write job now requires D1 binding `MKT_STATE_DB`.
- Queue retries include bounded delay and terminal permanent failures are persisted to D1 when available.
- Package/build version updated to `0.5.0-reliability-layer`.

### Safety
- Lark Content/Daily schema remains unchanged.
- Lark Base still has no cross-table transaction; partial writes are now detected, logged, alerted, and reconciled on rerun instead of being reported as silent success.
- D1 lease currently has no renewal heartbeat; lease duration must exceed the maximum expected sync duration.

## 0.4.0-multi-channel-foundation — 2026-07-11

- Added a central Connector Catalog for TikTok, Facebook, Instagram, YouTube, WooCommerce, and Chatwoot.
- Added strict per-connector runtime feature flags with `active`/`planned` implementation states.
- Kept TikTok active while all unfinished connectors remain disabled and cannot be enabled accidentally.
- Added customer-specific connector profiles for developer-owned DEV resources and customer-owned Chemistry K Production resources.
- Added `TIKTOK_SOURCE_HANDLE` runtime override so the real account handle can change at deployment without editing source code, while the stable account key remains profile-owned.
- Added an Application-layer Connector Registry and safe readiness summary for Health/Admin use without exposing account identities or secrets.
- Centralized Queue job types and introduced Queue schema version 1 with backward compatibility for existing jobs.
- Registered future connector/report/reconciliation/notification jobs as planned; they now fail permanently before loading Lark infrastructure instead of returning fake success.
- Split Queue validation from Lark infrastructure creation so unknown, planned, or disabled jobs do not touch credentials or initialize clients.
- Updated DEV/Cloudflare examples, README, Project Brain, deployment rules, and multi-channel foundation documentation.
- Package verification target: 170/170 tests, 43 source files, 82 local dependencies, 0 cycles, and coverage 93.99% lines / 84.37% branches / 93.30% functions.
- No Facebook, Instagram, YouTube, WooCommerce, or Chatwoot API client/mapping is included in this release; those remain blocked until each Data Model/Lark Blueprint and source contract is approved.

## 0.3.1-codebase-audit-hardening — 2026-07-11

- Continued the full codebase audit with correctness, reliability, and performance prioritized before exhaustive line-by-line comments.
- Required TikTok Video ID at the source adapter boundary and added regression coverage for missing IDs.
- Rejected unsafe numeric TikTok IDs and count metrics that would lose JavaScript integer precision.
- Verified TikTok shareable/embed URL account and video identity against the RAW Video ID.
- Added destination conflict guards for account mismatches and legacy/stale Content/Daily stable keys.
- Improved Classification Dictionary decoding for comma-separated values inside structured Lark cells.
- Kept live-schema serialization, filtered destination lookup, pagination guards, token refresh, retry classification, and ambiguous Create retry protection in one production path.
- Updated current-state, production checklist, README, Project Brain, and the full audit report.
- Package verification target: 140/140 tests, syntax checks, architecture audit, coverage, secret scan, ZIP integrity, and extracted-package retest.
- Live DEV validation/write remains a post-install gate because release packaging has no access to the developer's Lark secrets.

## 0.3.0-codebase-audit-hardening — 2026-07-11

- Split sync into plan and execute phases so Content and Daily schema preflight complete before the first write.
- Added filtered stable-key lookup, guarded pagination, schema/token caching, request pacing, response-body timeout, and retry classification.
- Prevented ambiguous Batch Create retries after network/timeout/5xx failures.
- Added strict runtime customer profiles for developer-owned DEV resources and customer-owned Chemistry K Production resources.
- Added source-account validation, destination identity conflict checks, strict date/number/URL/select contracts, and queue permanent/transient error handling.
- Added architecture audit, release checklist, full codebase audit report, and expanded regression tests.

## 0.2.8-runtime-customer-profiles
- Added central runtime environment and customer-profile selection.
- Added a developer-owned `dev_ft_pumkin` profile and customer-owned `chemistry_k` production profile.
- Separated TikTok stable account key from the detected source handle.
- Removed direct TikTok account identity reads from scripts and worker business flow.
- Added Thai comments for customer configuration and production deployment behavior.
- Added fail-fast validation for invalid development/production profile pairings.
- Added production readiness checklist and runtime configuration regression tests.

## 0.2.7-live-contract-preflight

- Added shared Lark source-cell decoders for rich-text arrays, URL arrays, and numeric cells.
- Updated TikTok Creator mapping to match the real Lark Base cell shapes found in the current exported Base.
- Added the full native TikTok traffic-source field name used by the current Base.
- Converted `metric_date` to Asia/Bangkok midnight epoch milliseconds before Lark serialization.
- Prevented TikTok content URLs from being incorrectly copied into `cta_destination`.
- Added destination select-option validation before writes.
- Upgraded `validate:tiktok` to load the live destination schemas and serialize every Content and Daily row without writing.
- Added source-account integrity checks so RAW TikTok rows cannot be written under a different configured account key.
- Added regression coverage for real Lark rich-cell shapes, select options, schema preflight, and source-account mismatch.

## 0.2.6 - Lark URL source contract
- Fixed TikTok native source mapping for Lark Bitable URL fields returned as `{ link, text }`.
- URL source values are now validated and extracted before domain normalization; arbitrary objects are never coerced to `"[object Object]"`.
- Added regression coverage using the real structured Lark URL response shape.

## 0.2.5-canonical-datetime
- Fixed TikTok `published_at` handling when Lark returns epoch milliseconds or numeric epoch strings.
- Added one shared canonical date-time parser for adapters and Lark field serialization.
- Epoch seconds are normalized to milliseconds; ambiguous timezone-less strings now fail before writes.
- Added range validation and regression tests for real Lark/TikTok date shapes.

## 0.2.4-lark-pagination-guards — 2026-07-11
- Fixed the production infinite-pagination defect in Lark field and record reads.
- Pagination now continues only when Lark explicitly returns `has_more: true`; a stale `page_token` is ignored when `has_more` is false.
- Centralized field and record pagination in one guarded paginator instead of maintaining duplicate loops.
- Added fail-fast protection for missing next tokens, repeated tokens, and excessive page counts.
- Added pagination completion/failure tracing without exposing credentials.
- Added real-contract regression tests for single-page, multi-page, stale-token, repeated-token, missing-token, empty-intermediate-page, records, and maximum-page behavior.
- Full test suite passes 50/50 and static JavaScript syntax checks pass.

## v0.2.2 Lark sync observability and timeout
- Added per-request timeout with AbortController so stalled Lark requests cannot hang forever.
- Added stage progress logs for TikTok sync.
- Timeout errors include the Lark API path and configured timeout.
- v0.2.3: Added end-to-end sync tracing for schema loading, destination pagination, sync planning, batch writes, request attempts, retries, elapsed time, and timeout diagnosis.

## 0.2.1-lark-schema-preflight

- Added Lark table-field metadata loading and per-table schema caching.
- Added a shared typed field serializer before all Lark writes.
- URL fields are now written as Lark URL objects (`{ link, text }`) instead of raw strings.
- Empty optional fields are omitted rather than sent as invalid values.
- Added preflight rejection for missing destination fields, malformed URLs, invalid numbers, and invalid date values with table/key/field context.
- Updated the universal sync engine to compare and write the same serialized representation.
- Added regression coverage for URL serialization, schema caching, field metadata loading, and preflight failures.

## 0.2.0-core-sync-engine — 2026-07-10
- Replaced connector-owned Lark upsert behavior with a storage-neutral universal `TableSyncEngine`.
- Made `LarkRecordRepository` a thin I/O adapter with only list/create/update operations.
- Removed the unused per-row Lark record-search path.
- Added one-read in-memory indexing, input dedupe, destination duplicate detection, changed-field diffing, batch create/update, and unchanged-row skipping.
- Added global Lark request pacing in addition to bounded retry/backoff and tenant-token caching.
- Changed sync-worker queue processing from concurrent jobs to sequential jobs against one runtime to prevent cross-job API bursts.
- Migrated TikTok content sync and metric-definition seeding to the shared engine.
- Added architecture audit documentation and universal sync-engine regression tests.
- All 36 tests and syntax checks pass.

## 0.1.8-lark-rate-limit-resilience

- Fixed Lark Base `1254290 TooManyRequest` during TikTok write sync.
- Replaced per-row concurrent record searches with one paginated destination-table read and an in-memory key index.
- Made content and daily snapshot table sync sequential to avoid request bursts.
- Added exponential backoff with jitter for Lark `1254290`, HTTP 429, and temporary 5xx failures.
- Added tenant access-token caching and shared in-flight token requests.
- Added regression tests for retry behavior, token caching, local upsert indexing, and canonical TikTok keys.
- All 33 tests and static syntax checks pass.

## 0.1.7-tiktok-canonical-keys — 2026-07-10
- Changed TikTok `content_key` from `tiktok::account_id::video_id` to the canonical `tiktok:account_id:video_id` format.
- Changed TikTok `content_daily_key` to `tiktok:account_id:video_id:metric_date`.
- Kept report snapshot IDs on their existing `::` format because they are a separate key contract.
- Centralized key formatting in the existing identity-key builder and normalized surrounding whitespace.
- Updated unit, batch, Lark sync, snapshot, documentation, and PROJECT_BRAIN expectations.
- Rechecked the complete codebase before implementation; no duplicate TikTok identity-key builder was found.
- Packaging validation passed 31 tests and syntax checks; live Lark validation remains pending because the packaging environment could not resolve `open.larksuite.com`.

## v0.1.6-local-lark-run-tools

- Added local `.dev.vars` runner utilities for Lark live validation and write sync.
- Added `npm run validate:tiktok` for safe dry-run validation against the real Lark Base.
- Added guarded write commands: `CONFIRM_WRITE=YES npm run sync:tiktok` and `CONFIRM_WRITE=YES npm run seed:metrics`.
- Added `.dev.vars.example` with full table mapping placeholders and clarified that `TIKTOK_CREATOR_ACCOUNT_ID` is an internal account key.
- Added `.dev.vars` parser tests and kept write commands protected from accidental execution.
- Added mandatory full-codebase review policy before every new feature, fix, connector, refactor, or release.

## v0.1.5-lark-live-sync-validation

- Added a non-mutating `tiktok.creator.native.validate` queue job for first Lark live-sync validation.
- Added `validateLarkLiveSync` to read real RAW TikTok Creator + Classification Dictionary rows and normalize them without writes.
- Added dry-run support to `syncTikTokCreatorNativeToLark`.
- Added tests for validation, dry-run behavior, and queue job routing.
- Updated README and Project Brain for the live validation workflow.

## 0.1.4-env-config-lark-dictionary
- Removed real Lark table IDs from source code and made table mapping env-driven.
- Added `LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY` support.
- Added Lark classification dictionary mapper that handles text, select-like, and multi-select-like field shapes.
- Updated TikTok Creator sync to load dictionary rules from Lark before normalization.
- Replaced hardcoded Chemistry K course/content rules in core classifier with client-editable dictionary rules.
- Added manual-review fallback for unmatched content instead of guessing business-specific fields.
- Added tests for env-driven table config, dictionary mapping, dictionary-based classification, and TikTok sync orchestration.

## 0.1.3-canva-report-data-model-support
- Added latest Lark table IDs for the Canva-ready Base structure.
- Added deterministic course/content/funnel classification for `MKT_Content` fields.
- Added `MKT_Metric_Definitions` seed rows and idempotent seed use case.
- Added `MKT_Report_Snapshots` row builder for weekly/monthly/YoY Canva-style report payloads.
- Wired sync-worker queue job type `metric.definitions.seed`.
- Updated TikTok Creator normalization to write course/theme/funnel/CTA classification fields.
- Added tests for classification, metric definitions, report snapshots, and updated TikTok normalization.

## 0.1.2-tiktok-creator-lark-upsert
- Added Lark Bitable client for token retrieval, paginated record reads, key search, batch create, and batch update.
- Added Lark record repository with O(n) key dedupe, bounded-concurrency lookups, and create/update split.
- Added TikTok Creator read/write sync use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Wired `sync-worker` queue job type `tiktok.creator.native.sync` to the TikTok Creator Lark upsert flow.
- Added tests for Lark upsert behavior and TikTok Creator Lark sync orchestration.
- Updated README, Wrangler example vars, Project Brain, and next actions.

## 0.1.1-tiktok-creator-poc-confirmed
- Recorded live TikTok For Creator POC result: native table creation, rename/move safety, sync-managed source, update-in-place behavior, and 20/21 video eligibility finding.
- Confirmed `RAW_TikTok_Creator_Videos` as the official TikTok Creator raw source.
- Expanded observed Lark field aliases for TikTok Creator native rows.
- Added O(n) batch normalization use case with upsert-key dedupe and skipped-row collection.
- Added tests for exact observed Lark labels, batch dedupe, and invalid row isolation.
- Updated Project Brain, API discoveries, POC notes, and next actions.

## 0.1.0-tiktok-creator-poc-foundation
- Started Phase 1A TikTok For Creator native integration support.
- Added robust TikTok Creator native row mapper with alias handling for observed Lark field names.
- Added normalization use case from `RAW_TikTok_Creator_Videos` to `MKT_Content` and `MKT_Content_Daily`.
- Added tests for TikTok metric parsing, null handling, invalid metric rejection, and daily snapshot output.
- Added `docs/poc/tiktok-for-creator-poc.md` live POC checklist.
- Updated Project Brain with current TikTok Creator POC status and next actions.

## 0.0.1-phase0-lark-foundation
- Updated Project Brain after Lark Base foundation setup.
- Recorded Lark Base name: `Social MKT Data Hub`.
- Recorded imported `MKT_*` and `RAW_*` tables.
- Recorded sidebar folder organization and table icon setup.
- Recorded primary field fixes for main MKT tables.
- Recorded field type, select option, and view/icon setup completion.
- Updated next action to TikTok For Creator Native Integration POC.

## 0.0.0-phase0 — Initial foundation
- Created Project Brain structure.
- Created JavaScript monorepo skeleton.
- Added domain metric rules.
- Added D1 schema draft.
- Added baseline tests for metric calculations.
- Added platform decision notes for TikTok and Google Ads strategy.
