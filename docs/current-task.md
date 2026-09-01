# Current Task — Customer Multichannel Production Cutover v1

## Status

```text
TASK_STATUS                              = CUSTOMER_META_K2_LOCAL_CPU_FINALIZER_REVIEW
CURRENT_PROGRAM                          = MULTICHANNEL_CUSTOMER_PRODUCTION_RUNTIME_V1
BASE_MAIN_SHA                            = 579fb062
CURRENT_BRANCH                           = codex/meta-k2-local-confirmed-d1
CUSTOMER_WORKERS_PLAN                    = FREE_UPGRADE_NOT_CURRENTLY_AVAILABLE
PRODUCTION_MUTATION_AUTHORIZED_THIS_BRANCH = REVIEW_MERGE_DARK_DEPLOY_THEN_ONE_CONNECTOR_AT_A_TIME
CUSTOMER_BASE_RUNTIME_READY              = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER        = NON_BLOCKING
PRODUCTION_D1_PROVISIONED                = TRUE
PRODUCTION_D1_MIGRATIONS                 = 21_OF_21
PRODUCTION_D1_QUICK_CHECK                = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED        = TRUE
PRODUCTION_DLQ_PROVISIONED               = TRUE
PRODUCTION_WORKER_DEPLOYED               = TRUE_REVIEWED_ACTIVE
PRODUCTION_WORKER_HEAD                   = add06f21-b539-43e4-a0aa-c926451314b4
PRODUCTION_QUEUE_CONSUMERS               = MAIN_1_DLQ_1
PRODUCTION_SCHEDULE_ENABLED              = TIKTOK_FACEBOOK_INSTAGRAM_META_ADS_WOOCOMMERCE_CHATWOOT_YOUTUBE
PRODUCTION_BUSINESS_TRAFFIC              = SOURCES_REPORT_AI_NOTIFICATION_LIVE
PRODUCTION_QUEUE_LARK_BOOTSTRAP_SMOKE    = PASS_IDEMPOTENT
PRODUCTION_CONNECTOR_UAT_ADMISSION       = MERGED_PR_677
LARK_TRANSPORT_REPAIR                    = MERGED_PR_678
LARK_TRANSPORT_REPAIR_MAIN_SHA           = 62bf0aa388ffc27c91242fd29f623fdf2fca518f
TIKTOK_PRODUCTION_UAT                    = PASS_COMPLETED_IDEMPOTENT
TIKTOK_PRODUCTION_UAT_OPERATION          = tiktok-prod-cutover-20260823-r1
TIKTOK_PRODUCTION_UAT_SOURCE_RECORDS     = 2046_READ_ONLY
TIKTOK_PRODUCTION_UAT_TARGET_WRITE       = CONTENT_5_CREATE_2041_UPDATE_DAILY_2046_CREATE_ACCOUNT_1_UPDATE
TIKTOK_PRODUCTION_UAT_DLQ                = terminal:eafd8e43f1ae5113d12905301496fd4e_OPEN_FORENSIC
TIKTOK_DLQ_REDRIVE_SUPPORT               = DO_NOT_BLIND_REDRIVE
PRODUCTION_DARK_STATE_RESTORED           = TRUE_VERSION_1dc1ae9c
PRODUCTION_MAIN_QUEUE_BATCH_SIZE         = 1_FREE_PLAN_SAFE
PRODUCTION_CRON                          = EVERY_5_MINUTES_PRIMARY_SCHEDULER
PRODUCTION_FIRST_RUN_WINDOW              = 2026-08-24_0735_TO_0745_ASIA_BANGKOK
PRODUCTION_MONITOR_AUTOMATION            = customer-production-cutover-monitor_ACTIVE
CURRENT_REPAIR_BRANCH                    = MERGED_PR_695
REVIEWED_SOURCE_UAT_READY                = TIKTOK_FACEBOOK_INSTAGRAM_META_ADS_GOOGLE_ADS_CHATWOOT
PRODUCTION_SECRET_BLOCKED                = NONE_CONFIRMED
YOUTUBE_CUSTOMER_RECONNECT               = NOT_REQUIRED_EXISTING_VALIDATED_GRANT
YOUTUBE_CREDENTIAL_CUTOVER               = COMPLETE_UAT_SCHEDULE_ACTIVE
CUSTOMER_BASE_PR_661                     = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                        = DEFERRED_NO_MUTATION
CUSTOMER_LARK_VIEW_HYGIENE               = COMPLETE_LIVE_PROVEN_FLAG_CLOSED
CUSTOMER_LARK_VIEW_FIELD_ORDER           = CANCELED_RUNTIME_REMOVED_CPU_SAFE
CURRENT_FREE_RUNTIME_REPAIR              = CODE_AND_GATES_PASS_LIVE_DEPLOY_RECOVERY_PENDING
CUSTOMER_QUEUE_AUTO_RECOVERY             = LIVE_PROVEN_ACTIVE_VERSION_56b969fa
GENERIC_DLQ_REDRIVE                      = DISABLED
CUSTOMER_QUEUE_DAILY_WRITE               = RESET_20260826_ACTIVE
CUSTOMER_META_K2_AD_CHANNEL_REPAIR       = DEPLOYED_VERSION_ac8aa2dc_LIVE
CUSTOMER_META_K2_BUC_RATE_LIMIT_REPAIR   = LIVE_ROOT_CAUSE_PROVEN_CODE_REVIEW_PENDING
CUSTOMER_META_K2_POST_SOURCE_MATERIALIZATION = V1_LIVE_COMPACTION_COMPLETE_V2_CODE_AND_FULL_GATES_PASS
CUSTOMER_META_K2_LOCAL_CPU_FINALIZER     = D1_COMPLETE_WIRE_DIGEST_REPAIR_REVIEW_PENDING
CUSTOMER_CHATWOOT_FREE_EXECUTION_CAP     = MERGED_PR_750_DEPLOYED_VERSION_d67e7847
CUSTOMER_POST_SOURCE_FREE_REPAIR         = MERGED_PR_751_DEPLOYED
CUSTOMER_YOUTUBE_D1_STORAGE_REPAIR       = LIVE_COMPLETE_838_CONTENT_1860_ANALYTICS
CUSTOMER_YOUTUBE_ANALYTICS_RESUME        = MERGED_PR_754_LIVE_COMPLETE_838_OF_838
CUSTOMER_YOUTUBE_LARK_DESTINATION        = CONTENT_COMPLETE_838_DAILY_RETAINED_245_RANGE_RESUME_REVIEW
CUSTOMER_STAGGERED_SCHEDULE              = CODE_FOCUSED_GATES_PASS_REVIEW_PENDING
DEV_TO_CUSTOMER_DATA_POLICY              = INSERT_ONLY_PRODUCTION_MISSING_NEWER_STABLE_KEYS
REPORT_PARITY_TARGET                     = EXACT_1D_3D_7D_30D_AFTER_CUSTOMER_D1_MATERIALIZATION
CUSTOMER_CHATWOOT_DAILY_DISCOVERY        = UPDATED_WITHIN_ONCE_CODE_AND_FULL_GATES_PASS
CUSTOMER_TIKTOK_20260827_FAST_BRIDGE     = COMPLETE_D1_LARK_REPORT_IMPORT_GATE_DISABLED
CUSTOMER_D1_FREE_CAPACITY_GUARD          = CODE_AND_FULL_GATES_PASS_REVIEW_PENDING
```

## Objective

Cut over every reviewed customer-owned connector from the Integration Workspace runtime to the exact
customer Production ownership tuple. Reuse the migrated D1 state and customer Base mappings, preserve the
Integration Workspace path, reject foreign Production profiles/ownership, deploy dark after review, then
enable and verify one connector schedule at a time before Report/AI/Notification activation.

Latest user authority on 2026-08-23 confirms that the source accounts, source data, and connector
credentials used in the Integration Workspace are already customer assets. Customer Production is
therefore a runtime cutover to the customer-owned Cloudflare resources and customer Lark Base, not
a new per-channel ownership onboarding. A secret that cannot be exported/read back remains a
technical secret-setting step in Customer Cloudflare, not an ownership blocker.

## Current authorized schedule and newer-only parity scope — 2026-08-27

- Customer source admissions are staggered at least one hour apart on the serial Queue: Meta Ads `00:30`,
  YouTube `01:30`, Chatwoot `02:30`, WooCommerce `04:30`, TikTok `05:30`, Facebook `06:30` and Instagram
  `07:30` Asia/Bangkok. Google Ads remains the customer-owned external Manager Script producer in the
  `03:00–04:00` provider window; the Cloudflare Google Ads schedule remains disabled to prevent duplicates;
- Daily Report runs only after every source window at `09:00`; Weekly Report runs Monday `09:15` and the exact
  weekly notification follows at `09:30`. Queue batch/concurrency remains `1` and the primary scheduler remains
  every five minutes;
- Dev data may be used only as an insert-only bridge for exact Customer-owned stable keys that Customer
  Production does not have and whose business date is strictly newer than the current Customer row boundary.
  Older/equal Production rows, operational Work, locks, cursors, DLQ, alerts and checkpoints are out of scope;
- read-only evidence currently shows newer Dev canonical data only for Facebook `2026-08-26`, TikTok through
  `2026-08-26` and WooCommerce through `2026-08-26`. Instagram, YouTube and Chatwoot are already at the same or
  newer Customer boundary; Dev Ads are older than Customer and must not be copied;
- completion requires Customer D1/Lark stable-key parity for the accepted delta, then fresh Customer-owned
  materializations for `1D/3D/7D/30D` with exact metric equality to the Dev reference for the same period end.
  Copying a Dev Report row without Customer source/D1 proof is not accepted as parity.

### Implementation result — staggered schedule code

- focused schedule/config/notification regression PASS `127/127`; Workers runtime PASS `18/18`;
- `npm run check` PASS (`811` source files, `2,448` local dependencies, zero cycles and hygiene PASS);
- full `npm test` PASS `3,255` Node tests plus `18` Workers-runtime tests; Report reliability PASS `106/106`;
- `npm audit --audit-level=high` PASS with zero vulnerabilities; deploy dry-run and `git diff --check` PASS;
- reviewed PR `#757` merged as `main@5559a7f0`; Customer Worker version
  `53e1dafc-4ffd-40c5-9a19-7e6f8bdfc49a` is active with the five-minute primary trigger and the daily
  `01:30` YouTube UTC trigger. The staggered Customer schedule/config readback is complete; next-window
  source completion remains part of final Production proof.

### Implementation result — strictly-newer Dev Lark bridge

- added a plan-only-by-default operator that reads only Dev canonical `MKT_Content`, `MKT_Content_Daily` and
  `MKT_Account_Daily`, then compares Customer D1 boundaries before generating any SQL;
- the reviewed live preparation selected exactly Facebook `95` rows for `2026-08-26` and TikTok
  `2,048`/`2,049`/`2,051` rows for `2026-08-24`/`25`/`26`, plus one Facebook Account Daily row. It excluded
  every older/equal date and excluded Instagram, YouTube, Chatwoot, Google Ads and Meta Ads;
