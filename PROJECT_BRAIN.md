# Project Brain — Social Marketing Data Integration

## Multichannel Report & Schedule Final Closure — 2026-08-09

Meta Ads, Google Ads และ Chatwoot ได้รับการ promote เป็น active จาก retained UAT evidence
โดย execution flags ยัง default false. Daily/Weekly schedule ใช้ Shared
`report.materialization.generate` ครบ 8 reviewed platforms ที่ `1D/3D/7D/30D`, มี Stable
Queue identity และ batched fan-out. Meta Ads/Chatwoot ใช้ primary cron; Google Ads คง external
Manager Script boundary เพื่อไม่สร้าง duplicate producer. TikTok Ads ยัง planned, Facebook R2
ห้าม replay, Production blocked. รายละเอียดและ activation gate อยู่ที่
`docs/project-brain/multichannel-report-schedule-final-closure-v1.md`.

## Chatwoot Initial terminal recovery — 2026-08-01

The current retained Initial operation was terminalized after Final UAT polling mistakenly treated a `running`
unit as failed and restored the Worker all-false before Queue completion. Recovery is exact-session/D1-proven,
reactivates only the guarded existing Work, sends no replacement Initial admission, preserves partial masters,
requires 15-target D1/Lark parity plus Initial/Daily replay stability, and closes incidents only after Safe
completion. See `docs/project-brain/chatwoot-initial-terminal-failure-recovery-2026-08-01.md`.

The live recovery later proved that durable Queue work can outlive the local controller. The exact Initial
operation advanced beyond the attempts-16 boundary while the controller's cached Cloudflare OAuth bearer expired;
the Worker and Queue remained healthy, but controller polling and automatic Safe restore stopped. The recovery
operator now selects exactly one incomplete prior evidence directory, resumes by polling without another Initial
send, refreshes Queue REST bearer authorization just in time, keeps Wrangler on its refreshable OAuth session and
checks active deployment at a bounded cadence. The original 30-day/3-day/parity contract remains unchanged.

## WooCommerce 2026-only history decision — 2026-07-30

คำสั่งล่าสุดแทนที่ Full-history WooCommerce ด้วย Order history ตั้งแต่
`2026-01-01T00:00:00.000Z` ถึง operation boundary. Orders/Customers/Coupons ใช้
`report_range`; Store/Products/Categories เป็น current master snapshot. Pre-2026 Business rows
ต้อง backup, exact-key reconcile และลบจาก D1/Lark ก่อน bounded rerun. Worker ต้องคืน all-false
และ Schedule/Production ปิดตลอด. Full-history durable operation เดิมห้าม resume เพราะไม่มี
2026 boundary; หลัง backup ให้ปิดเฉพาะ exact Work/Sync identity เป็น scope-replaced.

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified repository/runtime state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

Historical Root Project Brain ก่อน TikTok post-Lark implementation ถูกเก็บแบบ immutable ที่:

```text
docs/archive/PROJECT_BRAIN-before-tiktok-post-lark-parity-2026-07-26.md
```

## WooCommerce snapshot idempotent normalization — 2026-07-30

Root cause ของ Final exact preflight semantic-empty คือ double normalization ภายใน operator:
`readSnapshot()` คืน camelCase แล้ว selector/classifier เรียก snake_case-only normalizer ซ้ำ.
D1/OAuth/bearer/generated-config/subprocess read ทั้งหมดเห็น durable operation และ 897 rows
ถูกต้อง จึงตัด Cloudflare account, token, replica และ config drift ออกได้.

Current normalizer รองรับ raw และ normalized snapshot แบบ idempotent รวม Work/Queue/Fence,
Coverage, state/completion และ 14 Commerce counts. Semantic-empty retry ยังคงเป็น fallback
เฉพาะ raw empty read จริง. Failed attempts ทั้งหมดหยุดก่อน Lark/backup/Deploy/Queue.

รายละเอียด:

```text
docs/tasks/woocommerce-snapshot-idempotent-normalization-v1.md
```

## WooCommerce exact snapshot semantic retry — 2026-07-30

หลัง exact lifecycle reactivation ของ `woo-final-full-e2372e56d52d` สำเร็จ Final remote
preflight เห็น pinned active work, zero other work/locks แต่ snapshot read ถัดมาได้ successful
semantic-empty row ชั่วคราว. Read-only inspector หลัง failure ยืนยัน durable state และ partial
facts เดิมยังครบ; attempt ไม่มี Lark/backup/Deploy/Queue mutation.

