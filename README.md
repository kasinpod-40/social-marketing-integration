# Social Marketing Data Integration

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base สำหรับ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ JavaScript ES Modules, Cloudflare Workers, D1, Queues และ Lark Open API

Storage direction ปัจจุบันคือ API Provider → D1 source/history/coverage → customer-facing Lark
`MKT_*`/Report. ระบบไม่สร้าง non-TikTok Lark RAW mirrors ใหม่และไม่มี switch เปิดกลับ; เฉพาะ
`RAW_TikTok_Creator_Videos` เป็น protected Lark Native source แบบ read-only. Exact retirement scope
และ safe deletion gate อยู่ที่ `docs/project-brain/non-tiktok-lark-raw-retirement-2026-08-14.md`.

`MKT_Accounts` ใน Integration Workspace มี Organic master ครบ 4 ช่องทางแล้ว: Facebook, Instagram,
TikTok และ YouTube. TikTok ใช้ stable key `tiktok:${accountId}` และ permanent sync implementation
เขียน Account หลัง Content/Daily สำเร็จเท่านั้น; Live exact backfill เสร็จแล้ว ส่วน scheduled maintenance
ของ contract ใหม่นี้ merge ผ่าน PR #653 และ deploy รวมกับ Facebook PR #652 บน reviewed Worker แล้ว.
GET-only post-deploy readback ผ่าน 4/4; fresh scheduled evidence รอบถัดไปยังต้องรอตามเวลาจริง. ดู
`docs/project-brain/tiktok-mkt-accounts-master-2026-08-16.md`.