- generated four private SQL chunks totaling `6,243` observations and six Production-missing Content master
  keys. Every statement is `INSERT OR IGNORE` into the allowlisted Organic/Account/Coverage tables; there is no
  update/delete path and no Work, cursor, lock, DLQ or Alert table reference;
- full-inventory Coverage is generated per exact platform/day so Report scope can be proven instead of inferred.
  SQL SHA-256 digests, the exact Customer boundary and the target account/profile/database are sealed in a
  private plan; apply fails closed if a schedule advances either boundary before execution;
- temporary SQLite execution against migration `0009` PASS with exact `95`, `2,048`, `2,049`, `2,051` row
  readback and six missing master keys; focused tests PASS `4/4`; `npm run check` PASS (`813` files, `2,452`
  dependencies, zero cycles/hygiene); full `npm test` PASS `3,259` Node tests plus `18` Workers tests; Report
  reliability PASS `106/106`; npm audit, deploy dry-run and diff-check PASS;
- live D1 apply, exact D1 verification, Customer-owned Report regeneration and same-period Dev metric comparison
  remain required. Dev Report rows will not be copied into Customer Production.

### Implementation result — TikTok 2026-08-27 exact newer-only fast bridge

- sealed the exact Dev canonical TikTok snapshot for `2026-08-27`: `2,053` Daily rows, two Content master rows
  absent from Customer D1 and one Account freshness row. Older/equal Customer dates and every non-TikTok table
  are excluded;
- extended the D1 bridge with a dedicated exact-date scope. Generated SQL remains `INSERT OR IGNORE` only and
  fails closed if the Customer boundary moves before apply; Work, cursor, lock, DLQ, Alert and the protected
  forensic terminal are outside the plan;
- added a temporary Customer-Production-only manual Queue importer that accepts only the sealed snapshot ID,
  allowlisted tables/fields, exact batch counts and 44 SHA-256 batch fingerprints. Content and Daily updates are
  rejected so existing Customer Business rows cannot be overwritten; the Account row may advance freshness only;
- focused importer/catalog/Queue/operator tests PASS `36/36`; `npm run check` PASS (`814` source files, `2,456`
  local dependencies, zero cycles and hygiene PASS); full tests, Report reliability, audit, deploy dry-run and
  diff-check PASS;
- reviewed PR `#762` merged as `main@2471e7bc`. Customer D1 readback proves exactly `2,053` observations,
  `2,053` distinct Content identities, complete full-inventory Coverage `2,053/2,053`, zero failed rows and the
  two previously missing Content state rows;
- the serial Customer Queue acknowledged all `44/44` sealed Lark batches on their first attempt with zero exact
  retry, DLQ or Alert. This wrote the two missing Content rows, `2,053` exact Daily rows and one Account freshness
  row without overwriting older/equal Customer Business rows;
- fresh Customer-owned TikTok `1D/3D/7D/30D` Reports for period end `2026-08-27` materialized successfully. The
  latest totals exactly equal the sealed Dev Lark source: tracked Content `2,053`, Views `138,265,961`, Likes
  `6,410,041`, Comments `26,143`, Shares `589,373` and Engagement `7,025,557`;
- Dev D1 contained only `189` TikTok observations for that date and its older Report was not copied. The exact
  Dev Lark snapshot is therefore the authoritative same-period comparison. The temporary Customer importer mode
  is disabled; active Customer Worker version is `787ca811-fab2-4a07-9a94-1199306d283f`.

### Implementation result — D1 Free capacity guard and incremental retention safety

- live Customer D1 reached the Free per-database capacity boundary and blocked Queue-attempt persistence before
  Connector code could run. A guarded one-time cleanup removed only `sync_work_units` belonging to expired or
  strictly older terminal/superseded generations; Business tables, Lark rows, Work/phase audit, active/current
  Work and the protected TikTok forensic Work were retained. Database size reduced from about `510.8 MB` to
  about `424.8 MB`, after which Queue processing resumed successfully;
- the Worker now performs the same bounded cleanup before recording a new main-Queue attempt. Eligibility
  requires a strictly newer generation fence, terminal/superseded lifecycle, no active cursor lock and no pending
  warning. A private protected-key list excludes the exact forensic Work, and cleanup deletes staging units only;
- Customer TikTok retains its existing `2,046` incremental source-state rows. The private Production runtime is
  prepared to enable daily incremental comparison with a seven-day full-reconciliation safety interval; no
  Business history is deleted or rewritten by this setting;
- focused cleanup/Queue tests PASS `18/18`; `npm run check` PASS; full `npm test` PASS including `18`
  Workers-runtime tests; Report reliability PASS `106/106`; npm audit reports zero vulnerabilities; deploy
  dry-run and `git diff --check` PASS. Reviewed PR/merge and Customer deploy remain required.

### Implementation result — Chatwoot Daily updated-only discovery

- new Daily generations use Chatwoot's server-side `updated_within` filter once for the immutable three-day
  overlap, persist the exact returned conversation identities, then hydrate only those conversations through the
  existing bounded durable continuations;
- Initial reconciliation retains complete stable-identity two-pass discovery, and an existing persisted Work
  retains its stored strategy/checkpoint. The change therefore does not restart or silently reinterpret a legacy
  generation;
- requested-at filtering, stable-key writes, D1-first persistence, idempotent replay and bounded conversation /
  reporting execution remain unchanged. This removes the unnecessary twice-daily account-history scan that made
  the Customer Workers Free path excessively slow;
- focused runtime/durable/API regression PASS `29/29`; `npm run check` PASS (`813` source files, `2,452` local
  dependencies, zero cycles and repository hygiene PASS); full `npm test` PASS `3,259` Node tests plus `18`
  Workers-runtime tests; Report reliability PASS `106/106`; audit reports zero vulnerabilities; deploy dry-run
  and `git diff --check` PASS. Reviewed PR/merge, Customer deploy and first scheduled Daily D1/Lark proof remain
  required.

### Implementation result — Chatwoot persisted-revision filter and bounded parallel hydration

- Daily discovery now compares each candidate's provider `updated_at` revision with the existing D1
  Conversation state before detail/message/event hydration. Equal or older revisions are skipped; missing or
  strictly newer identities continue through the unchanged stable-key upsert path;
- an already persisted Daily generation that completed discovery before this repair performs one bounded
  `updated_within` refresh, removes only unchanged pending identities and retains candidates absent from the
  refresh fail-safe. It resumes the same generation/checkpoint and does not delete historical D1 or Lark rows;
- each execution envelope hydrates Conversations serially after live Customer proof showed Chatwoot's message
  and reporting-event endpoints fail intermittently under parallel reads. Provider retry remains bounded at two
  attempts; result order, total reporting-event bounds, deterministic normalization and D1-first persistence
  remain unchanged;
- focused Chatwoot regression PASS `28/28`; `npm run check` PASS; full `npm test` PASS `3,278` Node tests plus
  `18` Workers-runtime tests; Report reliability PASS `106/106`; npm audit reports zero vulnerabilities; deploy
  dry-run and `git diff --check` PASS. Reviewed merge/deploy and exact same-generation Production continuation
  remain required for final D1/Lark completion proof.

### Implementation result — Meta K2 bounded post-source materialization

- live Customer evidence proves the exact `20260827` K2 Work has completed all `194/194` provider source units
  and retained about `13.96 MB` of staged payload, but Workers Free terminated before the existing preflight
  phase because one invocation reloaded and assembled the entire snapshot;
- added durable phase `meta_ads_post_source_materialization_v2`. It reads at most five staged source units per
  delivery, persists only the fields needed by the canonical Ads builders and retains the exact Daily source
  payload hash plus the exact normalized entity metadata hash. After all 194 units are compact, the same
  Work/generation continues through the existing bounded preflight, D1 and Lark phases without hashing all
  19,200 Creative rows again on every continuation;
- the repair never calls Meta again, never creates a replacement generation and does not change stable keys,
  source fingerprints or completed K3/YouTube Work. Queue routing now explicitly admits the durable
  `materialization_continuation` result;
- focused Meta runtime/audit/materializer tests PASS `26/26`; `npm run check` PASS; full `npm test` PASS `3,267`
  Node tests plus `18` Workers-runtime tests; Report reliability PASS `106/106`; npm audit reports zero
  vulnerabilities; deploy dry-run and `git diff --check` PASS;
- reviewed PR/merge, Customer deploy and exact same-generation K2 recovery from the retained `194/194` source
  checkpoint remain required before D1/Lark completion proof. Blind replay is prohibited.

Live v1 recovery compacted `194/194` retained source units and created the destination preflight at
`200/19,203`, proving source read/assembly no longer hits the previous CPU boundary. It then terminalled because
each preflight continuation still recalculated metadata fingerprints for all 19,200 Creative rows. The v2 phase
therefore moves those hashes into the same bounded five-unit materialization and changes no Business identity or
destination value. Focused regression PASS `26/26`; full gates/review/deploy and exact same-generation recovery
from the retained source checkpoint remain required. V2 full gates PASS: `npm run check`, `3,267` Node tests,
`18` Workers-runtime tests, Report reliability `106/106`, zero high-severity audit findings, deploy dry-run and
diff-check.

## Current authorized recovery — Customer Workers Free runtime

### 2026-08-26 — bounded YouTube/Meta post-source continuation

- Live Customer D1 proves YouTube source inventory/resources/Owner Analytics complete at 838/838, while the
  retained Work has no destination phase; Meta K2 source is complete at 194/194 but has no preflight phase, and
  Meta K3 is retained at D1 row 590/3,848. These are post-source execution limits, not missing credentials;
- YouTube now records a compact D1-storage completion marker, then plans/writes Content, Daily and Account rows in
  durable bounded batches. Account freshness remains last so Lark cannot claim connected/current before the
  content destinations finish;
- the D1-first wrapper captures the complete canonical snapshot before any bounded Lark batch and resumes the
  stored D1 result on later deliveries, preventing repeated full D1 writes and partial snapshot capture;
- Meta complete-payload preflight and Lark delivery now checkpoint row offsets as well as table offsets. Stable-key
  duplicate validation remains full-scope, while each provider-free continuation handles at most the configured
  row budget. Existing complete preflight phases remain compatible;
- Customer runtime will use 100 rows per Meta preflight/D1/Lark and 100 rows per YouTube destination delivery;
  these execution limits are outside the persisted source-operation fingerprint, so exact K2/K3/YouTube Works can
  resume without a replacement generation;
- focused regression PASS 29/29; `npm run check` PASS (811 source files, 2,448 dependencies, zero cycles and hygiene
  PASS); `npm test` PASS 3,253 Node tests plus 18 Workers-runtime tests; Report reliability PASS 106/106;
  `npm audit --audit-level=high` PASS with zero vulnerabilities; deploy dry-run PASS. Reviewed PR/merge, Customer
  deploy, exact same-generation recovery and D1/Lark freshness proof remain required before Production completion.

