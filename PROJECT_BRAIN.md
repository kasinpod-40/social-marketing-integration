# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

Historical Root Project Brain ก่อน TikTok post-Lark implementation ถูกเก็บแบบ immutable ที่:

```text
docs/archive/PROJECT_BRAIN-before-tiktok-post-lark-parity-2026-07-26.md
```

## Current verified repository state — 2026-07-27

```text
Integration Workspace                         active
Technical environment                         development
Runtime profile                               integration_workspace
TikTok post-Lark pipeline                     merged via PR #65
TikTok pipeline merge commit                  acb0b76bb3be936319e0e8bed4849592c96761b5
TikTok guarded rollout operator               merged via PR #71
TikTok operator merge commit                  e6b8bd0b9098b9a79bae49ff24455187e43a331e
TikTok operator reviewed head                 df229ccade82ce7869c01bbf75c1cb3fc0f16cd1
TikTok operator final verification            #558 PASS
Meta end-to-end implementation                merged via PR #69
Meta implementation merge commit              11e861cfbc79ea067a90496b205f692ca8bb4d3d
Meta protected runtime                        merged via PR #73
Meta runtime merge commit                     13ebba1476d7983428c5b5ce51ce754adf493ad5
Meta runtime reviewed head                    a700f5f31ebd24a32cc64cc6ca5ffe123a632ff4
Meta runtime verification                     #26 / #593 PASS
Meta read-only validation operator            merged via PR #82
Meta operator merge commit                    0f38aeb8a1c69e8655145f97808f3d3d1b31615a
Meta operator reviewed head                   9b6f8d48891daa9ad7620f731dcdf2483da871e3
Meta operator verification                    #29 / #605 PASS
YouTube end-to-end integration                merged via PR #85
YouTube integration merge commit              dce3bd954ee75ee55a29efac303e9973ca060fca
YouTube reviewed head                         c5ffc4327ffec405f82472c7b7098b45bac82722
YouTube final verification                    #581 PASS
Chatwoot analytics foundation                 merged via PR #68
Chatwoot foundation merge commit              80601de973740e8654b2cea2c4ecf419f4378c0a
Chatwoot foundation verification              #619 PASS
WooCommerce end-to-end integration            merged via PR #94
WooCommerce integration merge commit          060977cd9ed2933700fbd121c9236e6578ad571e
WooCommerce reviewed Integration head         d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
WooCommerce final verification                #622 PASS
Migration 0016                                applied remotely / additive verification passed
Migration 0017                                WooCommerce source only / not applied remotely
Worker deployment                             TikTok restored safe-closed / Meta, YouTube, Chatwoot and WooCommerce not run
Provider execution                            not run for Meta, YouTube, Chatwoot or WooCommerce rollout
Queue send / DLQ redrive                      none for TikTok, Meta, YouTube, Chatwoot or WooCommerce rollout
Remote D1 / Lark mutation                     TikTok Migration 0016 only / no Business fact or Lark mutation
Schedules                                     disabled
Retention/delete                              blocked
Production                                    blocked
Google Ads                                    LIVE UAT complete / safely closed
```

## YouTube Worker dry-run rollout operator — repository implementation

Branch `integration/youtube-worker-dry-run-rollout-operator` เพิ่ม Stable Queue identity
`youtube:{operationId}` และ deterministic `youtube-dry-run:{operationId}` เฉพาะ trigger
`youtube_worker_dry_run`. Delivery `message.id` ไม่ใช่ durable identity; completed operation
replay โดยไม่เรียก Provider ซ้ำ ขณะที่ scheduled/legacy YouTube path คง behavior เดิม.

Operator `youtube-dry-run-rollout-v1` เป็น plan-only โดย default, ใช้ confirmation แยกทุก phase,
exact Git provenance, sanitized evidence chain, one-message/no-auto-resend และ independent
all-flags-false restore. Dry-run อนุญาตเฉพาะ Public YouTube GET, Lark planning GET และ Shared
operational mutations; ห้าม Business/Coverage/checkpoint/Lark write, Analytics และ OAuth refresh.
Warning drain กับ expired-work cleanup ถูกข้ามเฉพาะ Operator path.

งานนี้เป็น Repository-only: ไม่มี Worker/D1/Lark/Provider/Queue/DLQ/Schedule/Production action.
รายละเอียด:

```text
docs/project-brain/youtube-worker-dry-run-rollout-operator-2026-07-27.md
```