## Read first

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/storage-architecture-and-migration-contract-v1.md
→ docs/project-brain/* relevant files
→ README.md / CHANGELOG.md
→ Source and Tests
```

- `docs/current-task.md` เป็น Current authority สำหรับ Scope และ Acceptance criteria
- Credential, Live write, Remote migration, Deployment, Schedule, Retention และ Production ต้องผ่าน Gate แยก
- ห้ามใช้แชทเป็นอำนาจเหนือ Repository `main`

## Current closeout — Multichannel Report & Schedule v1

Non-wait readiness work on 2026-08-15 closed two exact TikTok partial-write alerts, completed D1
capacity/10x/100x/restore evidence and closed the `MKT_Content_Daily` capacity incident. Exact private backup
preceded deletion of 10,649 non-Facebook rows; readback retained 9,291 rows with Facebook 425/425 protected.
Permanent bounded retention now runs at 08:05 before Daily Report and stops around active sync locks. Facebook
Page-token capability and D1/Lark/Dashboard Likes/Comments parity are proven; its 07:30 source schedule and
the first non-deferred 08:05 retention cycle passed. Facebook full-inventory Coverage and D1↔Lark current MKT
parity passed 89/89; `MKT_Content_Daily` readback is 9,139/10,000 rows. After scheduled Connector evidence,
backup/checksum, YouTube 2,532/2,532 parity and zero-reference/lock checks, the exact operator deleted all
27 non-TikTok Lark RAW tables while preserving the protected TikTok Native RAW and every non-target table.
Remaining gates are Monday Automatic Weekly evidence and customer-owned Production provisioning. See
`docs/current-task.md`.

Repository runtime รองรับ Shared Report schedule สำหรับ Facebook, Instagram, TikTok, YouTube,
Meta Ads, Google Ads, WooCommerce และ Chatwoot ที่ `1D/3D/7D/30D`. Daily schedule เวลา 08:10
Asia/Bangkok สร้าง 32 stable materialization jobs; Weekly วันจันทร์ 08:15 สร้าง 8 stable 7D
refresh jobs. Queue fan-out ใช้ `sendBatch` เมื่อ binding รองรับ.

Facebook Organic ใช้ `pages_show_list`, `pages_read_engagement`, `pages_read_user_content` และ
`read_insights` เป็น permission readiness contract สำหรับ metrics ชุดเต็ม. ระบบอ่านเฉพาะ Post summary
counts (`shares.count`, `reactions.summary.total_count`, `comments.summary.total_count`) โดยไม่ดึงรายการ
ผู้ใช้หรือข้อความ Comment; ค่าที่ Source คืน `0` เป็นศูนย์จริง ส่วน field ที่ไม่คืนต้องคงเป็น null/N/A.

Meta Ads และ Chatwoot ใช้ primary cron สำหรับ Source schedule. Google Ads ยังคงใช้ external
Manager Script trigger และ signed ingress เพื่อไม่สร้าง producer ซ้ำ. ทุก execution/schedule flag
ใน example config ยังเป็น `false`; Integration Workspace เปิด Source/Daily/Weekly schedules แล้ว
และ materialize `2026-08-09` ครบ 32 D1/Lark snapshots. Google Ads fresh LIVE ผ่าน 6 datasets,
7 chunks, 1,335 rows พร้อม D1/Lark parity และ Provider frequency `Daily between 6:00 AM and
7:00 AM`; PREVIEW ไม่มี schedule. YouTube customer Channel owner consent สำเร็จและออก Refresh Token
ใหม่แล้ว; Owner authorization ผ่าน และ PR #638 แยก signed Analytics daily counts ออกจาก cumulative
Data API counts โดยไม่ round/clamp/fabricate. Reviewed deployment รับ traffic 100% และ fresh catch-up
ผ่านครบ 837/837 Videos, 1,919 Analytics rows, zero failed/missing rows, D1 checkpoint และ Lark parity
1,919 unique keys พร้อม signed adjustments จริง 13 cells. YouTube Integration Owner Analytics เป็น Live
PASS; Production ยัง blocked. Chatwoot stable-identity pagination fix merge/deploy แล้ว และ Repository
แก้ fresh Daily ให้ใช้ bounded `updated_within` discovery ครั้งเดียวแทน full-account two-pass; Initial และ
legacy in-progress operations ยังคง stable two-pass. PR #643 merge และ deploy แล้วบน Worker version
`9d768d22-4f96-48aa-87d7-f1dd86c991a6` ที่ traffic 100%; เหลือ fresh scheduled Daily validation โดย
ไม่ใช้ manual run แทนหลักฐาน.
Daily contract ปัจจุบันลดงาน Source โดยไม่ลดความครบถ้วน: Chatwoot เก็บ overlap สามวันแต่ hydrate
เฉพาะ Conversation ที่ยังไม่มีหรือมี `source_updated_at` ใหม่กว่า D1; Meta Ads อ่าน Daily Insights
ของวันที่ปิดแล้วก่อนและดึง Creative เฉพาะ Ad ที่มี activity ในวันนั้น. ข้อมูลย้อนหลังเดิมไม่ถูกลบ
และทุกปลายทางยังใช้ stable-key upsert กับ durable checkpoint เหมือนเดิม.
TikTok Ads ยัง `planned`;
Notification/DLQ redrive ปิดและ Production blocked. ดู
`docs/project-brain/multichannel-report-schedule-final-closure-v1.md` และ
`docs/project-brain/chatwoot-stable-identity-pagination-live-closeout-2026-08-10.md` และ
`docs/project-brain/chatwoot-daily-updated-within-incremental-2026-08-15.md` และ
`docs/current-task.md`.

## Historical TikTok implementation branch — Draft PR #65

```text
Branch                              agent/tiktok-organic-post-lark-d1-parity
Base main                           e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
Code-verified head                  e3c00b93ea95b4a4e564f09cafacc40954b30593
Branch Verification                 #517 PASS
TikTok RAW producer                 watermark probe / no blind scheduled sync
Scheduled metric date               previous completed day
TikTok D1 Report reader             implemented / not remotely cut over
Lark/D1 shadow parity               implemented / flags default false
Post-processing Report admission    Coverage-gated / flag default false
Migration 0016                      source only / not applied remotely
Worker deployment                   not run
Queue / Lark / Remote D1 mutation   none
Schedules                           disabled
Production                          blocked
```

The branch reuses the existing protected Lark Native source, Durable staging, D1 Organic history,
Coverage, Reliability runner, Queue/DLQ, Canonical Lark writer and Report engine. The separately
approved rollout must start read-only and keep all schedules disabled. See
`docs/project-brain/tiktok-organic-post-lark-d1-parity-2026-07-26.md`.

## Current repository state

```text
Application package line           0.11.0
Storage Architecture               V1 documented
Storage Foundation Phase 1A        merged
Storage Foundation Phase 1B        merged
Organic D1 bootstrap PR #27        merged
Organic D1 bootstrap merge         d182bf9efc8c6ea51f275ea725cdb0eaeae3d5e0
Customer OAuth remote rollout      complete
TikTok Canonical Lark sync         implemented / protected Lark Native source retained
Shared Report runtime              8 reviewed channels / 1D 3D 7D 30D
Meta Ads / Google Ads / Chatwoot   active catalogs / Integration runtime explicit gates
Source schedules                   Integration Workspace active / Google Ads Provider daily confirmed
Daily / Weekly Report schedules    Integration Workspace active / 32-window readback pass
Production                         blocked
Google Ads signed delivery         Fresh LIVE pass / 7 chunks / 1,335 rows
Google Ads actual Script LIVE      pass / six datasets / failed rows 0
Google Ads Provider schedule       daily 06:00–07:00 / PREVIEW unscheduled
Google Ads Secret provisioning     completed / route safely closed
YouTube Owner Analytics            owner consent pass / signed daily-count hotfix gated / live catch-up pending
Chatwoot Daily                    updated-within incremental deployed / fresh scheduled validation pending
```

## WooCommerce 2026-only history

Integration Workspace เก็บ WooCommerce Orders, Customers และ Coupons เฉพาะตั้งแต่
`2026-01-01T00:00:00.000Z` ถึง operation boundary แบบ immutable `report_range`.
Store, Products และ Categories เป็น current master snapshots. Full-history ก่อนปี 2026
ถูกยกเลิก; Schedule และ Production ปิด. Cleanup runbook อยู่ที่
`docs/tasks/woocommerce-2026-only-history.md`.

## WooCommerce diagnostics deterministic Preview origin

WooCommerce Preview diagnostics ใช้ deterministic origin:

```text
https://<preview-alias>-<worker-name>.<account-workers-dev-subdomain>.workers.dev
```

Existing Preview URL window wrapper อ่าน account subdomain ผ่าน Cloudflare account API แบบ
GET-only และส่งต่อเฉพาะ validated DNS label. Wrangler structured upload ยังคงต้องมี
`version-upload` exactly one และ Worker version ID ถูกต้อง; Preview URL ใน output เป็น optional
cross-check ที่ต้องตรง origin หากมี. Raw origin/subdomain/account/auth ไม่ถูกพิมพ์หรือ persist.
Command-failed evidence รายงานเฉพาะ output file ที่มี `command-failed` จริง.

Hotfix นี้เป็น Repository/CI only, ไม่มี Remote action และไม่อนุญาต Live rerun.
ดู `docs/tasks/woocommerce-diagnostics-preview-origin-v1.md`.

Wrangler อาจคืน Aliased และ Versioned Preview URL พร้อมกัน. Parser ปัจจุบันจำแนกทั้งสองชนิด
แยกกันและยอมรับหนึ่ง alias + หนึ่ง versioned origin โดย request target ยังคงเป็น deterministic
alias เท่านั้น. URL evidence นอก six declared Preview containers ไม่ถูกสแกน และ foreign/unsafe
URL ต้อง fail closed. ดู `docs/tasks/woocommerce-end-to-end-lark-closeout-v1.md`.

## WooCommerce diagnostics Preview Queue sentinel

Preview-only WooCommerce diagnostics entrypoint มี fail-closed Queue sentinel เพื่อให้ Cloudflare
ตรวจ Worker Version ของ Worker ที่ลงทะเบียนเป็น Queue consumer ได้. Sentinel เรียก
`batch.retryAll()` exactly once และไม่ ack/ประมวลผล message. Diagnostic configs ไม่มี Queue,
routes, crons, D1 หรือ Production bindings; Production Worker runtime ไม่เปลี่ยน.
Hotfix นี้เป็น Repository/CI only และไม่อนุญาต Live rerun.

ดู `docs/tasks/woocommerce-diagnostics-queue-sentinel-v1.md`.

## YouTube Worker dry-run operator

The repository includes a guarded, plan-only-by-default operator for an eventual separately
authorized Integration Workspace dry-run:

```bash
npm run rollout:youtube-dry-run
```

It uses Stable `operationId` identity instead of Queue delivery `message.id`, permits only Public
YouTube GET plus Lark planning GET, and forbids Business/Coverage/checkpoint/Lark writes,
Analytics, OAuth refresh and schedules. Executable phases require separate exact confirmations;
canonical SHA-256 evidence links every phase, Remote verification reads actual
version/traffic/consumer/trigger state, and restore blocks any unproven concurrent version.
Workers-runtime tests exercise real D1 migrations/stores while mocking only external transports.
Adding the operator does not authorize Remote execution. See
`docs/tasks/youtube-worker-dry-run-rollout-operator.md`.

Customer OAuth source status (2026-07-24):

```text
Shared Connection/OAuth            merged via PR #42
Google Ads Customer OAuth          merged via PR #43
YouTube Customer OAuth             merged via PR #44
Migration 0011                     applied remotely
Worker deployment                  v2 / preview-safe smoke passed
Google OAuth config                redirects/APIs/scopes ready
Worker Secrets                     required names 7/7
Customer Connect links             2 customer links active / 7 days / 3 starts each
Customer OAuth                     awaiting customer action
Retry-safe Connect v2              deployed / repeat-GET passed
Migration 0012                     applied remotely / none pending
Queue/Lark callback side effects   0 / 0 by contract
```

See `docs/customer-connection-oauth-contract-v2.md` and
`docs/customer-connection-oauth-rollout.md`. PR `#45` merged a side-effect-free
GET confirmation and bounded explicit POST-to-start into `main`. Migration
`0012` and Worker v2 are live; opening both test URLs twice consumed zero
attempts and created no OAuth state. The short-lived test links expired unused;
seven-day customer links are now active. Signed URLs are not stored in the
Repository.

PR #27 added source code and a guarded runbook. It did not apply Migration `0009` remotely, deploy a Worker, send a Queue message or write Live D1/Lark business data.

## Integration Workspace

ก่อน Production ใช้ **Integration Workspace เพียงชุดเดียว** ไม่แยก DEV/UAT ในการปฏิบัติงาน

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

`MKT_ENV=development` เป็น Technical runtime label เท่านั้น

TikTok Organic identity is locked to:

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
```

Integration Workspace rejects a TikTok handle override that would store another source under the Chemistry K Stable key.

Current Workspace resources are developer-owned. Production remains separate and must use customer-owned Lark, Cloudflare, D1, Queue, secrets and Platform assets.

## Current Lark state

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Google Ads Formula fields    4/4 PASS
Google Ads managed filters  19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
```

Relevant TikTok inventory:

```text
RAW_TikTok_Creator_Videos   approximately 2,021 records
MKT_Content                 22 records at last verified audit
MKT_Content_Daily           208 records at last verified audit
```

Dashboard Report Settings reconciliation (2026-07-28):

```text
Canonical active settings              9
Active legacy developer settings       0
Legacy settings retained disabled      2
Historical report references retained 27
Report setting/history deletes         0
```

`RAW_TikTok_Creator_Videos` is a protected Lark Native source. The Worker may read it but must not mutate its Table, Fields or Records.

Do not rerun Lark Formula/View/Filter Apply from the Organic bootstrap task.

## Storage Architecture v1

```text
Platform / Lark Native Sources
→ validated ingestion
→ D1 current state + historical facts + coverage
→ deterministic calculation
→ Lark current state + bounded cache + aggregate + report result
→ Dashboard / AI / Notification
```

Foundation tables:

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
ads_entity_state
ads_daily_facts
ads_conversion_daily_facts
data_coverage_runs
data_coverage_entities
report_materializations
report_requests
```

Names, Grain, Stable keys, Fields, Indexes and UPSERT rules are defined in `docs/project-brain/storage-architecture-and-migration-contract-v1.md`.

## Organic D1 bootstrap

Manual Job:

```text
tiktok.creator.native.history.bootstrap
```

Required flags:

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_TIME_SERIES_D1_WRITE_ENABLED=true
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=true
```

Rules:

- manual Queue trigger only;
- never emitted by schedules;
- Integration Workspace only;
- Dry-run writes zero Marketing-history/Lark business rows;
- live bootstrap writes D1 only;
- source pages are bounded and durably staged;
- no synthetic historical Daily rows;
- first trusted metrics are `initial`;
- changed metrics are `changed`;
- cumulative decreases are `correction`;
- unchanged metrics create no Observation;
- missing metric remains `null`; observed zero remains `0`;
- Coverage and source watermark are persisted for reconciliation.

Payload helper:

```bash
npm run job:tiktok-history-bootstrap
```

The helper prints a body only and never sends it.

Guarded rollout instructions:

```text
docs/runbooks/tiktok-organic-d1-bootstrap.md
```

## D1-first TikTok path

When D1 history writing is enabled in a later separately approved Canonical run, each staged unit executes:

```text
validate complete unit
→ D1 Current state / Observation / Coverage
→ Lark MKT_Content
→ Lark MKT_Content_Daily
→ persist unit completion
```

D1 failure prevents Lark writes. Lark failure after D1 success is retryable; D1 replays idempotently and Lark is repaired.

The full Chemistry K TikTok RAW → Lark Canonical run remains blocked from Live execution until the separately approved Migration/deploy/audit/parity rollout for Draft PR #65 completes.

## Dashboard range contract

Customer Dashboard must eventually support:

```text
3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

- presets are rolling completed days ending yesterday by Reporting timezone;
- Organic cumulative metrics use end observation minus pre-period baseline;
- Ads use additive Daily facts and old-day Attribution revisions;
- old Content without a baseline is `partial`;
- Dashboard must show Coverage/Data status;
- Report D1 shadow read and customer-visible cutover require the separately approved PR #65 rollout.

### Shared-dimensions backfill recovery preview

หลัง Merge operator v1.2 ให้ตรวจ Incident state แบบ read-only จาก clean Current `main`:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

`updateRows=0` หมายถึง Apply ก่อนหน้า converge แล้วและไม่ต้อง Apply ซ้ำ. `updateRows>0`
หมายถึงยังมี pending จริงและต้องขออนุมัติ Apply ใหม่แยกต่างหาก. Preview ไม่เขียน Lark/D1,
ไม่ Deploy Worker และไม่ส่ง Queue.

## `MKT_Content` ownership

Protected business fields:

```text
course_name
course_level
course_type
content_theme
funnel_stage
cta_type
cta_destination
promotion_type
urgency_level
manual_tag_note
```

- write approved values on Create or into blank non-manual fields;
- preserve protected classification when `classification_source=manual`;
- never overwrite `manual_tag_note` after Create;
- incoming `null` cannot clear a protected existing value;
- Formula, Lookup, Relation and fields outside the ownership mask remain untouched.

## Migration feature flags

All release examples default to `false`:

```env
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
MKT_NOTIFICATION_RUNTIME_ENABLED=false
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
```

Backfill requires D1 write. Retention requires the D1 Report reader. Enabling Storage flags does not enable a schedule.

## Connector status

| Connector | Current state | Direction |
| --- | --- | --- |
| TikTok Organic | Draft PR #65 code complete and verified; protected Native RAW retained | Separate read-only-first rollout for Migration 0016, audit, one watermark admission and parity |
| YouTube Organic | Runtime foundation exists on developer source | Separate parallel Workstream |
| Facebook Organic | Live source and Dashboard Likes/Comments parity accepted; schedule active | Verify next 07:30 sync and 08:05 retention; retained operations remain replay-protected |
| Instagram Organic | July D1/Lark parity accepted | All Meta completion Workstream; Worker restored all-false |
| Meta Ads | July activity-scoped implementation under Gate | D1 keeps detail; Lark keeps activity entities and Shared Reports only |
| Google Ads | Signed delivery and LIVE UAT completed / safely closed | No new implementation unless a separate incident or enhancement is approved |
| TikTok Ads | Access/design preflight | Controlled API/Worker connector later |
| WooCommerce | 2026-only Runtime verified; Live cleanup/reconciliation pending merged HEAD | Bounded Integration Workspace closeout; Schedule/Production remain closed |
| Chatwoot | Closed accepted Partial UAT | Not a Meta prerequisite; retained DLQ/Alerts remain forensic truth |

Draft PR #11 is obsolete/superseded and must not be merged.

Meta token preflight is intentionally separate from Business ingestion:

```bash
npm run preflight:meta
```

The command reads ignored local credentials, performs GET-only identity and
permission discovery, emits redacted per-connector results and makes zero
Queue/Lark/D1/business writes. Facebook Organic, Instagram Organic and Meta Ads
remain `uat_pending` with every feature flag set to `false`.

The next no-credential design boundary is documented in
`docs/meta-business-ingestion-contract-v1.md`. It reuses the existing five
Shared Raw tables and approved D1/Canonical model; it does not authorize Live
Meta calls, business writes, schedules or deployment.

## Verification gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

PR #27 merged after Branch Verification run #327 passed all gates. Draft PR #65 code head
`e3c00b93ea95b4a4e564f09cafacc40954b30593` passed Branch Verification run #517.

## Safety

```text
REMOTE_D1_MIGRATION       Migration 0016 not applied by PR #65
WORKER_DEPLOYMENT         none by PR #65
QUEUE_MESSAGE             none by PR #65
LIVE_D1_CANONICAL_RUN     none by PR #65
LARK_SCHEMA_MUTATION      none
LARK_RECORD_MUTATION      none by PR #65
TIKTOK_CANONICAL_SYNC     repository-ready / Live rollout pending
REPORT_CUTOVER            disabled / rollout pending
LARK_RETENTION            blocked
SCHEDULE                  disabled
PRODUCTION                blocked
```

No fake history, no missing-to-zero conversion, no protected RAW mutation, no cleanup based on legacy Profile names and no secrets in Source or Lark.