Live recovery on Customer version `12f3333c-ee9f-4182-87f0-55fb187cf774` then isolated one deeper YouTube bound:
the 838-row D1 organic-history writer exceeded Workers Free CPU before it could create the new storage phase.
The writer now checkpoints 100 content rows per delivery, accumulates compact coverage counts, and runs analytics,
account and Coverage completion only after every content batch is durable. A retry of the same batch remains
idempotent. Focused regression PASS 20/20; full `npm test` PASS 3,254 Node tests plus 18 Workers-runtime tests;
check, Report 106/106, audit and deploy dry-run all PASS. Review/merge/deploy and exact Work continuation remain.

PR #752 merged as `main@18d50501` and Customer version `8e0acb58-e753-4c65-9802-03ffaf17028a` created the first
durable storage checkpoints at 100/838 and 200/838. Live Tail proved that 100-row executions can persist progress
but still end as `exceededCpu`; the exact Work then terminalled with lock zero before the smaller runtime was
active. The same generation was recovered once on version `dcb763e7-8a17-4d53-91bd-9f844fa6af20` with a five-row
execution batch and advanced 200→210/838 with successful continuation outcomes. The storage and Lark limits are
now separated so Production can retain D1=5 while restoring Lark destination batches to 100 without changing the
persisted Work identity. Focused YouTube tests pass 20/20 and `npm run check` passes; reviewed merge/deploy remains
required before the Work reaches Lark phases.

Subsequent Live Tail proved a remaining CPU spike happened before the five-row write: every continuation still
hydrated and normalized all 838 staged Video resources. The resumed D1 path now retains the exact returned Video
ID index in the existing storage phase, loads only the one-to-five source units needed for the next stable sorted
range, reuses the already persisted Coverage watermark and normalizes only that range. It defers the one-time
finalization to the completed content boundary and never rewinds `nextIndex` or creates a replacement generation.
Focused YouTube regression passes 16/16 and repository check passes.

PR #753 merged as `main@3ca00c1f` and Customer version `3e165388-2548-4aae-a62f-1dcfe81159ee` activated the indexed
D1 resume path with D1=5 and Lark=100. The newer scheduled Work `youtube:youtube-scheduled-20260827` supersedes the
retained 2026-08-26 generation and durably advanced Owner Analytics from 600 to 700/838. Live evidence then isolated
another pre-write Free CPU cost: each incomplete Analytics continuation still hydrated and normalized all 838
Video resources before requesting only the next Analytics chunk. The current repair detects the retained incomplete
Analytics phase immediately after inventory, resumes that phase without resource hydration, and adds one explicit
continuation boundary after the final Analytics checkpoint so the full canonical assembly happens only once. The
provider retry test proves 837 unique videos, no repeated inventory/resource calls and no repeated Analytics calls;
focused YouTube regression passes 16/16. Full gates, review, merge, Customer deploy and exact same-generation live
continuation from 700/838 remain required.

PR #754 merged as `main@37601551` and Customer version `b999230b-cf6f-4364-985c-3dcc56b8b790` proved the direct
Analytics resume live: the exact 2026-08-27 generation advanced 700→750→838 without rebuilding Video resources or
creating a new DLQ. Indexed D1 storage then completed 838 content rows, 1,860 Analytics facts, Account Daily and
both Coverage scopes. Lark Content completed 838/838 under staged 100→50→25 execution limits.

The retained Lark Daily phase then exposed a distinct resize-safety defect rather than a CPU failure. Changing its
execution limit after 100 rows recalculated unit sequence from `ceil(stop / currentBatchSize)`, colliding with an
already durable `(work_key, phase, sequence)` and failing closed as `D1_SYNC_WORK_WRITE_FAILED`; no Business row or
checkpoint was rolled back. Destination units now use the existing durable `chunksProcessed` as their next sequence,
so execution limits can shrink or grow mid-phase without reusing a sequence. Focused YouTube regression passes 17/17,
including a live-shape batch-resize test. Full gates, reviewed merge/deploy and continuation of the exact same Work
from Lark Daily 100/838 remain required.

PR #755 merged as `main@4bfc13a8`; exact same-generation recovery proved the corrected destination sequence live by
advancing Lark Daily 100→150 without collision. Staged 50/25/10-row execution then isolated a remaining Free CPU
cost: after each successful small write, the following continuation still reconstructed and normalized all 838
staged Video resources before slicing the next Daily rows. This produced alternating successful checkpoints and
abrupt `running` rows/lock expiry even at ten rows, retaining Daily at 245/838 without a new DLQ.

The current repair adds an exact-range destination resume after D1 completion. For an already active Content or
Daily phase whose expected count matches the retained inventory, it loads only the source-unit chunks containing
the next configured IDs, normalizes only that range, writes/checkpoints it, and returns immediately. It does not
rehydrate Owner Analytics or the other 838 Video resources, does not change generation/fingerprint, and falls back
to full assembly when availability counts differ. Focused YouTube regression passes 17/17 and explicitly proves a
destination phase completes without another full canonical capture. Full gates, reviewed merge/deploy and exact
same-generation continuation from Daily 245/838 remain required.

Live recovery later isolated `YOUTUBE_END_TO_END_CAPTURE_INCOMPLETE` at Daily 275/838: the exact-range path bypassed
the normal durable destination wrapper and therefore did not restore the already-complete D1-first storage result
before `executePlan()`. The repair now calls the existing `resumeStorage()` contract before exact-range Content/Daily
delivery, so a one-row continuation cannot trigger a fresh full capture. Focused YouTube tests PASS 17/17; repository
check, full `npm test` (3,260 Node plus 18 Workers-runtime), Report reliability 106/106, audit, deploy dry-run and
diff-check PASS. Customer D1 capacity was also restored from 499,998,720 to 461,234,176 bytes by deleting only 494
staged `sync_work_units` from four superseded/older terminal generations; Business tables, current Works and the
protected TikTok forensic incident were unchanged. Reviewed merge/deploy and exact same-generation live proof from
Daily 275/838 remain required.

### 2026-08-26 — Chatwoot fingerprint-stable Free execution cap

- live same-generation recovery proved that changing the reviewed conversation/reporting limits
  correctly fails closed as `SYNC_WORK_OPERATION_MISMATCH`, while retaining the exact durable phase;
- the runtime now applies optional deploy-only execution caps after `beginWork`, so smaller Free-plan
  units do not alter the persisted operation fingerprint or permit an expansion beyond reviewed limits;
- Customer will retain the original fingerprint limits while using one conversation and one reporting
  page per execution; provider timeout/attempt limits remain separate non-fingerprint controls;
- focused Chatwoot runtime/wiring/recovery regression passes 31/31; full repository gates, review,
  merge, Customer deploy and exact same-generation live completion remain required.

The first post-cutover schedules proved that Dev data parity does not guarantee Customer runtime parity because
Dev is Paid while Customer remains Workers Free. The user authorized reviewed code, merge, Customer deployment
and exact one-connector-at-a-time recovery without another interactive approval. The recovery must preserve the
existing Customer D1/Lark stable keys and checkpoints and must never redrive or mutate
`terminal:eafd8e43f1ae5113d12905301496fd4e`.

Implementation on `codex/customer-free-runtime-repair-20260825`:

- Meta source remains one Provider page per Queue invocation, while the whole-operation page ceiling now accepts
  reviewed large accounts up to 2,500 pages; Customer uses 500 and reduces D1 writes from 100 to 10 rows;
- Chatwoot Daily discovery now uses the existing page-bounded stable two-pass path. The exact deployed zero-progress
  `updated_within_once` state upgrades in memory without discarding masters or any Business rows;
- YouTube scheduled work now has a stable daily operation/work key, persists one source page/chunk per delivery and
  sends only a reference-only continuation after its D1 phase checkpoint;
- Customer local runtime reduces Google Ads D1/Lark batches to 10/25, enables migrated TikTok incremental state,
  reduces future TikTok source units to 10 rows and keeps Queue batch/concurrency at one;
- focused regression — PASS 80/80 plus continuation/router coverage; `npm run check` — PASS, 810 source files /
  2,441 dependencies / zero cycles / hygiene PASS; `npm test` — PASS 3,242 Node tests + 18 Workers-runtime tests;
  Report reliability — PASS 106/106; npm audit — zero vulnerabilities; deploy dry-run — PASS;
- reviewed PR/merge, Customer deploy and exact Google Ads → Chatwoot → Meta Ads → YouTube → TikTok live completion,
  D1/Lark parity and incident closure remain required before restoring `COMPLETE 100%`.

## Current authorized reliability scope — bounded Customer Queue auto-recovery

The user authorized the Customer Production runtime to resume future transient Queue exhaustion without waiting
for a manual operator. This is not generic DLQ redrive. The controller is disabled by default and may run only on
the exact `production/chemistry_k/customer/chemistry_k` ownership tuple.

The implementation:

- admits only stable same-generation operations for TikTok Organic, Facebook, Instagram, Meta Ads, Google Ads,
  YouTube, WooCommerce and Chatwoot;
- hard-blocks `terminal:eafd8e43f1ae5113d12905301496fd4e` and never revives permanent, completed or superseded Work;
- atomically claims each exact DLQ incident in D1, preserves the original payload/work key/generation/checkpoint,
  waits for active locks plus a bounded cooldown, and limits each Work to five recovery incidents;
- treats a Queue-send/marker crash as an idempotent resend of the same stable payload, never a replacement Work;
- keeps DLQ/Alert evidence open while recovery is running and closes only the exact auto-recovery incident after
  the durable Work reaches `completed`;
- keeps `MKT_DLQ_REDRIVE_ENABLED=false`; example configuration also keeps auto-recovery disabled by default.

### Implementation result — bounded Customer Queue auto-recovery

- focused policy/store/routing/config regression: PASS 44/44;
- `npm run check`: PASS, 811 source files / 2,446 dependencies / zero cycles / hygiene PASS;
- `npm test`: PASS, 3,249 Node tests plus 18 Workers-runtime tests;
- `npm run test:report-reliability`: PASS 106/106; `npm audit --audit-level=high`: PASS, zero vulnerabilities;
- `npm run deploy:dry-run`: PASS for both release configs (Wrangler log-file warnings are sandbox-only and the
  command exited zero);
- PR #745 passed both complete CI gates and merged as `main@ae37b064`; Customer Worker version
  `7d945a92-4fbc-423c-b4fd-396a1e3955f0` became active at 100% traffic with the exact Queue/D1 bindings,
  auto-recovery enabled and generic DLQ redrive still false;
- non-synthetic retry exhaustion then produced exact `auto-recovery:*` D1 claims in
  `in_progress/redrive_pending` state for Chatwoot, Meta K2, Meta K3 and TikTok. The same checkpoints resumed:
  Meta K3 advanced from 2,320 to 2,380 rows, TikTok advanced from 340 to 370 rows and YouTube Owner Analytics
  advanced from 700 to 837 rows without a replacement Work or manual second recovery;
- Customer-only Meta D1 batch was reduced from 10 to 5 after Live Free-CPU evidence, without changing the durable
  fingerprint. Worker version `56b969fa-3860-4aaa-8a00-ec9899a7a815` is active with the same schedules and Queue
  topology;