Exact continuation จึง retry read-only snapshot แบบ bounded เฉพาะเมื่อทุก identity, state,
Coverage, Queue attempts และ Commerce counts ว่างทั้งหมด. Snapshot ที่มีข้อมูลแต่ผิด contract
ยัง fail closed ทันที และ retry เกิดก่อน Remote mutation ทุกชนิด.

รายละเอียด:

```text
docs/tasks/woocommerce-exact-snapshot-semantic-retry-v1.md
```

## WooCommerce exact-resume lifecycle reactivation — 2026-07-30

Exact continuation ของ `woo-final-full-e2372e56d52d` ถูก source-safe launcher รุ่นเดิมเรียก
generic failed-work recovery ก่อนอ่าน exact-resume env จึงเปลี่ยน lifecycle เป็น terminal
หลังมี partial D1/Lark writes แล้ว. Attempt นี้ไม่ Deploy Worker, ไม่ส่ง Queue และไม่เปลี่ยน
Business/Coverage/Lark facts; Final operator หยุดต่อด้วย defect `optionalText is not defined`.

Live read-only inspection บน
`main@b10458e3873a16481264fa4889a88620b9669c3d` ยืนยัน failed code
`WOOCOMMERCE_D1_READ_FAILED`, incomplete phase ที่ dataset 1/page 2, Queue attempts 7,
Coverage 2/invalid 1, Business rows 897 และ active lock 0.

Current correction ข้าม generic recovery เมื่อ exact operation ถูก pin, ปิด generic
recovery ทั้ง discovery และ mutation สำหรับ work ที่มี Coverage/Commerce rows, อนุญาต
preflight active work เฉพาะ pinned identity หนึ่งรายการ และเพิ่ม exact lifecycle reactivation
แถวเดียวพร้อม immutable pre/post verification. หลัง merge ต้อง re-activate และ resume
operation เดิมเท่านั้น; ห้าม abandon หรือ admit replacement full operation.

รายละเอียด:

```text
docs/tasks/woocommerce-exact-resume-reactivation-hotfix-v1.md
```

## WooCommerce Preview alias/version pair classifier — 2026-07-30

Wrangler `version-upload` สามารถคืนทั้ง Aliased และ Versioned Preview URL ใน upload เดียว.
Parser แยกทั้งสองชนิดด้วย exact Worker/account workers.dev identity แทนการถือ distinct origins
สองค่าเป็น ambiguity. Deterministic alias ยังคงเป็น request target เสมอ; Versioned URL เป็น
cross-check เท่านั้น. Extraction จำกัดที่ six declared Preview containers และ fail closed สำหรับ
malformed/foreign/unsafe URL โดย evidence ไม่มี raw origin.

Focused tests ผ่าน `36/36`; full Unit `1460/1460`, Workers runtime `15/15`, Report reliability
`100/100`, repository check, audit และ dry-runs ผ่าน. Repository implementation ไม่มี Remote
action. Live diagnostics และ D1/Lark rollout ดำเนินต่อหลัง merge ภายใต้ scoped authorization.

รายละเอียด:

```text
docs/tasks/woocommerce-end-to-end-lark-closeout-v1.md
```

