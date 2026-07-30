# Changelog

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