- the extended soak then exposed the external stop condition: Cloudflare rejected the next Meta continuation with
  `You have exceeded the daily write operations limit in Queues free tier (10253)`. Exact retained checkpoints are
  Chatwoot 4/5, Meta K3 2,425/3,874, TikTok 390/2,048 and YouTube Owner Analytics 837/837; Meta K2 is separately
  terminal on permanent `LARK_PREFLIGHT_FAILED`. Stop Queue mutation until the provider quota resets, then inspect
  K2 preflight details and resume only the exact retained Works. No new secret or customer login is required.

### Implementation result — Customer Meta K2 canonical ad-channel repair

- after the 2026-08-26 provider reset, automatic schedules resumed without a new secret or login. Customer D1
  proves current-day success for Facebook, Instagram, Google Ads, WooCommerce and TikTok; Meta K2/K3 and YouTube
  have active durable Work, while one Chatwoot Work is terminal on retry exhaustion and remains an exact recovery
  target;
- exact K2 failure diagnostics prove a single permanent issue class: Customer `MKT_Ads_Daily.ad_channel` rejected
  nine rows as `SELECT_OPTION_INVALID`. The complete preflight checked six tables, 19,222 rows and 116,090 fields;
- detailed Meta placement channels remain authoritative in D1, but the canonical Lark projection now emits only
  the reviewed `facebook_ads` / `instagram_ads` Select values and omits auxiliary placement channels from the
  Customer Base row instead of failing the complete payload;
- the existing exact K2 snapshot importer and provider-direct materializer now reuse the same shared projection,
  removing three divergent implementations without changing stable keys, D1 facts or source normalization;
- focused Meta/Lark regression: PASS 15/15; `npm run check` and `git diff --check`: PASS;
  `npm test`: PASS 3,249 Node tests plus 18 Workers-runtime tests; Report reliability: PASS 106/106;
  `npm audit --audit-level=high`: PASS, zero vulnerabilities; `npm run deploy:dry-run`: PASS;
- reviewed PR/merge, Customer deploy, same-generation K2 completion and D1/Lark readback remain live gates. The
  protected TikTok forensic terminal was not read, redriven or changed, and generic DLQ redrive remains disabled.

Live release follow-up:

- PR #748 passed all three CI gates, merged as `main@657b35f6` and deployed to Customer Worker version
  `ac8aa2dc-3a4b-4430-a0f8-2b5293d91039` with the existing two crons and Queue/DLQ topology;
- the new K2 generation stopped earlier in source staging at Creative page 188/500, before Lark preflight, on
  HTTP 400 / Graph code `80004` / subcode `2446079`. Existing reviewed recovery code already classifies this exact
  pair as a resumable Meta Ads Business Use Case rate limit, but the shared Graph client only treated HTTP 429,
  5xx or `is_transient=true` as retryable;
- the shared client now classifies only this exact code/subcode pair as transient, preserving bounded request and
  Queue retries plus the existing durable page checkpoint. Neighboring codes/subcodes remain permanent;
- focused classifier/checkpoint regression: PASS 16/16; `npm run check` and `git diff --check`: PASS;
  `npm test`: PASS 3,250 Node tests plus 18 Workers-runtime tests; Report reliability: PASS 106/106;
  `npm audit --audit-level=high`: PASS, zero vulnerabilities; `npm run deploy:dry-run`: PASS;
- K3 retained D1 progress 590/3,848, YouTube retained complete 838/838 inventory/resources/Owner Analytics, and
  Chatwoot retained 1/2 Daily units. No active lock remains; these checkpoints require exact bounded continuation.

## Current authorized adjacent scope — Customer Lark View hygiene

The user authorized hiding fields that have no data in Customer Base views. Scope is restricted to the exact
`Setup Phase | Social MKT Data Hub` folder in the customer Base. Customer-created tables outside that folder are
forbidden, including the retained Content Creator and Sale/Support tables visible in the supplied `.base` export.

The reviewed runtime must:

1. accept only exact `production/chemistry_k/customer/chemistry_k` execution with a disabled-by-default feature
   flag and a per-table SHA-256 scope allowlist;
2. target only tables whose reviewed identity contains `MKT_` or `RAW_TikTok_`, and validate exact table, primary
   field, candidate field and Grid-view identities before any mutation;
3. prove every candidate remains empty against the Live Customer Base with an `isNotEmpty` search before hiding it;
4. preserve all existing hidden fields, never hide the primary field, PATCH only `hidden_fields`, and read back
   exact equality after each changed View;
5. write zero records, zero fields, zero filters, zero view names and zero schema objects;
6. restore the runtime feature flag to false after the one-time reviewed operation.

### Implementation result — Customer Lark View hygiene

- supplied Customer Base snapshot revision 146 contains 33 in-scope Data Hub tables and 39,080 records; three
  customer-created tables were explicitly excluded;
- conservative snapshot candidates total 100 empty fields across 81 Grid views; Live runtime rechecks each
  candidate and skips any field that has since received data;
- added the manual-only `lark.base.view.hygiene` Queue job and exact Customer Production admission boundary;
- added per-table canonical SHA-256 scope binding so a Queue payload cannot substitute another table/view/field;
- added idempotent hidden-field union and Live readback without record/schema/filter/name writes;
- focused tests — PASS 5/5;
- `npm run check` — PASS, 804 source files / 2,415 local dependencies / zero cycles; hygiene PASS;
- `npm test` — PASS, 3,211 Node tests and Workers-runtime suite exit 0;
- `npm run test:report-reliability` — PASS 105/105;
- `npm audit --audit-level=high` — PASS, zero vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/customer-lark-view-hygiene-dry-run.log npm run deploy:dry-run` — PASS;
- PR #720 merged as `main@d4901092f4aa825451255ec7df1c72f5e7e6a35f` and was deployed as Customer Worker
  version `344d9bfb-b701-4d67-b314-e1bd2a297fb9`; the reviewed Queue accepted 19 exact table jobs;
- the first Live empty-field proof exposed a Record Search request-contract difference: `isNotEmpty` requires
  `value: []`, whereas View-filter PATCH omits `value`. Every job failed closed during read-before-write, so no
  View, record, schema, filter or name mutation occurred;
- the hotfix changes only Record Search serialization, retains the separate View-filter contract, and adds a
  focused regression proving the exact empty-array request body;
- PR #721 passed both complete CI gates and merged as `main@951113ca`; Customer Worker version
  `80e2e65c-e7f0-4d2e-aeb9-713f3fc00ffe` accepted all 19 reviewed table jobs, covering the 100 candidate fields
  and 81 Grid views. Every successful job performs exact post-PATCH readback, and the post-hotfix interval produced
  zero new hygiene DLQ and zero new hygiene alert;
- the 19 exact pre-hotfix DLQs and their 19 paired `queue_permanent_failure` alerts were closed as `resolved` only
  after the corrected Live run; exact readback is `resolved_dlq=19`, `resolved_alert=19`, `open_dlq=0`;
- the one-time feature flag was restored to false without enabling generic DLQ redrive. Customer Worker version
  `b19c5a97-b7a5-4965-9d17-85ace9219654` (version 57, authored by `dev.datahub.2026@gmail.com`) is the final safe
  deployment at 100% traffic with the original schedules preserved. The prohibited TikTok forensic DLQ was not
  redriven or changed.

## Canceled adjacent scope — Customer Lark View field order

The user canceled field ordering and returned priority to Production source/report closeout. Live Queue evidence
also showed the field-order release increased cold-start work enough for unrelated one-message Queue deliveries to
reach the Workers Free CPU ceiling. Production was restored to exact reviewed pre-field-order runtime `e0430022`
as Worker version `30223f20-a91d-42b4-8d49-65c6cc95c80f`; an error-only tail then showed no new `exceededCpu`.
This closeout branch removes the canceled field-order job, transport and tests from `main` before any further
Customer deployment. Completed empty-field hygiene remains intact and its flag remains false.

## Current fast closeout — Meta Ads K3 Select normalization

K3 source staging is complete at 20/20 units. Its Lark preflight failed before writes because 1,681 non-null Meta
`object_type` values used provider literals (`PHOTO`, `VIDEO`, `SHARE`, `STATUS`, `POST_DELETED`) while Customer
`MKT_Ads_Creatives.creative_type` allows only `image`, `video`, `carousel`, `other`. The release normalizes those
provider values to the canonical options and maps every unknown/missing value to `other`; focused coverage proves
all emitted values belong to the exact Customer Select contract. Exact same-generation K3 recovery and D1/Lark
readback remain required after reviewed merge/deploy.

### Implementation result — Workers Free restore and Meta K3 repair

- focused runtime/Meta/Lark regression: PASS 63/63;
- `npm run check`: PASS, 807 source files / 2,430 local dependencies / zero cycles / repository hygiene PASS;
- `npm test`: PASS, 3,217 Node tests plus 18 Workers-runtime tests;
- `npm run test:report-reliability`: PASS 105/105;
- `npm audit --audit-level=high`: PASS, zero vulnerabilities;
- `npm run deploy:dry-run`: PASS;
- reviewed merge, Customer deploy, exact same-generation K3 resume and D1/Lark readback remain required before
  this repair is complete.

## Current fast closeout — TikTok once-daily probe

Normal TikTok sync UAT remains complete and the protected forensic DLQ remains untouched. The first scheduled
runtime exposed a separate producer defect: enabling TikTok caused the primary five-minute Cron to enqueue a
full two-pass RAW watermark probe every five minutes. That generated Queue retry-exhaustion incidents despite no
new source day being due. The scheduler now emits exactly one probe at configurable Bangkok time, default 06:55,
and emits no probe during the other 287 primary-Cron ticks. Customer deploy must prove no new probe DLQ after the
change; the next 06:55 scheduled run remains the required positive proof.

### Implementation result — TikTok once-daily producer

- focused scheduler/Workers-runtime: PASS 35/35;
- `npm run check`: PASS, 807 source files / 2,430 local dependencies / zero cycles / hygiene PASS;
- `npm test`: PASS, 3,218 Node tests plus 18 Workers-runtime tests;
- `npm run test:report-reliability`: PASS 106/106;
- `npm audit --audit-level=high`: PASS, zero vulnerabilities;
- `npm run deploy:dry-run`: PASS;
- reviewed merge/deploy and zero-new-probe-DLQ soak remain required.

## Current authorized scope — YouTube credential cutover without reconnect

The customer Channel owner already completed the required YouTube consent. Integration Live evidence proves
that the exact encrypted Customer Connection credential passed Owner authorization and a completed Analytics
catch-up. The migrated Customer D1 therefore retains the correct grant; the cutover must not ask the customer
to sign in again and must not use the unrelated legacy `YOUTUBE_OAUTH_*` token.

This branch must:

1. admit the exact reviewed `production/chemistry_k/customer` credential runtime while preserving the existing
   `development/integration_workspace/developer` tuple and rejecting every mixed/foreign tuple;
2. support an explicit current key plus bounded previous read-key versions, with all key material remaining in
   Worker Secrets;
3. add a disabled-by-default, operator-authenticated Integration-only rewrap boundary for the exact active
   YouTube Refresh Token; plaintext may exist only in Worker memory and must never enter response, log, D1
   evidence, Git or a local artifact;
4. create a new Customer-owned AES-256-GCM key, rewrap the same grant, migrate only the resulting encrypted
   envelope/reference into Customer D1, and validate Customer Owner refresh before enabling its schedule;
5. keep Google Ads, WooCommerce, Report, AI, Notification and DLQ-redrive state unchanged.

Acceptance requires focused repository/Worker tests, the standard gates, reviewed merge, exact Customer secret
readback by name, read-only Owner identity/refresh proof, one controlled YouTube run with D1/Lark reconciliation,
and only then normal YouTube schedule activation. A new OAuth consent is explicitly out of scope unless Google
independently rejects the already proven grant after rewrap.

## Historical completed scope — Workers Free continuation repair

1. Make controlled Production TikTok UAT a stable Queue operation so all continuation deliveries preserve exact `operationId`, `workKey`, `generation`, `originalRequestedAt`, trigger, metric date, and admission scope.
2. Bound RAW source staging to a configured number of pages per invocation and persist the page checkpoint before returning continuation-required.
3. Persist the computed business plan once per work generation so later preflight/write continuations do not rescan and rehash the entire RAW source.
4. Bound business preflight and write to a configured number of staged units per invocation.
5. Enqueue a fresh Queue continuation only after the durable phase checkpoint succeeds; ACK the current delivery through the normal success path.
6. Keep transient failures on the existing Queue retry path and permanent failures on the existing terminal path.
7. Complete work, checkpoint incremental state, and publish final reconciliation only after every source/preflight/write unit passes.
8. Keep the protected `RAW_TikTok_Creator_Videos` table read-only and D1-before-Lark write order unchanged.

## Out of scope — multichannel runtime branch

- blind replay of `terminal:eafd8e43f1ae5113d12905301496fd4e` or mutation of retained forensic evidence;
- bypassing missing customer secrets for YouTube, Google Ads, WooCommerce, or connection encryption;
- report/AI/notification enablement or Production COMPLETE declaration before their own live proofs.

## Acceptance criteria — multichannel runtime branch

- retained customer-source UAT promotes Facebook, Instagram, Meta Ads, Google Ads and Chatwoot to
  `verified`; YouTube and WooCommerce remain `dev_ready` until their missing Customer Production secret
  paths can be exercised;
- each active connector router admits only the reviewed Integration Workspace or exact customer Production
  ownership tuple and rejects foreign profile/customer/ownership;
- normal Production admission continues to pass through `assertConnectorRunnable()` without a generic bypass;
- the controlled UAT lane remains restricted to a `dev_ready` connector missing only `liveAccountUat`;
- focused application/worker-runtime tests, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit`, and `npm run deploy:dry-run` pass;
- `Implementation result` is updated with files, commands, evidence, and remaining Production blockers before handoff.