Live diagnostics หลัง merge ผ่าน classifier และ Safe restore แต่ Provider HTTP `200` body ถูก
จำแนกเป็น HTML/XML ทั้งที่ Content-Type เป็น JSON. Public unauthenticated exact-route GET ด้วย
Worker headers ได้ JSON `401`, จึงไม่ใช่ hostname/path/Accept/User-Agent mismatch. Follow-up
เพิ่มเฉพาะ `responseRedirected`, response URL presence และ origin/path match booleans โดยไม่เก็บ
raw URL/body/prefix เพื่อแยก redirect จาก direct Provider contamination ก่อนตัดสิน external fix.
Rerun หลัง PR #252 ผ่าน Provider diagnostics แล้วบน
`main@527cdceda2d4661c82dc000380705d1078343bdf`; store รายงาน WooCommerce `10.6.2`,
WordPress `6.9.4`, currency `THB`, Preview URLs ถูก restore disabled และ Production baseline
ไม่เปลี่ยน. Exact inspector ของ `woo-final-full-6f43ac8ee857` ยืนยัน failed/stale-active,
no lock, one Queue attempt และ zero Coverage/Commerce rows จึงอนุญาตเฉพาะ guarded
lifecycle-only recovery ที่ pin operation นี้ก่อน Final rollout.
PR #253 ต่อมา Squash Merged ที่ `67a82551749569d74b9e4b66a32c82e5715b1d40`
และ exact recovery สำเร็จ: stale-active false, active lock 0, Queue attempt คง 1,
Coverage/Commerce rows คง 0. ก่อน admit operation ใหม่ต้องแก้ Final operator รุ่นเดิมที่จบด้วย
scheduled-active deployment ให้จบด้วย verified all-false `safe-closeout` แทน เพราะ
Integration Workspace authorization ล่าสุดห้ามเปิด Schedule/Cron ตลอด Workstream.
Final operation `woo-final-full-e2372e56d52d` ต่อมาถูก admit ครั้งเดียวและมี partial D1/Lark
writes ก่อน retry ที่ Orders page 2 ล้มด้วย `WOOCOMMERCE_D1_READ_FAILED` บน
`commerce_customer_aggregates`. Live boundary คือ 99 value binds + account bind ผ่าน แต่
100 value binds + account bind รวม 101 เกิน D1 maximum 100 bound parameters. Current correction
ต้อง chunk derived-row value reads เป็น 99 และ resume exact durable operation เดิมเท่านั้น.
Final operator รองรับการ pin `MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID` โดยตรวจ failed sync
code, active durable work, no active lock, partial Business rows และความตรงกันของ work/Queue
generation กับ original requested-at แบบ read-only ก่อน Remote mutation ทุกชนิด.
Queue-attempt evidence ใช้ `main_queue_attempts` เพราะหนึ่ง operation มี durable row เดียว.
WooCommerce Report ต่อผ่าน generic `report.materialization.generate` ด้วย capability `commerce`
และ D1 Commerce source เดิมแล้ว; D1 materialization กับ Lark Snapshot/Metric ใช้ shared runtime,
ส่วน Product/Payment/Shipping เป็น bounded extensible collections. Runtime ยอมให้ Commerce
Report เฉพาะ report-only window ที่ ingestion/full/schedule flags เป็น false.
Guarded Live path ใช้ `scripts/woocommerce-report-runtime-closeout.mjs` เพื่อ reuse Report
finalizer/closeout เดิมใน explicit WooCommerce mode, เปิดเพียง global D1 Report read,
preset materialization และ WooCommerce Report read, พิสูจน์ D1/Lark metric parity กับ
same-job replay แล้วคืน all-false Safe state ใน `finally`.
DLQ incident ของ exact Final operation ปิดได้เฉพาะหลัง Final summary ผ่านครบด้วย
`scripts/woocommerce-dlq-closure-operator.mjs`; operator pin 3 immutable rows, สำรอง D1,
ตรวจ completed full snapshot/zero lock และเปลี่ยนเฉพาะ retained DLQ/recovery metadata โดย
ห้าม Queue redrive/delete หรือ Work/Sync/Coverage/Business/Lark mutation.

## WooCommerce diagnostics deterministic Preview origin — 2026-07-30

Live diagnostics หลัง Queue sentinel fix ยืนยัน Active และ automatic Safe Preview upload สำเร็จ
รวม 2 Version แต่ parser เดิมหยุดด้วย
`WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID` เพราะ Wrangler 4.110.0
structured output ไม่มี URL ใน array shape เดิม. Provider request เป็นศูนย์, Preview URLs และ
workers.dev ถูก restore เป็น disabled, Production deployment/version/traffic คงเดิม และ
Queue/D1/Lark/Schedule/Business mutations เป็นศูนย์.

Hotfix สร้าง origin แบบ deterministic จาก validated alias, Worker name และ account workers.dev
subdomain. Existing Preview URL wrapper อ่าน subdomain ผ่าน Cloudflare account API แบบ GET-only,
ไม่พิมพ์/persist raw identity หรือ auth และส่งต่อเฉพาะ validated label. Wrangler structured
`version-upload` exactly one กับ valid version ID ยังคงเป็น authority; URL เป็น optional
fail-closed cross-check. Command-failed evidence แยก captured file count ออกจาก failures เพื่อ
ไม่รายงาน successful upload หรือ application error เป็น Wrangler failure ปลอม.

Implementation/CI ไม่มี Remote action และไม่อนุญาต Live rerun.