## TikTok Organic identity and protected source

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
source=lark_native_tiktok_for_creator
```

`RAW_TikTok_Creator_Videos` is a protected Lark Native source. Runtime may read it but must not mutate its Table, Fields, Views, Formula, Filter or Records.

Retained last verified Live facts:

```text
RAW_TikTok_Creator_Videos             approximately 2021
organic_content_state                 2021
organic_content_observations          2021
data_coverage_entities                3396
D1 duplicate State/Observation groups 0 / 0
MKT_Content                           22 at last verified audit
MKT_Content_Daily                     208 at last verified audit
```

These counts are historical evidence, not a new freshness claim. New Live facts require the guarded read-only audit.

## Merged TikTok post-Lark architecture

```text
Lark Native TikTok sync approximately 07:00 Asia/Bangkok
→ bounded read-only RAW probe
→ two identical probes / deterministic watermark
→ durable same-watermark admission
→ existing Durable source staging
→ staged-watermark fence
→ full-unit preflight
→ existing D1 Observation / State / Coverage
→ existing Canonical Lark writer
→ completed Coverage re-read
→ idempotent Daily Report request
→ Lark-primary + D1-shadow or D1-primary Report calculation
→ bounded Lark metadata hydration
→ existing Report output writer
→ optional deterministic D1 materialization
```

Scheduled `metricDate` is the previous completed local day. The scheduler no longer emits a blind TikTok Business sync and rejects conflicting independent/post-processing Daily Report producers.

No second TikTok connector, Reliability stack, Queue/DLQ framework, D1 history writer, Canonical writer, Lark sync engine or Report formula engine was created.

## Merged guarded TikTok rollout operator

PR `#71` added an operator for these separately confirmed phases:

```text
plan
preflight
backup
migrate
deploy-safe
enable-audit
audit
disable-audit
```

The operator:

- defaults to plan-only;
- locks the exact Integration Workspace, Chemistry K source, D1 and Worker identity;
- requires a checksum-verified backup before Migration `0016`;
- validates exactly pending Migration `0016` and additive post-migration count parity;
- permits only Audit HTTP during the audit-only deployment;
- validates route state `404 → 401 → 200 → 404`;
- retains `readyForManualProcessing=false` as diagnostic evidence;
- preserves emergency safe-close when the authenticated Audit fails;
- contains no Queue send, DLQ action, Business write, schedule, retention/delete or Production path.

Final aligned Branch Verification `#558` passed after the merged Meta implementation was included.

Detailed operator closeout:

```text
docs/project-brain/tiktok-post-lark-rollout-operator-merge-closeout-2026-07-27.md
```

## TikTok Remote rollout and Audit diagnostic incident

The separately authorized rollout completed the read-only preflight, checksum-verified Remote D1
backup, additive Migration `0016`, and an all-flags-false Worker deployment. Migration verification
retained zero Admission rows, zero active Work/Locks, zero duplicate groups and unchanged TikTok
Business counts.

A controlled authenticated GET-only Audit window reached the handler but returned:

```text
HTTP status                         400
error                               TikTok audit failed
code                                null / missing
Queue or Business write             none
```

The route was restored to safe-closed HTTP `404` through the approved emergency safe deployment.
TikTok Audit, Business-write and Schedule flags are all `false`. Manual processing, Queue,
Canonical/D1 Business writes, Lark mutation, Report cutover and schedules remain blocked.

The Repository-only branch `hotfix/tiktok-post-lark-audit-error-code` adds a stable sanitized
fallback code at the HTTP boundary and propagates only `httpStatus` plus `remoteCode` through the
rollout operator. The Hotfix performs no Remote action and authorizes no new Audit window.

## Merged YouTube Organic integration

PR `#85` merged the reviewed YouTube End-to-End implementation and the Integration-owned Shared Worker wiring. Shared routing now selects the D1-first End-to-End route only when the dedicated gate is explicitly true:

```text
YouTube job + MKT_YOUTUBE_END_TO_END_ENABLED=true
  → dedicated D1-first route

YouTube job + flag false/unset
  → existing active router and legacy YouTube route

Non-YouTube job
  → existing Google Ads/TikTok/History/Active chain unchanged
```

The merge reuses the existing YouTube API client, Shared Google OAuth Core, normalizers, Reliability runner, distributed lock, resumable work, Organic history writer, D1 stores, Coverage and `TableSyncEngine`. No duplicate Connector, Queue, Reliability, D1, Lark or Report engine was created.

The merged implementation includes bounded large-inventory storage, retry-safe Coverage, fail-closed report reads, non-destructive missing/private/deleted handling, hidden-subscriber `null` semantics, and D1-before-Lark ordering. YouTube Analytics period facts remain in `RAW_YouTube_Analytics_Daily`; no new migration was added.

Detailed records:

```text
docs/tasks/youtube-organic-end-to-end.md
docs/tasks/youtube-organic-end-to-end-integration-review.md
docs/tasks/youtube-organic-integration-wiring-safe-rollout.md
```