## Verified Production foundation

Customer-owned Production has passed these external gates:

- Production D1 exists in the customer Cloudflare account;
- migrations `0001` through `0021` applied exactly once;
- `d1_migrations` reports 21 applied migrations and no pending migration;
- `PRAGMA quick_check` returns `ok`;
- main Queue and DLQ exist;
- Worker `social-mkt-sync-worker` remains dark-deployed from reviewed source head `b85649fb0f4e5da69624fbc35b8b39a9cb149880` until the current reviewed fixes are deployed for recovery;
- main Queue and DLQ each have exactly one Worker consumer;
- `workers_dev=false`, no Cron trigger, no route;
- required Lark App secret is configured in customer-owned Cloudflare secret storage;
- customer Base mappings resolve to `✨Marketing Content Calendar`;
- protected `RAW_TikTok_Creator_Videos` remains a read-only source.

Production resource IDs and credentials remain local/customer-owned and must not be committed.

Operator-access evidence supplied on 2026-08-23 confirms that `dev.datahub.2026@gmail.com`
can sign in to Lark and open the customer Base `✨Marketing Content Calendar`. Base sharing is
therefore not a remaining blocker. The live recovery preflight must still verify the Worker Lark
App/OAuth API scopes against that same Base; this is an API-binding check, not a request to share
the Base again. The screenshot URL/table token remains local evidence and must not be committed.

## Verified Queue → Worker → Customer Lark bootstrap smoke

The controlled non-connector `report.settings.seed` Production smoke passed before connector admission:

- before run: zero `chemistry_k` report-setting rows and zero dead letters;
- first Queue job created exactly 74 canonical `chemistry_k` report settings;
- first run dead-letter delta = 0;
- exact same Queue payload was submitted a second time;
- rerun created 0 records and changed 0 records;
- Production report-setting row count remained 74;
- rerun dead-letter delta = 0;
- protected TikTok source write count = 0;
- connector/schedule/notification/AI enable count = 0.

Therefore customer-owned Queue → Worker → Lark infrastructure and stable-key idempotency are externally proven independently of connector UAT.

## TikTok Production recovery UAT — PASS on 2026-08-23

Fresh stable operation `tiktok-prod-cutover-20260823-r1` ran in the exact customer Production account
against the customer Base. The retained 2026-08-22 failure was not redriven or altered.

- Workers Free-safe runtime used one source page and one business unit per invocation;
- the main Queue was reduced to `max_batch_size=1` after live error-tail evidence showed that batching a
  TikTok unit with reliability-mirror messages could exceed the CPU ceiling;
- source staging, plan scan, preflight and write each completed 82/82 pages for 2,046 source records;
- final lifecycle is `completed`; checkpoint date advanced from `2026-08-22` to `2026-08-23`;
- all 2,046 checkpoint source IDs and external content IDs are distinct;
- customer Lark totals are Content 5 created / 2,041 updated, Content Daily 2,046 created, Account 1 updated;
- final reconciliation is `recovered`, with zero warnings and zero exact-scope open alert, DLQ or lock;
- protected Native TikTok source remained read-only;
- one intentional same-identity replay increased only the delivery-attempt counter from 334 to 335;
  completion, cursor, checkpoint count and Lark work totals remained unchanged;
- UAT/connector flags were restored false in customer Production version `1dc1ae9c-7c98-4e23-974b-3e43050c9aa1`;
  all schedules, reports, AI and notifications remain disabled.

This retained evidence satisfies TikTok `liveAccountUat`. It does not promote any other connector.

## Controlled Production connector-UAT admission

PR #677 merged the reviewed fail-closed UAT lane at `b85649fb0f4e5da69624fbc35b8b39a9cb149880`.

Contract remains:

1. Normal Production execution still requires `largeAccount.productionReady=true`.
2. Controlled UAT requires all of:
   - `MKT_ENV=production` / `chemistry_k`;
   - connector feature flag enabled;
   - connector status `dev_ready` with only `liveAccountUat` pending;
   - `MKT_PRODUCTION_CONNECTOR_UAT_ENABLED=true`;
   - exact connector selector match;
   - canonical Queue trigger `production_connector_uat`.
3. Planned/foundation-ready connectors remain blocked.
4. Scheduled and legacy triggers cannot consume the exception.
5. Release examples keep UAT admission disabled by default.
6. No readiness promotion occurs before retained live evidence.
7. No Production Cron is enabled during UAT.

## TikTok Production UAT incident — 2026-08-22

TikTok Creator was the first adopter because catalog readiness is `dev_ready` and only `liveAccountUat` is pending.

The first customer-owned Production attempt proved admission and Queue routing, but failed before any business write:

- one `tiktok.creator.native.sync` Queue job used trigger `production_connector_uat`;
- reliability run started under `chemistry_k` / `tiktok` / `native_import`;
- failure occurred while searching existing records in logical target `MKT_Content_Daily`;
- error code was `LARK_CLIENT_PROGRAMMING_ERROR`;
- `records_pulled`, `records_created`, `records_updated`, `records_skipped`, and `records_written` all remained `0`;
- one terminal DLQ record and critical reliability evidence were retained;
- the protected Native TikTok source was not written;
- the UAT connector flag, UAT admission flag, selector, schedules, AI and notifications were restored to the dark state after the failure.

Retained DLQ authority:

- job type `tiktok.creator.native.sync`;
- trigger `production_connector_uat`;
- metric date `2026-08-22`;
- status remains open as immutable forensic evidence; the reviewed recovery uses a fresh stable UAT and
  does not redrive this payload.

Do not manually alter the retained DLQ row or resolve its incident alerts before verified recovery.

## Reviewed shared Lark transport repair

PR #678 merged at `62bf0aa388ffc27c91242fd29f623fdf2fca518f` after full Branch Verification.

The reviewed repair:

1. serializes request bodies before entering the network transport boundary;
2. classifies serialization failure as permanent `LARK_REQUEST_SERIALIZATION_ERROR` without starting Fetch;
3. normalizes any non-`RuntimeError` thrown by `fetch()` or `response.text()` inside the transport boundary to retryable `LARK_NETWORK_ERROR`;
4. preserves `LARK_REQUEST_TIMEOUT` for timeouts;
5. preserves existing Lark `RuntimeError` classifications;
6. keeps errors outside the transport boundary fail-closed as programming errors;
7. preserves App-token/path sanitization;
8. preserves existing ambiguous Create/retry-mode semantics.

The original Production incident is still treated as a repair hypothesis until a fresh stable UAT on the
reviewed repair makes the same logical read proceed successfully. The retained failed payload is not replayed.

## Controlled cutover after reviewed merge

1. Deploy the exact reviewed Worker to customer Cloudflare while every connector, schedule, AI, and
   notification execution flag remains false.
2. Apply the customer Base mapping and customer-owned connector state/credentials to the customer D1,
   Worker bindings, and Secret store. Do not copy secret values into Git, logs, or evidence.
3. Run read-only binding and checkpoint preflight. The user-provided Lark screenshot already proves
   operator access; this step verifies only Worker App/OAuth API access and exact Table IDs.
4. Run one fresh stable TikTok Production UAT with Free-plan continuation budgets. Do not redrive
   `terminal:eafd8e43f1ae5113d12905301496fd4e`.
5. Prove D1-before-Lark writes, final reconciliation, protected RAW zero-write, and an idempotent rerun.
6. Run controlled UAT for the remaining customer connectors using their existing customer-owned
   source identities and checkpoints; promote readiness only from exact live evidence.
7. Enable source schedules one connector at a time. For each first scheduled operation verify that it
   continues from the migrated checkpoint, covers the expected time window, creates no duplicate stable
   keys, leaves no missing interval, and reaches D1/Lark parity before enabling the next connector.
8. Enable Daily/Weekly materialization only after source schedule proofs pass.
9. On Monday 2026-08-24 verify the automatic AI/Notification path sends the correct period and customer
   profile to the exact customer Lark group exactly once. Require one completed AI run, one claimed/sent
   delivery, one matching Notification Log row, stable message hash, zero duplicate delivery, and zero
   new exact-scope alert/DLQ/active lock.