รายละเอียด:

```text
docs/tasks/woocommerce-diagnostics-preview-origin-v1.md
```

## WooCommerce diagnostics Queue sentinel — 2026-07-29

Live diagnostics ยืนยันว่า Cloudflare ปฏิเสธทั้ง Active และ automatic Safe Preview Version
ด้วย `11001 Queue handler is missing` เพราะ Preview-only entrypoint มีเพียง `fetch` ขณะที่
Worker เดียวกันลงทะเบียนเป็น Queue consumer. Safe state ถูก restore แล้ว, Production deployment
คงเดิม และไม่มี Version upload, Provider, Queue, D1, Lark หรือ Schedule action สำเร็จ.

Repository Hotfix เพิ่ม fail-closed `queue(batch)` ที่เรียก `batch.retryAll()` exactly once
โดยไม่ ack, อ่าน message หรือ import Business Queue runtime. Active/Safe config ยังคงไม่มี
Queue/routes/triggers/D1/Production bindings และมีเฉพาะ diagnostics vars/Secret names ที่จำเป็น.
Production entrypoint และ Queue runtime จริงไม่เปลี่ยน. Implementation/CI ไม่มี Remote action
และไม่อนุญาต Live rerun.

รายละเอียด:

```text
docs/tasks/woocommerce-diagnostics-queue-sentinel-v1.md
```

## Lark Dashboard backfill post-apply verification — 2026-07-29

Shared dimensions backfill operator v1.2 แก้ Repository defect ที่เดิม replan เพียงครั้งเดียว
ทันทีหลัง `executeAll()`. Post-apply verification ใหม่สร้าง Planner ใหม่และอ่าน Lark records
ใหม่ทุก attempt ตาม delay `0/1000/2000/4000/8000ms`, จำกัด 5 attempts และ elapsed budget
30000ms โดยไม่มี write retry. ผ่านเมื่อ create/update เป็น zero เท่านั้น; create หรือ persistent
update ยังคง Fail closed.

Diagnostics เปิดเผยเฉพาะ logical table key, pending row count, pending field-name count,
attempt/elapsed และ read strategy. ไม่เปิดเผย physical Table ID, record payload/ID, Business
values หรือ Secret. `TableSyncEngine` expose เฉพาะชื่อ Field ที่ต่างหลัง normalized comparison;
Text, SingleSelect, Number, formatted decimal และ null shape ที่ semantic เท่ากันไม่สร้าง update
ปลอม ขณะที่ observed zero ยังคงต่างจาก null.

Remote cause ของ Incident ยังไม่ยืนยัน: Error เดิมเกิดหลัง write execution และพิสูจน์เพียงว่า
immediate replan ยังเห็น 32 pending. Preview ปกติเป็น read-only recovery mode เพื่อจำแนกว่า
Apply ก่อนหน้า converge แล้ว (`updateRows=0`) หรือยังต้องขอ Apply ใหม่ (`updateRows>0`).
Implementation นี้ไม่มี Remote Lark/D1, Worker, Queue, Schedule, Secret หรือ Production action.

รายละเอียด:

```text
docs/tasks/lark-dashboard-backfill-post-verify-hotfix-v1.md
```

## Lark Dashboard Shared Report dimensions — 2026-07-29

Phase A เพิ่ม Shared dimensions แบบ Additive only ให้ `MKT_Report_Snapshots`,
`MKT_Report_Metric_Values`, `MKT_Report_Top_Content` และ `MKT_Report_Top_Ads`.
Snapshot เพิ่ม `customer_key`, `capability`, `coverage_rate`; อีกสามตารางเพิ่มสอง Field
ดังกล่าวร่วมกับ `period_kind` และ `window_days`. `capability` เป็น Text extensible lowercase
key, `window_days` ใช้ integer formatter และ `coverage_rate` ใช้ `0.0000`.
`baseline_coverage_rate` ยังคงเป็น Organic baseline coverage เดิมและไม่ถูกแทนที่.
Phase A คง legacy Snapshot writer ที่เขียน `payload.coverageRate` ลง Field นี้ทุก Capability
เพื่อไม่ให้ Paid Ads rerun ล้างค่าเดิม; `coverage_rate` ใหม่เป็น Universal shared dimension.
การ reinterpret หรือ cleanup ค่าเก่าต้องเป็น workstream แยก.