Remote schema inspection, Worker deployment, Provider calls, Queue messages, D1/Lark Business writes, schedules and LIVE UAT remain blocked pending separate authorization.

## Merged Chemistry K Meta runtime

PR `#73` merged the protected Meta routing and exact Chemistry K multi-account contract:

```text
Facebook Page       982406442148381 / เคมี K
Instagram           17841413521012797 / chemistry_key
Meta Ads alias      chemistry_k2 → 505898710119851
Meta Ads alias      chemistry_k3 → 851206695716861
```

Canonical mapping:

```text
META_AD_ACCOUNT_MAPPINGS=chemistry_k2=505898710119851,chemistry_k3=851206695716861
```

The Shared route preserves:

```text
YouTube guarded route
→ Google Ads protected route
→ Meta protected route
→ TikTok/report/active fallback
```

Meta runtime contracts:

- Facebook, Instagram and Meta Ads remain `uat_pending` and manual-only;
- protected activation requires `development`, `integration_workspace`, Chemistry K and an explicit source-read gate;
- all Connector/source/D1/Lark/report controls default to `false`;
- mappings reject malformed, duplicate or mixed legacy/canonical configuration;
- every Meta Ads job chooses exactly one configured `sourceAccountKey`;
- Queue work key, sync-run identity, Reliability scope and continuation preserve the selected alias;
- Coverage IDs include the exact Ad Account identity;
- unknown aliases fail before Provider access;
- preflight output is sanitized;
- the existing Reliability, Queue/DLQ, D1 history/Coverage and Lark `TableSyncEngine` are reused.

## Merged Meta read-only validation operator

PR `#82` added the separately confirmed operator:

```text
plan
→ configuration preflight / zero Provider requests
→ Facebook GET-only validation
→ Instagram GET-only validation
→ chemistry_k2 GET-only validation
→ chemistry_k3 GET-only validation
→ sanitized summary
```

The operator:

- defaults to plan-only;
- requires an exact confirmation for every executable phase;
- requires every Connector, Meta, D1/report, DLQ-redrive and Schedule flag to be explicitly `false`;
- validates one Connector/account per phase;
- uses the existing GET-only Graph client and never places the Token in the URL;
- rejects unknown Meta Ads aliases before Provider access;
- binds evidence to the same contract version, API version and sanitized target fingerprint;
- excludes Tokens and raw customer IDs from output/evidence;
- contains no Queue send, D1/Lark mutation, Worker deployment, schedule or Production path.

Repository verification passed on the final reviewed operator head:

```text
Meta End-to-End Verification  #29 PASS
Branch Verification           #605 PASS
```

Detailed records:

```text
docs/tasks/meta-runtime-wiring.md
docs/tasks/meta-read-only-validation-operator.md
docs/runbooks/meta-read-only-validation.md
```

Provider execution has not run and remains a separate explicit gate.

## Merged Chatwoot analytics foundation

PR `#68` merged the reviewed bounded Chatwoot polling and analytics foundation at
`80601de973740e8654b2cea2c4ecf419f4378c0a`. It adds PII-minimized source collection,
stable identity/revision handling, bounded D1/Coverage preparation and optional existing
`TableSyncEngine` delivery. Runtime routing and a numbered Chatwoot migration remain separate work.

WooCommerce Integration owns Migration `0017`; Chatwoot Runtime Wiring must refresh the migration
directory and currently treats its later migration as provisional `0018`.

Detailed closeout:

```text
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
```

## Merged WooCommerce integration

PR `#94` merged the reviewed WooCommerce End-to-End implementation and Shared protected wiring at
`060977cd9ed2933700fbd121c9236e6578ad571e` after Branch Verification `#622` passed.

Merged contracts include:

- read-only WooCommerce REST transport with HTTPS and header-only Basic authentication;
- PII-minimized Commerce models and exact currency micros;
- immutable continuation scope, source-revision gating and atomic Order-line replacement;
- additive D1 RAW/Canonical/Daily facts and Coverage-backed reports;
- stable Queue work identity `woocommerce:<operationId>`;
- protected `uat_pending` / `manualOnly` routing;
- existing Reliability, lock, Queue retry/DLQ, Coverage and `TableSyncEngine` reuse;
- additive source Migration `0017_woocommerce_commerce.sql`;
- all Connector, D1, Lark, Report, full-reconciliation and Schedule controls default `false`.

The merge performed no Provider request, credential use, Remote D1/Lark mutation, Queue action,
Worker deployment, Schedule, LIVE UAT or Production change.

Detailed closeout:

```text
docs/project-brain/woocommerce-integration-merge-closeout-2026-07-27.md
```

## Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_META_ADS_ENABLED=false
MKT_META_SOURCE_READ_ENABLED=false
MKT_META_D1_WRITE_ENABLED=false
MKT_META_LARK_WRITE_ENABLED=false
MKT_META_REPORT_READ_ENABLED=false
MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_YOUTUBE_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
```

Storage, Source-read and Report flags never implicitly enable schedules.

## Shared Core authority

All channel Workstreams must reuse:

- central Connector and Job catalogs;
- deterministic Stable keys and exact identity validation;
- existing Queue/DLQ and operation identity helpers;
- existing Reliability runner, lock renewal and typed retry classification;
- D1 history/Coverage contracts and Storage Foundation;
- existing Canonical Lark writer and `TableSyncEngine`;
- existing Report calculations, materialization and output writers;
- sanitized observability with no Secret or raw customer payload exposure.

Do not create a parallel Reliability, Queue, D1 writer, Lark sync or Report engine.

## Parallel Workstreams

```text
TikTok Organic       Migration 0016 applied / Audit failed without code / safe-closed / Hotfix review pending
All Meta             runtime PR #73 merged / read-only operator PR #82 merged / Provider validation pending
YouTube Organic      integration PR #85 merged / Remote read-only preflight pending
Chatwoot             foundation PR #68 merged / Runtime Wiring waits after Migration 0017 owner
WooCommerce          integration PR #94 merged / Migration 0017 and Remote rollout pending
Google Ads           complete / safely closed
```

Each remaining Workstream owns a unique Branch and Draft PR. Migration, deployment, Queue sends, Remote Lark/D1 mutation, schedules and LIVE UAT remain Integration-stream responsibilities only.

## Next separately approved TikTok rollout

Migration `0016` is already applied and must not be rerun. The next order is:

1. review and separately approve merge of the sanitized error-code Hotfix;
2. separately authorize an all-flags-false Worker deployment containing the reviewed Hotfix;
3. confirm the route remains safe-closed HTTP `404`;
4. separately authorize one new controlled Audit-only window and one authenticated GET;
5. capture the stable sanitized Remote error code or a successful read-only Audit result;
6. restore all-flags-false Worker state immediately;
7. only after a clean Audit, consider one manual new-watermark Admission;
8. reconcile D1/Canonical/Coverage and validate exact rerun stability;
9. propose Schedule activation only after all prior gates pass.

This Hotfix PR authorizes none of these Remote phases.

## Next separately approved YouTube rollout

The Repository implementation is merged, but no Remote phase is authorized automatically. The next order is:

1. authenticated read-only verification that Storage Foundation `0009` tables exist;
2. inspect deployed configuration and confirm every YouTube/Storage/Report/Schedule flag is false;
3. retain and review sanitized evidence;
4. separately authorize an all-flags-false Worker deployment;
5. separately authorize a dry-run/read-only YouTube operation;
6. verify non-dry execution is blocked while D1 or Lark gate is false;
7. separately authorize controlled Integration Workspace D1-first/Lark UAT;
8. verify Coverage, idempotent rerun and D1 Report shadow parity;
9. keep Schedule and Production blocked until a new explicit approval.

## Next separately approved Meta validation

The runtime and operator are merged, but Provider execution is not authorized automatically. The next order is:

1. run `rollout:meta-read-only` in plan-only mode from an authorized local Integration Workspace;
2. separately authorize configuration preflight and confirm Provider requests remain zero;
3. retain and review sanitized preflight evidence;
4. separately authorize one Facebook GET-only identity/permission validation;
5. separately authorize one Instagram GET-only identity/permission validation;
6. separately authorize one `chemistry_k2` GET-only validation;
7. separately authorize one `chemistry_k3` GET-only validation;
8. create and review the sanitized summary;
9. only after a clean summary, consider a separate D1-only processing gate.

D1 writes, Coverage reconciliation, Lark parity, LIVE UAT, schedules and Production remain later approval gates.

## Repository hygiene audit note

A temporary `tmp/noop` file containing only `x` was accidentally created on `main` at
`62857a7e6c298b4be02dc105aeecbff4080d5313` during PR `#82` branch reconstruction and immediately
removed at `6158a8b1381d62539274a7fa77d7860bdbee624a`.

The final tree contains no temporary file and no Business fact, Secret, Runtime configuration,
migration, Queue state, D1/Lark data or deployed infrastructure was changed by the incident. The
commits are retained as transparent audit history.

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before parity, backup, reconciliation and rollback;
- no protected RAW mutation;
- no rerun of completed TikTok recovery operators;
- no duplicate Reliability/Queue/D1/Lark/Report engine;
- Connector flags and schedules disabled by default;
- Secrets stay in Environment/Secret Manager;
- Production resources must be customer-owned.