10. Restore any temporary UAT flags to false and retain the reviewed normal schedules only after all
    first-run readbacks pass.

## Safety rules

- Never push directly to `main`.
- Never commit Production resource IDs, tokens, secrets, customer credentials or local Wrangler config.
- Do not reuse or overwrite the user's default Cloudflare login; Production uses the isolated named Wrangler auth profile/worktree.
- Do not touch PR #661 Base migration state while provisioning Cloudflare Production.
- Do not mutate the protected Lark Native TikTok source table.
- TikTok Ads remains deferred under PR #220.
- Do not fake `largeAccount.productionReady` or `liveAccountUat` before external evidence exists.
- Do not create a generic Production bypass around `assertConnectorRunnable()`.
- Do not replay or redrive the retained TikTok failure; recover with a fresh exact stable operation.
- Do not resolve retained failure evidence before successful recovery verification.
- Do not enable Cron/schedules before controlled Production verification is complete.
- Do not enable AI/Notification before source schedules and report materialization are complete for the
  intended period and exact customer group mapping is read back.

## Implementation result

### 2026-08-25 — YouTube daily-only schedule and TikTok 06:55 diagnosis

- changed the dedicated YouTube source Cron from `50 0,6,12,18 * * *` to `50 0 * * *`, which is exactly
  `07:50` in `Asia/Bangkok`, while preserving the primary five-minute scheduler and all non-YouTube schedules;
- updated the scheduler contract, current rollout/config guards and focused tests so the retired six-hour Cron is
  ignored and cannot create overlapping YouTube jobs;
- read-only Customer D1 evidence proved the TikTok cursor remained at `2026-08-23` and the `2026-08-24` scheduled
  probe entered a new exact DLQ; a fresh non-redrive probe plus Live Worker tail reproduced retryable
  `LARK_NETWORK_ERROR` on the protected Native table pagination path before any admission/business write;
- the Customer config had `MKT_TIKTOK_SOURCE_PAGE_SIZE=25`, requiring more than 50 external Lark fetches during
  the two-pass 2,048-record watermark scan. Raising the shared value to `500` fixed probe pagination but Live
  recovery proved a 500-record business unit can exceed Workers Free CPU; `100` was also not stable across units;
- the final contract separates `MKT_TIKTOK_PROBE_PAGE_SIZE=500` from
  `MKT_TIKTOK_SOURCE_PAGE_SIZE=25`, preserving a bounded ten-request watermark read while staging and processing
  one 25-record durable business unit per Queue invocation;
- focused TikTok regression `35/35`, `npm run check`, full tests (`3,238` Node / `18` Workers-runtime), Report
  reliability `106/106`, zero-vulnerability audit and deploy dry-run pass;
- the retained protected TikTok forensic terminal was not read as a replay target, redriven, resolved or mutated.

Remaining live gate: merge and deploy the independent probe/business page-size contract, recover only the exact
new `2026-08-24` operation from its 2,048-row durable snapshot, then prove cursor/D1/Lark completion plus zero new
exact-scope alert/DLQ/lock. The protected forensic terminal remains excluded.

### 2026-08-24 — Customer Weekly Notification Settings controlled activation

- added a fail-closed `report.settings.seed` activation mode that is admitted only for the exact
  customer-owned `production/chemistry_k` runtime, the existing Notification runtime trigger and an immutable
  activation version;
- requires Weekly Report/Notification schedules, D1/preset plus Notification runtime/send/mirror gates and validates the reviewed
  destination name/SHA-256 authority before any Lark write;
- updates only the eight active-channel `chemistry_k:*:rolling:7d` stable Report Settings, setting
  `ai_enabled=true` and `notification_enabled=true`; no raw group ID is carried in Queue payload or Source and
  every other Customer/Integration setting remains untouched;
- Customer `MKT_Notification_Log` exact table identity was recovered from the user-provided Base export inside
  `Setup Phase | Social MKT Data Hub`; no object outside that folder was mutated;
- focused Settings/routing tests pass `33/33`; `npm run check`, `git diff --check`, full tests (`3,206` Node plus
  `18` Workers-runtime), Report reliability `105/105`, audit with zero vulnerabilities and deploy dry-run pass;
- no Customer Settings activation, Report/AI/Notification enablement or message send occurs before reviewed merge
  and the outstanding WooCommerce/Chatwoot source operations complete.

### 2026-08-23 — Stable YouTube Production-UAT recovery identity

- added a stable Queue-operation contract for `youtube.channel.organic.sync` only when the canonical
  `production_connector_uat` trigger is used with `dryRun=false`;
- the controlled Production-UAT route now consumes the reviewed `operation.workKey`, allowing a recovery
  delivery to resume the exact existing YouTube page/chunk checkpoint even when Cloudflare assigns a new
  message ID;
- scheduled and ordinary YouTube jobs retain their existing delivery-scoped work key; no generic Production
  bypass or scheduled readiness exception was added;
- malformed, unstable, drifted work keys/generations fail closed before Provider or business writes;
- focused Queue-operation, Production-UAT admission and Worker-routing tests pass `53/53`;
- `npm run check` passes with 800 source files, 2,393 local dependencies and zero cycles;
- full tests pass `3,188` unit plus `18` Workers-runtime tests; Report reliability passes `105/105`;
- `npm audit --audit-level=high` reports zero vulnerabilities and `npm run deploy:dry-run` passes;
- Customer Production schedule remains disabled while live UAT resumes the retained exact checkpoint.

Files changed:

- `packages/application/src/jobs/queue-operation.js`
- `apps/sync-worker/src/active-job-router.js`
- `tests/application/queue-operation.test.js`
- `tests/application/production-connector-uat-admission.test.js`
- `docs/current-task.md`
- `CHANGELOG.md`

YouTube no-reconnect credential cutover implementation on
`codex/youtube-customer-credential-rewrap-20260823`:

- reused the canonical reviewed runtime ownership predicate and admitted only exact
  `development/integration_workspace/developer/chemistry_k` or
  `production/chemistry_k/customer/chemistry_k`; historical aliases and mixed tuples fail closed;
- extended the Customer credential runtime with one current write key and at most four explicit previous read
  key versions, all loaded only from Worker Secrets;
- added repository-level rewrap that decrypts the exact active source envelope and atomically replaces it with
  a new encrypted envelope/reference without returning plaintext;
- added disabled-by-default `POST /operator/youtube/credential-rewrap`, exact confirmation/reference/version
  checks, a dedicated `MKT_YOUTUBE_CREDENTIAL_REWRAP_TOKEN` constant-work bearer boundary and an
  Integration-only environment guard; the existing general Connection operator token is not rotated;
- preserved YouTube public API-key reads and the rule that Analytics never falls back to legacy
  `YOUTUBE_OAUTH_*` credentials; no schedule, Report, AI, Notification, Lark or DLQ state changed;
- focused credential/runtime/HTTP tests — PASS 26/26;
- `npm run check` — PASS, 797 source files / 2,381 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,172 unit tests and 18 Workers-runtime tests after the final canonical ownership reuse;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/youtube-customer-credential-rewrap-dry-run.log npm run deploy:dry-run` — PASS;
- `git diff --check` — PASS;
- no secret was read, printed, persisted or committed and no Remote mutation occurred on this branch.

Remaining execution gate: reviewed merge, temporary Integration-only rewrap window, encrypted envelope migration,
Customer Owner refresh/identity proof, controlled D1/Lark run/reconciliation, route/previous-key removal and only
then YouTube schedule activation. Customer reconnect is not required.

Customer Production schedule activation on 2026-08-23:

- PR #702 merged the reviewed multichannel Production runtime at exact main
  `400a17795f3a2fee0175504c20f3758f377675f8`; the customer Worker was first deployed dark, then the exact
  merged source was deployed as version `d93072cb-a179-4158-944c-0eb08cf0e759` with deployment message
  `main@400a1779 activate instagram meta-ads chatwoot schedules`;
- Cloudflare readback shows `dev.datahub.2026@gmail.com` as author and the new version receiving 100% traffic;
- the primary Cron is exactly `*/5 * * * *`, `workers_dev=false`, and the main Queue remains Free-plan safe
  at batch size/timeout/concurrency `1/1/1` with the existing DLQ; no route or DLQ redrive was added;
- enabled only Instagram, Meta Ads and Chatwoot source/D1/Lark/schedule paths. TikTok, Facebook, Google Ads,
  YouTube, WooCommerce, Daily/Weekly reports, AI, notification, retention, webhook and redrive paths remain
  disabled. `CHATWOOT_INCLUDE_UPDATED_OLDER_CONVERSATIONS=true` is the retained reviewed Daily behavior;
- first automatic source windows remain time-gated to Monday 2026-08-24 at 07:35 Instagram, 07:40 Meta Ads
  and 07:45 Chatwoot in `Asia/Bangkok`; no scheduled success is claimed before those runs occur;
- pre-run D1 baseline records Instagram 50 current-content keys / 50 observation keys / 14 account-day keys,
  Meta Ads 9,503 daily-fact keys through 2026-08-21, and Chatwoot cursor `2026-08-22` with 665 conversation
  state rows. Distinct stable-key counts equal row counts in the measured tables and active locks are zero;
- the retained TikTok forensic baseline remains five open alerts and one open DLQ row; neither was changed,
  replayed or redriven;
- Codex heartbeat `customer-production-cutover-monitor` is active for 06:50 `Asia/Bangkok` to continue the
  reviewed TikTok enablement and first-run reconciliation sequence. It must stop after completion or when an
  unrecoverable secret blocker requires user action.

Remaining live gates:

- enable TikTok at/after 06:55 Monday, when the reviewed scheduler targets 2026-08-23 and cannot move the
  migrated cursor backward, then verify its exact scheduled operation;
- verify Instagram, Meta Ads and Chatwoot first automatic runs one connector at a time against the retained
  baseline, including D1/Lark parity, expected interval, stable keys, checkpoint, and exact new alert/DLQ/lock;
- keep Facebook disabled until `META_FACEBOOK_PAGE_ACCESS_TOKEN` is set; keep Google Ads, YouTube and
  WooCommerce disabled until their documented missing encryption/Provider secrets are available;
- keep Report/AI/Notification disabled until all intended source and materialization gates pass. Automatic
  Lark group exactly-once delivery remains pending and must not be inferred from deployment alone.

Multichannel Production runtime update on `codex/multichannel-production-runtime-20260823`:

- centralized the exact reviewed runtime ownership predicate so connector routers accept only
  developer-owned `development/integration_workspace/chemistry_k` or customer-owned
  `production/chemistry_k/chemistry_k`;
- routed Meta, Google Ads, WooCommerce and Chatwoot through the central connector readiness gate before
  Provider/Infrastructure execution; disabled connectors still fail before any business activity;
- promoted Facebook, Instagram, Meta Ads, Google Ads and Chatwoot to `verified` from retained customer-source
  Live UAT, bounded/durable execution and D1/Lark reconciliation evidence already recorded in Project Brain;
- retained YouTube and WooCommerce as `dev_ready` because Customer Production cannot yet exercise their
  unreadable/missing encryption and Provider secrets;
- focused runtime/catalog/admission suites pass, including exact customer Production allow and foreign
  ownership/profile/customer rejection;
- `npm run check` — PASS, 796 source files / 2,372 local dependencies / 0 cycles; hygiene PASS;
- first full `npm test` correctly exposed two stale disabled-connector error-code expectations; both were
  updated to the stricter central `MKT_CONNECTOR_DISABLED` boundary and focused regression passes 31/31;
- final `npm test` — PASS, 3,166 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/multichannel-production-runtime-dry-run-r3.log npm run deploy:dry-run` — PASS;
- no Production deploy, Queue send, schedule enable, Lark/D1 business write, Secret change or DLQ mutation
  occurred before reviewed merge.