Materialization-to-Lark path อ่าน validated `report_materializations` เท่านั้น, ตรวจ Storage
contract/checksum/metadata parity แล้วสร้าง Shared dimension object หนึ่งครั้งสำหรับทุก output
row ผ่าน `TableSyncEngine` เดิม. Stable keys ไม่เปลี่ยน, Custom range คง
`window_days=null`, missing Coverage คง `null` และ observed zero คง `0`. Dashboard Views
เดิมยังกรอง `report_type=dashboard_performance_report` โดยไม่มี Platform/Account/Customer
hardcode.

Focused Phase A tests ผ่าน `7/7`, expanded Dashboard/Report `34/34`, full Node `1406/1406`,
Workers runtime `14/14`, Report reliability `100/100`, dependency audit 0 vulnerabilities และ
Wrangler dry-runs ผ่าน. Schema preview simulation ได้ additive `create_field=18`,
`create_table=0`, `update_field=0`, `conflicts=0`. Draft stacked PR `#237` ยังเปิดและไม่ Merge.
ไม่มี Remote Lark/D1, Worker, Queue, Schedule, Secret หรือ Production action.

รายละเอียด:

```text
docs/tasks/lark-dashboard-shared-dimensions-v1.md
```

## Dashboard rolling-period repository contract — 2026-07-28

Dashboard period identity ใช้ `period_kind=rolling_days|custom_range` ร่วมกับ
`window_days`/inclusive dates; presets คือ 3D, 7D, 9D, 15D, 30D และ 90D โดย 30D
ไม่ใช่ Calendar month. Default end คือ last completed day ตาม Reporting timezone และ
default comparison คือ previous period ที่มีวันเท่ากัน.

Custom ranges claim `report_requests` ด้วย request ID ที่รวม Source watermark ก่อนส่ง
existing Queue/Reliability path และผลลัพธ์เขียน `report_materializations` ด้วย Storage
Foundation Stable key เดิม. Dashboard/Lark ใช้ Materialized results เท่านั้น ไม่ Query
Detailed D1 facts. TikTok Organic ยังคง end-minus-baseline semantics; Ads SUM daily facts
ก่อนคำนวณ ratio. Missing metric เป็น `null`, observed zero เป็น `0`, และ Coverage/data
status ต้องติดผลลัพธ์เสมอ. Repository binding ครอบคลุม Snapshots, Metric Values,
Top Content และ Top Ads; ยังไม่มี Remote Apply หรือ runtime activation.

Lark Settings correction เพิ่ม Canonical `integration_workspace` rows สำหรับ compatibility
1D/7D, rolling 3/7/9/15/30/90D และ Custom โดย `dashboard_performance_report` เป็น Report type
กลางของ Preset ใหม่. `period_kind`/`window_days` ถูกเพิ่มใน Settings และ Snapshot contract.
Guarded reconciliation อนุญาตเฉพาะ exact schema additions/options, Canonical upsert และการ
Disable exact historical developer setting keys หลัง Canonical rows พร้อมแล้ว; ห้าม Delete
เพราะมี Historical Report outputs อ้าง key เดิม. Live Preview พบ active legacy settings 2 แถว,
historical references 27 แถว, expected schema actions 9 และ Remote mutation 0.

Guarded Live reconciliation ผ่านหลัง Branch Verification `#870`: additive/option schema actions
9, Canonical settings created 9, exact legacy settings disabled 2, active legacy settings 0,
historical references retained 27 และ deletes 0. Read-only post-check พบ schema actions 0 และ
Canonical record creates/updates 0/0 (skipped 9). ไม่มี D1, Worker, Queue, Schedule, Secret หรือ
Production action.

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
TikTok route stability Hotfix                 Repository-only implementation in progress
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
Migration 0017                                applied remotely / additive verification passed
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
exact Git provenance, canonical SHA-256 evidence chain, one-message/no-auto-resend และ guarded
all-flags-false restore ที่ no-op บน safe baseline และ block concurrent version. Remote verifier
ตรวจ version/bindings/flags/Secret names/traffic/Queue consumers/Cron/routes/workers.dev จาก
read-only Remote responses โดยไม่ใช้ local config แทนหลักฐาน. Dry-run อนุญาตเฉพาะ Public
YouTube GET, Lark planning GET และ Shared
operational mutations; ห้าม Business/Coverage/checkpoint/Lark write, Analytics และ OAuth refresh.
Warning drain กับ expired-work cleanup ถูกข้ามเฉพาะ Operator path.

PR #101 blocker remediation เพิ่ม terminal completion proof, pre-send empty-operation mode,
dry-run completion replay semantics และ Workers-runtime D1 integrated replay test; ยังไม่มี
Remote action ใดเกิดขึ้น.

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

A later controlled enable attempt exposed a route-stability mismatch: the operator observed
unauthenticated `401`, while the next same-target probe observed `404` before safe-close. Target
fingerprints, pathname, Safe/Audit configuration and deployment ordering matched. The incident is
classified as `ROUTE_PROPAGATION_OR_RUNTIME_INCONSISTENCY`; no authenticated Audit request ran and
the Worker was restored to safe-closed `404`.

The Repository-only branch `hotfix/tiktok-post-lark-audit-route-stability` replaces single route
checks with three consecutive cache-busted/no-cache probes, captures the exact deployed Worker
version from typed Wrangler output, records only sanitized target fingerprints/status/timestamps
and blocks authenticated Audit when enable evidence is stale, incomplete or superseded. It does
not change Audit Business logic and authorizes no Remote action.

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

### Facebook Page-token runtime incident and hotfix

A guarded Facebook D1-only operation reached the Page posts inventory endpoint but was rejected
with sanitized Graph code/subcode `190/2069032`. The operation produced zero Business, Coverage
and Lark rows and the Worker was restored to a verified all-false version at 100% traffic.

The Repository contract already required a distinct Facebook Page credential, while the runtime
source adapter incorrectly reused the discovery/User credential. The hotfix wires
`META_FACEBOOK_PAGE_ACCESS_TOKEN` only to Facebook Page business reads and requires that Secret
name in Facebook D1/Lark rollout preflight. Discovery and Meta Ads remain on `META_ACCESS_TOKEN`.
Detailed evidence:

```text
docs/project-brain/meta-facebook-page-token-runtime-hotfix-2026-07-28.md
```

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

Meta Ads active ingestion contract updated on 2026-08-02:

- one operation accepts at most 31 inclusive days and reads Account plus ad-level Daily Insights;
- Campaign, Ad Set and Ad state is derived only from identities active in that exact range;
- the active path does not enumerate full-history Campaign, Ad Set, Ad or Creative inventories;
- D1 retains validated activity entities and detailed daily facts as the historical authority;
- Lark receives Account and activity entities only, without RAW Ads Daily or MKT Ads Daily detail mirrors;
- Shared checksummed Report materializations provide 1D/3D/7D/30D and Top Ads display data;
- prior full-inventory operation identities are fingerprint-incompatible and remain forensic truth.

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

1. review and separately approve merge of the route-stability Hotfix;
2. separately authorize an all-flags-false Worker deployment containing both reviewed Hotfixes;
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

The live Facebook D1 follow-up on 2026-07-28 proved that Page-token wiring alone was insufficient:
content inventory ignored the reviewed period and account Insights time-window pagination was
mistaken for cursor pagination. The reviewed follow-up is documented in
`docs/project-brain/meta-facebook-page-token-runtime-hotfix-2026-07-28.md`; Remote rerun must use a
new operation only after the hotfix is merged, deployed all-false and preflighted against the exact
active version.

The subsequent content Insights capability probe also removed three Graph-v25-rejected metric
candidates. Only `post_media_view` and `post_total_media_view_unique` are currently accepted for
Facebook content Insights; unsupported engagement metrics remain `null`.

The following Facebook D1 run proved the rerun verifier must use the durable
`main_queue_attempts` counter, not the count of `queue_operation_attempts` rows: `operation_id` is
the primary key, so one same-operation replay updates the existing row. The D1 and Lark operators
retain immutable Business/Coverage/reconciliation checks and permit cross-head closeout only for
an exact-confirmed, clean, ancestor-bound operator-only hotfix. The closeout reuses a prior
hash-valid restore only after remote all-false/version/topology re-verification, without another
Worker deployment.

The first Facebook Lark continuation failed closed at destination preflight because its Canonical
`MKT_Accounts` row contained Provider-specific fields such as `username` that belong to the Shared
RAW contract and are absent from the approved Live Canonical schema. The corrected write-set keeps
those source facts in `RAW_Meta_Organic_Accounts` and D1 account-daily facts while limiting the
Canonical row to existing `MKT_Accounts` fields. No additive Lark schema mutation is required.

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