Readiness promotion update on `codex/tiktok-production-readiness-20260823`:

- changed only the TikTok large-account contract from `dev_ready` to `verified` and set
  `liveAccountUat=true` based on the exact live evidence above;
- updated catalog/admission tests so verified TikTok is admitted by normal Production execution while
  the controlled UAT exception remains tested against YouTube, which is still `dev_ready`;
- focused tests: `node --test tests/config/connector-catalog.test.js tests/application/production-connector-uat-admission.test.js`
  — PASS, 18/18;
- `npm run check` — PASS, 796 source files / 2,363 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,160 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/tiktok-production-readiness-dry-run.log npm run deploy:dry-run` — PASS;
- the normal TikTok schedule stays disabled until the reviewed promotion is merged and deployed.

Production schedule runtime update on `codex/tiktok-production-schedule-runtime-20260823`:

- pre-enable inspection found that the primary Cron correctly builds `tiktok.creator.native.probe`, but
  the post-Lark router still rejected every Production profile through a historical Integration-only guard;
- replaced that guard with an exact allowlist for either developer-owned `integration_workspace` or
  customer-owned Production `chemistry_k`; all foreign profile/customer/ownership tuples fail closed;
- focused source-watermark, schedule and runtime-admission tests pass 33/33;
- `npm run check` — PASS, 796 source files / 2,363 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,163 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/tiktok-production-schedule-runtime-dry-run.log npm run deploy:dry-run` — PASS;
- no customer Cron or TikTok schedule flag is enabled before reviewed merge.

Implemented on `codex/tiktok-free-plan-continuations-20260823` without Production mutation:

- controlled Production TikTok UAT and post-Lark runs preserve one stable Queue operation identity across
  all continuation deliveries;
- source staging, business-plan scan/finalization, preflight, write, and finalization are split into durable
  bounded Queue invocations;
- the immutable business plan is persisted once and its Classification Dictionary hash is checked on resume;
- continuation is enqueued only after its durable invocation phase is saved;
- duplicate/ambiguous Queue delivery replays the pending continuation, stale delivery skips, and an ahead
  sequence fails closed;
- Queue send failure remains retryable without losing the durable checkpoint;
- legacy non-stable paths preserve their existing unbounded compatibility behavior;
- example runtime config adds `MKT_TIKTOK_SOURCE_PAGES_PER_INVOCATION=1` and
  `MKT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION=1`;
- Production remains dark; no deploy, Queue send, Lark/D1 business write, flag enable, schedule enable,
  DLQ redrive, or retained-evidence mutation occurred on this branch.

Files changed:

- TikTok source/planner/business continuation use cases under `packages/application/src/use-cases/`;
- stable Queue identity in `packages/application/src/jobs/queue-operation.js`;
- Worker routing and continuation enqueue support under `apps/sync-worker/src/`;
- bounded runtime examples in `.dev.vars.example` and `wrangler.sync.example.jsonc`;
- focused application and routing tests.

Verification on 2026-08-23:

- `npm run check` — PASS, 792 source files / 2,358 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,132 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105 tests;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `npm run deploy:dry-run` — PASS for both example Workers;
- `git diff --check` — PASS.

Remaining external work is the reviewed merge and the controlled customer cutover/first-schedule/AI-group
proof sequence above. These are execution gates, not missing customer ownership or Base-sharing blockers.

### 2026-08-23 — YouTube Customer Production UAT PASS and readiness promotion

- confirmed the customer-owned Worker/D1/Lark/credential path under `dev.datahub.2026@gmail.com` without a
  new YouTube OAuth login and without upgrading the Customer Workers Free account;
- Cloudflare rejected a 300,000 ms configured CPU ceiling on the Free plan with error `100328`, so the
  retained full-inventory UAT was superseded after preserving its complete 17/17 source phases;
- found and repaired the actual D1 cutover gap: customer business/history data existed, while the exact
  Chemistry K YouTube operational cursor and all 837 `source_record_states` were missing;
- migrated those 837 operational states with exact-count/pre/post guards, then ran a new stable incremental
  Production UAT for 100 recent videos with Owner Analytics enabled;
- live result: sync run `success`, work `completed`, checkpoint saved, 837/837 Analytics videos queried,
  17/17 Analytics chunks complete, 1,541 Analytics rows, 64 Content updates, 100 Content Daily creates,
  one Account update, zero warnings and zero reconciliation gaps;
- post-validation: active lock 0, new-operation DLQ 0, new-operation open alerts 0; the superseded incident's
  exact DLQ/alert was resolved and its partial coverage was closed with an explicit superseded reason;
- promote only YouTube large-account readiness from `dev_ready` to `verified`; normal schedule activation
  remains pending reviewed merge and a production-config deployment with the controlled-UAT gate disabled.
- focused readiness/admission/Queue tests — PASS, 41/41;
- `npm run check` — PASS, 800 source files / 2,393 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,188 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/youtube-production-readiness-dry-run.log npm run deploy:dry-run` — PASS.

### 2026-08-24 — Customer YouTube schedule activation and Report preflight

- PR #712 merged the verified YouTube readiness promotion at exact `main@13b70e9d04cb5a5369e1efd367c4acb1c60a76f0`;
- deployed that exact main to the customer Worker as version `40cfffd2-11ad-4254-8571-1b540c266014`, authored by
  the customer operator account and serving 100% traffic;
- enabled only the reviewed YouTube schedule and dedicated cron `50 0,6,12,18 * * *`, disabled the controlled
  Production-UAT override, and restored main Queue retries from the temporary UAT ceiling to the normal value 5;
- preserved the primary cron, existing source schedules, Free-plan batch size/concurrency, current D1/Lark bindings,
  and all disabled TikTok/Google Ads/WooCommerce/Report/AI/Notification gates;
- customer D1 readback proves `report_materializations` contains all eight reviewed Report platforms at
  `1D/3D/7D/30D`, with latest period end `2026-08-22` and zero missing payload/checksum rows;
- Safari readback confirms the logged-in customer Base URL/title. The local Integration Lark App identity differs
  from the customer App identity, so the local secret was correctly rejected and no cross-App Lark read or write
  was attempted; the customer Worker remains the only permitted App-secret execution boundary;
- no Lark Base record, schema, permission, workflow or resource outside `Setup Phase | Social MKT Data Hub` was
  changed; Report/AI/Notification remains disabled until Monday source schedule proof and exact customer
  Report Settings/workflow/destination readback pass;
- the existing `customer-production-cutover-monitor` heartbeat was updated to retain this verified baseline, avoid
  repeating YouTube migration/UAT, and continue the 06:55–08:30 source → Report → AI → exactly-once group proof.

### 2026-08-24 — Customer Report/AI/Notification runtime profile correction

- pre-activation review found the automatic Weekly AI source collector and snapshotless Notification authority
  still fixed to the historical `integration_workspace` profile and the Integration executive group identity;
- made the collector, automatic AI seed, direct delivery loader and source-authority reconstruction consume the
  exact runtime `MKT_CUSTOMER_PROFILE`, while preserving the Integration Workspace default;
- Customer Production now requires a configured SHA-256 destination identity and exact visible chat name before
  Notification runtime can enable; missing or malformed authority fails closed;
- the customer-local deployment config retains only the SHA-256 of the reviewed chat ID and the exact group name;
  the raw chat ID is not committed or returned by an admin response;
- focused Lark Notification/Weekly regression — PASS, 170/170;
- `npm run check` — PASS, 800 source files / 2,393 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,191 Node tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, zero vulnerabilities;
- `npm run deploy:dry-run` and `git diff --check` — PASS;
- no Production Report, AI or Notification gate was enabled and no Lark message was sent by this code change.

### 2026-08-24 — Google Ads Workers Free Lark continuation repair

- Customer Google Ads signed delivery completed 7/7 chunks and admitted 1,297/1,297 rows without changing the
  Customer Workers Free plan;
- customer D1 completed the 2,600/2,600 business-write phase, while the former one-table Lark phase repeatedly
  exceeded the Free CPU budget on the final 192-row `MKT_ADS_DAILY` table after completing the first six tables;
- split each Lark table into durable row-bounded continuations (default 50 rows, maximum 500) and retained exact
  cumulative reconciliation across create/update/skip results;
- preserved backward compatibility with the already-deployed phase state so the customer run resumes from table 7
  instead of replaying the six completed tables;
- focused Google Ads delivery tests — PASS, 5/5, including 50/50/20 row continuation and deployed-state resume;
- `npm run check` — PASS, 800 source files / 2,393 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,196 Node tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit` — PASS, zero vulnerabilities;
- `npm run deploy:dry-run` and `git diff --check` — PASS;
- Customer deploy and live D1/Lark completion proof remain the release step for this repair; the API Worker and its
  signed-ingress secret are intentionally outside this deploy scope.

Live completion and WooCommerce Production-UAT admission follow-up:

- PR #716 merged and Customer Sync Worker deployed the 50-row Lark continuation without redeploying the API Worker;
- exact DLQ redrive resumed the retained Google Ads operation after 6/7 completed Lark tables; final admission and
  durable Work are `completed`, with 1,297/1,297 source rows, D1 2,600/2,600, Lark Daily 16 creates + 176 updates,
  and reconciliation `failed=0`;
- the temporary DLQ redrive gate was restored to `false` after completion;
- the first Customer WooCommerce scheduled admission proved credentials were not the blocker and failed closed on
  the expected `MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING` gate;
- wired WooCommerce to the existing exact-selector `production_connector_uat` lane while leaving ordinary scheduled
  execution subject to normal Production readiness;
- focused Production-UAT, WooCommerce routing and schedule tests — PASS, 47/47;
- `npm run check` — PASS, 803 source files / 2,411 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,203 Node tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105; `npm audit` — PASS, zero vulnerabilities;
- `npm run deploy:dry-run` and `git diff --check` — PASS;
- next live gate is one controlled Customer WooCommerce Production UAT, followed by reviewed readiness promotion and
  restoration of the UAT selector to disabled.

### 2026-08-24 — Customer Meta K2 exact Lark completion

- PR #730 merged the exact, temporary Customer-only Queue importer for the reviewed Chemistry K2 snapshot; PR #731
  corrected Daily validation to require the exact `Asia/Bangkok` midnight epoch represented by each stable-key date;
- Customer `MKT_Ads_Creatives` received 99/99 creates and `MKT_Ads_Daily` received 1,809/1,809 creates for account
  `505898710119851`, period `2026-07-24..2026-08-23`, with all 39 reviewed batch fingerprints preserved;
- the complete 37-batch Daily replay produced 0 creates, 0 updates and 1,809 skips; D1 readback proves every operation
  has exactly two main-Queue attempts, with zero matching v2 DLQ rows, zero matching Alerts and zero active locks;
- the temporary import mode was removed after proof. Customer Worker version
  `4962ff7e-4799-493d-b93a-fe226f2b9064` serves 100% traffic at `main@2e3455e3` with normal schedules preserved;
- no Customer Base resource outside `Setup Phase | Social MKT Data Hub` was read or changed.

### 2026-08-24 — Customer Chatwoot/WooCommerce D1-to-Lark closeout implementation

- read-only Dev/Customer comparison proved Dev WooCommerce was one completed reporting day newer while Customer
  retained substantially more history; an exact 37-row stable-key delta was therefore applied without replacing
  Customer-only history;
- Customer D1 now retains the larger history and reaches `2026-08-23` for both Commerce Daily datasets, with
  Orders `8,377`, Products `273`, Customers `6,017`, Daily `622`, and Product Daily `3,622`;
- added a disabled-by-default Customer-Production-only Queue importer for the exact five Chatwoot and five
  WooCommerce canonical Lark tables, using 50-row D1 reads, fixed manifests and stable per-batch identities;
- focused importer/catalog/Queue tests pass 31/31; `npm run check` passes at 809 source files / 2,436 local
  dependencies / zero cycles with repository hygiene PASS; full tests pass 3,235 Node tests plus 18
  Workers-runtime tests; Report reliability passes 106/106; audit reports zero vulnerabilities; deploy dry-run
  and `git diff --check` pass;
- reviewed merge/deploy, complete Lark run, idempotent replay and Report/AI/Notification activation remain
  required before Production COMPLETE.

### 2026-08-24 — Customer Lark workflow identity portability repair

- the first exact Customer Weekly run failed closed before any message send because the cloned Customer Base has
  different workflow IDs from the Integration Base even though both reviewed Automation titles and states are exact;
- made the two expected workflow identity hashes explicit Customer runtime inputs with the reviewed Integration
  hashes retained as defaults, and added only SHA-256/status diagnostics to the exact validation error so raw
  workflow IDs remain undisclosed even when the terminal failure is persisted;
- syntax validation and the full Node test suite pass; live Customer hash binding, retry under a fresh stable
  operation identity, exactly-once delivery proof and original configuration-incident closure remain required.

Live follow-up found and repaired the direct-delivery wiring boundary: the Worker repository intentionally does
not expose its private Lark client, so destination resolution now receives the explicit Infrastructure Bitable
client. The first real child delivery stopped before claim/send, preserving zero messages and allowing one fresh
child identity after reviewed merge/deploy.

### 2026-08-24 — Customer Production COMPLETE 100%

- Chatwoot Customer Lark projection completed `3,707/3,707`; exact replay covered 75 operations with zero creates,
  updates, duplicates, Alerts or DLQ;
- Customer WooCommerce retained its larger history while receiving the exact 37-row Dev delta through
  `2026-08-23`; all five canonical Lark tables completed `18,911/18,911`, and the full 381-operation replay was
  `created=0`, `updated=0`, `skipped=18,911`, `duplicate=0`;
- Report runtime materialized all eight active platforms at `1D/3D/7D/30D`: 32/32 D1 materializations for period
  end `2026-08-23`, with zero invalid payload/checksum, and Daily 08:10 / Weekly Monday 08:15 schedules active;
- Customer workflow identities are now bound by Customer-specific SHA-256 values: AI Materialization is enabled,
  Base Notification Automation is disabled, and raw workflow/chat IDs remain outside source, logs and docs;
- the Customer Weekly AI run completed, then one fresh child delivery sent exactly one Lark group message and
  mirrored both `MKT_Notification_Log` and `MKT_AI_Report_Runs`; D1 proves `status=sent`, `claim_count=1`, non-empty
  message hash, `mirror_status=mirrored`, one delivery row and zero active locks;
- replaying the exact delivery identity was rejected as `LARK_NOTIFICATION_ALREADY_MARKED_SENT`; claim count and
  message hash remained unchanged, proving zero duplicate send;
- closed only the seven exact configuration/probe/replay DLQs and six paired Alerts after successful delivery;
  exact readback is `open_dlq=0`, `open_alerts=0`; the protected TikTok forensic DLQ was not read, redriven or changed;
- final Customer Worker version `8f151a18-f07a-4cab-ad08-4cd4ba84433e` runs reviewed `main@3fd9b482` with the
  primary and YouTube crons, Workers Free Queue batch/concurrency 1, normal retries 5, source schedules,
  Report/AI/Notification runtime and Weekly Monday 08:30 notification schedule active.

### 2026-08-24 — Customer Organic Dashboard copied-Base compatibility replay

- exact Dev/Customer `.base` comparison proved the Customer Base already contained all 272 canonical Organic
  metric rows, but its copied Dashboard blocks still read the preserved Display V2 and legacy Period fields;
  both compatibility fields were blank on all 272 canonical Customer rows even though D1 values were correct;
- PR #738 enabled the reviewed Display V2 projection for `chemistry_k`; PR #739 extended the same reviewed
  compatibility boundary to canonical Number `window_days` and the preserved legacy Period selector;
- focused tests passed 9/9, `npm run check` passed, both PR CI gates passed, and final Customer Worker version
  `46acfee0-49f2-4169-9dad-837f4798df08` serves reviewed `main@3aca1104` at 100% traffic;
- the final controlled replay completed 16/16 D1-backed Organic Dashboard writes: Facebook, Instagram, TikTok
  and YouTube each completed 1D/3D/7D/30D. Fifteen completed on the first attempt and one succeeded on retry;
- the user visually confirmed Facebook values after the repair. TikTok subsequently reached 4/4 Period jobs;
  no Dashboard block, customer-created area, source fact or canonical business value was manually changed;
- post-run readback remained `open_dlq=137`, `open_alerts=146`, `locks=2`, exactly matching the pre-run baseline;
  zero DLQ and zero Alerts were created during the final replay, and the protected TikTok forensic DLQ was not
  read, redriven or changed.
- direct Dev/Customer D1 comparison confirmed that higher Customer values are newer rather than duplicated:
  Facebook Customer watermark is `2026-08-23T12:16:25+0000` versus Dev `2026-08-22T12:20:57+0000`, and Customer
  YouTube uses a newer snapshot; TikTok source watermark/values and all Instagram window values match exactly.
  Older Dev materializations must not overwrite these authoritative Customer results.
- a fresh Customer Base export after the replay proved a separate Dashboard filter defect: the table retains
  336 Integration Organic rows at the older period and 336 Customer Organic rows at the current period; 272 rows
  in each profile now satisfy the copied legacy Display/Period selectors. Stable keys are unique, but Dashboard
  aggregation can be nearly doubled until the exact `customer_profile=chemistry_k` filter is applied. No further
  replay or row deletion is authorized as a substitute for that profile isolation proof.
- after applying the profile filter, Instagram became blank because its current Customer materializations were
  `no_data_confirmed`. Read-only D1 proof found 50 content states/observations through `2026-08-22` and account
  daily facts through `2026-08-23`; the bounded `instagram-scheduled-20260823` content run had zero new posts but
  was incorrectly persisted as `full_inventory`, causing the reader to exclude prior observations;
- bounded Meta Organic source writes now use `report_range`; unbounded snapshots retain `full_inventory`.
  Focused Meta tests pass 21/21 and `npm run check` passes. Reviewed merge/deploy, exact existing-coverage
  correction and Instagram 1D/3D/7D/30D rematerialization remain live gates.

### 2026-08-25 — Instagram profile-isolated Dashboard live repair

- PR #740 merged as `main@cda7f09f`; Customer Worker version
  `cf59d7bf-260a-4527-9c15-7244808a8f48` retains the existing two schedules and Queue bindings;
- corrected exactly one affected Coverage row, `instagram-scheduled-20260823:instagram:content`, from
  `full_inventory` to `report_range` only after exact platform/dataset/date/status/0-entity invariants matched;
- four fresh Instagram Report jobs completed 4/4 on their first Queue attempts: 1D complete with zero daily gain
  and Total Views `4,059,734`; 3D complete with Views `263,287` / Likes `5,023`; 7D complete with Views `527,576`
  / Likes `8,285`; 30D correctly remains partial at `56%` coverage instead of inventing zero values;
- open DLQ/Alerts remained `137/146`; the transient Report lock cleared and total locks returned to baseline `2`;
- fresh Customer export audit covered 33/33 in-scope Data Hub tables: schemas match Dev, duplicate primary keys
  are zero, and Customer holds `55,926` rows versus Dev `43,060` because Customer retains more history. The three
  customer-created Content Creator/Sale-Support tables were excluded and untouched;
- one fully blank `MKT_Sync_Log` record (`recvt6mZnhkueH`) was found and left unchanged pending a separate explicit
  hygiene decision. Final visual confirmation requires refreshing Organic Performance while retaining the exact
  Dashboard filter `customer_profile=chemistry_k`.

### 2026-09-01 — Meta K2 Customer local-CPU finalizer repair

- exact Customer K2 `20260831` source and durable materialization are complete `194/194`; Worker preflight reached
  `450/19,213` before Free CPU retry exhaustion, so no provider reread or replacement generation is required;
- the first local finalizer attempts safely replayed stable keys and persisted `9,700` exact entity rows, but
  Wrangler D1 file-import polling returned an ambiguous post-commit result. No delete, old-data replacement or
  row-count-based skip is permitted;
- the reviewed repair runs preflight with local CPU at the application maximum `1,000` rows per invocation and
  sends every stable-key D1 write again through bounded 100-statement `--command` batches with confirmed results;
- focused tests, `npm run check`, the full `npm test` suite (`3,282` Node tests plus `18` Worker tests),
  `npm run test:report-reliability`, `npm audit --audit-level=high` and `npm run deploy:dry-run` pass;
- live completion remains gated on reviewed merge, one exact local finalizer execution, D1/Lark parity and
  `MKT_Accounts.last_sync_at=2026-09-01`. Preview URLs must remain disabled outside the isolated execution window.
- repeated reviewed local executions have now completed all confirmed D1 commands. An identity-only Preview probe
  returned `META_K2_LOCAL_LARK_MODE_INVALID`, proving operation/workKey/generation and authorization are exact and
  narrowing the remaining pre-write rejection to `batchDigest` only;
- local `structuredClone` preserved Date values while Fetch JSON transport converted them to ISO strings, so the
  Preview Worker correctly rejected the pre-transport digest. Projection rows are now canonicalized to their exact
  JSON wire representation before both hashing and transport; the focused transport/digest regression passes.
