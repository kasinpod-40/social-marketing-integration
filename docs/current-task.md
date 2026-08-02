# Current Task — All Meta End-to-End Completion v1

## Status

```text
TASK_STATUS                          = META_ADS_JULY_ACTIVITY_SCOPE_GATES
CURRENT_PROGRAM                      = ALL_META_END_TO_END_COMPLETION_V1
BRANCH                               = integration/all-meta-end-to-end-completion-v1
BASE_MAIN_SHA                        = 0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650
BASE_MAIN_PR                         = #420_MERGED
CHATWOOT_STATUS                      = CLOSED_ACCEPTED_PARTIAL_UAT
CHATWOOT_META_BLOCKER                = NO
META_RETAINED_OPERATION              = meta-facebook-history-20260701-20260731-1d12a5ec4fef
META_RETAINED_D1_PHASE               = COMPLETE_RETAINED_EVIDENCE
META_RETAINED_LARK_PHASE             = COMPLETE_ACCEPTED_PARITY
META_PROVIDER_REPLAY                 = FORBIDDEN_FOR_RETAINED_FACEBOOK_OPERATION
META_D1_QUEUE_RESEND                 = FORBIDDEN_FOR_RETAINED_FACEBOOK_OPERATION
SCHEDULE_WEBHOOK                     = DISABLED_REQUIRED
PRODUCTION                           = BLOCKED
META_LATEST_STOP                     = K2_FULL_INVENTORY_FORENSIC_PAGE_LIMIT_SAFE_ALL_FALSE
NEXT_STEP                            = EXACT_HEAD_CI_THEN_FRESH_K2_JULY
```

## Objective

ปิดงาน Meta ใน Integration Workspace แบบ End-to-End ตั้งแต่ retained Facebook continuation,
Instagram Organic, Meta Ads สองบัญชี, Shared D1/Lark parity, Report materializations และ Lark Native
Dashboard readback แล้วส่งผ่าน Draft PR, exact-head CI, review และ Squash Merge เข้า `main` โดยรักษา
ทุก existing Reliability/Queue/Work/Lock/Coverage/Stable-key guard.

รายละเอียด Scope และ execution contract อยู่ที่:

```text
docs/tasks/all-meta-end-to-end-completion-v1.md
```

## In scope

- ตรวจ latest `origin/main`, open/merged PR, retained local evidence และ Meta Remote state แบบ read-only;
- ทำต่อ retained Facebook July operation จาก D1-complete ไป Lark โดยไม่ Provider replay หรือ D1 resend;
- ทำ Instagram July และ Meta Ads July activity-scoped สำหรับ `chemistry_k2`/`chemistry_k3`
  ผ่าน existing Meta finalizer;
- ตรวจ Coverage, D1/Lark parity, same-operation replay และ all-false restore;
- ใช้ generic Report architecture สำหรับ Facebook Organic, Instagram Organic และ Meta Ads ที่ windows
  `1/3/7/30` เท่าที่ current writer รองรับ;
- ตรวจ Lark Base และ Native Dashboard แบบ Live readback ผ่าน supported compatibility paths;
- อัปเดตเอกสาร, tests, CI, review, Squash Merge และ post-merge read-only verification.

## Out of scope / permanent blocks

- Direct push เข้า `main`;
- Production, Schedule, Cron หรือ Webhook activation;
- direct SQL lifecycle repair หรือ direct-write Business tables;
- replay/replace retained Facebook operation;
- duplicate Connector, Queue, Reliability, D1, Lark หรือ Report engine;
- deletion/rename ของ Business facts หรือ unsupported/speculative Dashboard mutation;
- การนำ WooCommerce Report PR `#415` มาปน เว้นแต่ Shared contract บังคับและมีหลักฐานไม่ชนกัน.
- Chatwoot inspector, recovery, resume, redrive, closeout หรือการเปลี่ยน DLQ 9 / Alert 15.

## Chatwoot accepted closeout boundary

ผู้ใช้ยืนยันและยอมรับ Chatwoot เป็น `CLOSED_ACCEPTED_PARTIAL_UAT` แล้วและไม่ใช่ Meta prerequisite
หรือ blocker:

```text
Worker                              Safe baseline all-false / traffic 100%
Schedule / Webhook                  false / false
Production                          blocked
Active lock                         0
Additional Queue / D1 / Lark writes 0 / 0 / 0
Retained facts                      65 Conversations / 2,071 Messages
Work                                terminal / QUEUE_RETRY_EXHAUSTED
DLQ / Alert                         9 / 15 retained as forensic truth
Success fabrication                 forbidden
```

ห้ามเรียก Chatwoot-specific script เพิ่ม. Meta ใช้เฉพาะ Meta operator preflight เพื่อตรวจ current
Worker all-false; ถ้าพบ drift ให้หยุด Meta และรายงาน drift เท่านั้นโดยไม่เปิด Chatwoot recovery.

## Contract

1. Runtime ต้องคง `MKT_ENV=development` และ `MKT_CUSTOMER_PROFILE=integration_workspace`.
2. Remote mutation เริ่มได้หลัง Meta exact clean/evidence gate, Meta operator Worker all-false,
   Reliability idle, exact mapping และ no-blind-resend checks ผ่าน.
3. Retained Facebook operation ใช้ identity/generation เดิม; Provider replay, D1 Queue resend,
   replacement operation และ lifecycle SQL mutation เป็นศูนย์.
4. ทุก Active window เปิดเฉพาะ required flags และต้อง restore/read back all-false ใน success/failure.
5. D1 เป็น historical authority; Lark write ใช้ existing `TableSyncEngine`; Dashboard อ่าน validated
   materializations และ supported Lark contracts เท่านั้น.
6. Missing/unavailable metric เป็น `null`/N/A; observed zero เท่านั้นที่เป็น `0`.
7. Merge ได้เมื่อ Live closeout, exact-head gates/CI, branch alignment และ unresolved review = 0.
8. Retained Facebook continuation คงใช้ authority
   `scripts/meta-history-2026-exact-plan-continuation-terminal.mjs` ผ่าน reviewed-release wrapper เท่านั้น;
   ห้ามเรียก ordinary terminal เพื่อสร้าง operation ใหม่.
9. Meta Ads รับช่วงข้อมูลไม่เกิน 31 วันและใช้ `report_range_activity`: ดึง Account กับ ad-level Daily
   Insights ก่อน แล้ว derive เฉพาะ Campaign/Ad Set/Ad identity ที่ปรากฏในช่วงนั้น; ห้าม enumerate
   Full-history Campaign/Ad Set/Ad/Creative inventory.
10. Meta Ads D1 เก็บ activity entities และ Daily facts ตามช่วงพร้อม Coverage `report_range`.
    Lark ingestion ไม่ mirror Raw/Daily detailed rows; ส่งเฉพาะ current Account + activity entities.
    Customer-facing 1D/3D/7D/30D และ Top Ads ต้องมาจาก checksummed Report materializations ผ่าน
    Shared Report tables/Native Dashboards.
11. Operation k2 May–July ที่จบด้วย `META_END_TO_END_PAGE_LIMIT` เก็บเป็น forensic failure,
    ห้าม resume, replacement-under-same-identity, ลบ staging หรือปลอมเป็น success. July ต้องเป็น
    fresh operation identity หลัง exact-head CI และ Meta all-false preflight เท่านั้น.

## Meta Ads July data model

```text
Source window                  2026-07-01..2026-07-31 / maximum 31 inclusive days
Source order                   account → ad-level daily insights → complete
Activity entity derivation     unique campaign_id / adset_id / ad_id from July insights
Creative inventory             not fetched; unavailable creative metadata remains null/absent
D1 ads_entity_state            current account + July activity Campaign/Ad Set/Ad
D1 ads_daily_facts             all validated July ad/day/publisher-platform facts
Coverage                       full_inventory only for exact Account; report_range for activity entities/daily
Lark RAW Ads detailed rows     0 for activity-scoped operation
Lark MKT_Ads_Daily             0 for activity-scoped operation
Lark current entities          Account + July activity Campaign/Ad Set/Ad only
Lark report display            Shared Snapshots / Metric Values / Top Ads, windows 1D/3D/7D/30D
Stable keys                    existing platform/account/entity/date/breakdown keys unchanged
Missing metric                 null; observed zero remains 0
Retention/delete               none
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/meta-history-2026-terminal.test.js
node --test tests/application/meta-history-2026-finalizer.test.js
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-reviewed-release-terminal.test.js
node --test tests/application/meta-end-to-end-routing-and-report.test.js
node --test tests/application/multichannel-report-runtime.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Meta End-to-End Verification และ Branch Verification ต้องผ่านบน exact final PR Head พร้อม focused
WooCommerce, Chatwoot และ TikTok regressions ที่ workflow กำหนด.

## Parallel workstream boundary

Open WooCommerce Report PR `#415` owns its ten Commerce-specific files. งานนี้จะไม่แก้ไฟล์เหล่านั้น
จาก PR ดังกล่าวและจะไม่ cherry-pick/merge งานนั้นเข้ามา. Open legacy PR อื่นต้องถูกตรวจซ้ำก่อนแก้
shared documentation หรือ Lark serializer paths.

## Implementation result

เริ่ม branch จาก clean `origin/main@0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650` หลัง PR `#420`
Squash Merged แล้ว. ผู้ใช้ปิด Chatwoot เป็น accepted Partial UAT และห้ามรื้อฟื้น. PR `#415` ยังเปิด
แบบ Draft และ retained Meta evidence อยู่ใน local detached checkout แยกต่างหาก. Public reviewed
Meta wrapper ผ่าน local gate แต่หยุดแบบ fail-closed ที่ read-only Lark preflight ด้วย
`META_LARK_TABLE_MAPPING_DRIFT` สำหรับ `rawMetaOrganicAccounts`; `emergencyRestoreRequired=false`.
รอบนี้ไม่มี Facebook Provider replay, D1 Queue resend, Meta Business write, Worker Active deployment,
Schedule/Webhook หรือ Production mutation.

Root cause ที่ยืนยันจาก Source คือ Lark launcher โหลด current private table mappings แล้ว แต่ runtime
materializer เดิมเขียนเฉพาะ customer identity และ required all-false flags ลง sibling config ทำให้ retained
table mappings ยังเก่าอยู่. Implementation ใน PR #421 จึง materialize Lark mappings ทั้ง 15 ค่าเฉพาะไฟล์
runtime ชั่วคราว พร้อม fail-closed validation; ไม่แก้ retained safe config และไม่เปลี่ยน D1 path.
Reviewed wrapper ยังคง clone immutable release `29de2303fa311c4a13fac4725699416cfdc04386` และ operator
checkout `5ff8e2cfb1f890ac2a8f2867a904b477c6456d91` แต่ pin exact PR branch Head เพื่อใช้เฉพาะ reviewed
Terminal/Lark launcher จาก Head ที่ผ่าน CI; private retained assets ถูกอ่านจาก explicit absolute asset root.

Live exact continuation ผ่าน Lark inventory และส่ง Lark continuation เดิมหนึ่งครั้งโดยไม่มี Provider replay
หรือ D1 resend. Remote Work จบสำเร็จหลัง bounded verifier timeout เล็กน้อยและ cleared phase rows ตาม
`completeWork()` contract; verifier รุ่นเดิมจึงพลาด durable `completion_json`. Automatic all-false restore
ผ่านแล้ว. Hotfix ปัจจุบันเพิ่ม exact cleared-phase completion proof และ late read-only closeout ที่ต้องเห็น
same-operation attempts อย่างน้อยสองครั้ง, exact operation/connector, final reconciliation และ verified
safe restore โดยไม่ resend.
Late proof รอบแรกผ่าน Business parity แต่ summary ปฏิเสธ target fingerprint เพราะ active-version identity
เปลี่ยนหลัง safe restore. Recovery จึง reuse original `expectedActiveVersion` จาก chain เดิมและเก็บ attempt
ที่ target drift เป็น forensic local evidence; ไม่มี Remote mutation หรือ Queue send ในขั้นนี้.

Late proof ล่าสุดผ่านครบและปิด retained Facebook July เป็น accepted D1/Lark parity โดย Provider replay = 0,
Facebook D1 Queue resend = 0 และ Worker restore all-false. Instagram July preflight พบ Worker Secret ที่ขาด
ก่อน mutation; ผูก `META_INSTAGRAM_ACCESS_TOKEN` จาก private local store โดยไม่เปิดเผยค่า แล้ว rerun ผ่าน
preflight/safe/active gates และส่ง exact D1-only operation หนึ่งครั้ง. Queue delivery มาถึงช้าหลัง verifier
timeout และจบเป็น `META_PERMANENT_API_ERROR` ที่ `instagram.account.insights`; Worker restore/readback
all-false ผ่าน, active lock = 0, operation มี D1 Business/Coverage/Lark write = 0 และ retained Meta DLQ/Alert
อย่างละหนึ่งรายการ.

Minimal Live GET reproduction ยืนยัน request เดิมตอบ Graph code 100 เพราะขาด `period`; request เดิมเมื่อเพิ่ม
`period=day` และ `metric_type=total_value` ตอบ 200 พร้อม metrics ทั้งห้ารายการ. Implementation เพิ่ม query
contract นี้ใน Instagram adapter และเพิ่ม terminal-recovery guard ที่ยอม same-operation recovery เฉพาะ exact
failed pre-D1 boundary, ต้องไม่มี lock/Business/Coverage/Lark และต้องเห็น main Queue attempt เพิ่มจริง.

Recovery ด้วย current Worker entry ผ่าน account/content insights ครบ 29 source units แต่ provider ส่ง
`follows_and_unfollows` ที่ unavailable เป็น descriptor ไม่มี `values`/`total_value`; normalizer รุ่นเดิมหยุด
pre-write ด้วย `UNHANDLED_SYNC_ERROR`. Implementation รองรับเฉพาะ descriptor ที่มี identity/period/title/
description ครบเป็น explicit `null` (`response_shape=unavailable`) และยัง fail-closed สำหรับ malformed row.

Same-operation attempt ถัดมาถึง Worker จริงและหยุด pre-write ด้วย
`MKT_ORGANIC_HISTORY_INPUT_INVALID: Organic Daily identity does not match Runtime context`; attempt = 32,
active lock = 0 และ D1 Business/Coverage/Lark rows = 0. Read-only D1 proof ยืนยันว่า Canonical row ใช้ Provider
account ID แต่ D1 Organic history contract ต้องใช้ configured `account_key`. Implementation แยก row identities
ให้ Canonical คง Provider identity และ D1 ใช้ `account_key` โดย OrganicHistoryWriter ยังคง Provider ID ใน
`source_account_id`. Terminal recovery guard ยอม error นี้เฉพาะ exact failed pre-D1 boundary เท่านั้น.

รอบ polling เดิมยังพบว่า OAuth bearer ที่ pin เป็น `CLOUDFLARE_API_TOKEN` หมดอายุระหว่าง bounded verify;
emergency Meta operator restore/readback all-false ผ่านโดยไม่มี Queue resend. Current implementation จึงรักษา
Wrangler OAuth session แบบ refreshable ระหว่าง polling และ resolve bearer ใหม่ทันทีเฉพาะ Queue REST send;
explicit long-lived API token contract ยังคงรองรับเหมือนเดิม. Focused tests ผ่าน 53/53, `npm run check` และ
`git diff --check` ผ่าน; รอ exact-head CI ก่อน same-operation recovery รอบถัดไป.

Exact-head CI ผ่านแล้วทั้ง Branch Verification และ Meta End-to-End Verification. Same-operation attempt 33
ถูก Queue รับ แต่ controller เจอ Wrangler D1 read failure ครั้งแรกแล้ว restore all-false ทันที; durable DLQ
ยืนยัน attempt นี้จบเป็น `META_END_TO_END_GATES_DISABLED` หลัง restore, ไม่มี Business/Coverage/Lark write
และ lock = 0. Controller จึง retry เฉพาะ child-process/network failure ของ read-only polling แบบ bounded;
semantic/contract error ยัง fail closed ทันที และไม่มี blind resend ก่อน attempt 33 settle.

Instagram same-operation recovery ล่าสุดผ่าน D1 และ idempotent rerun ครบ: Organic state 26,
observations 26, account-daily 1, Coverage runs 2/entities 27, invalid Coverage 0 และ Lark phase 0;
rerun ทำให้ main Queue attempts เพิ่มเป็น 35 โดย Business/Coverage counts ไม่เปลี่ยน. Worker restore/readback
all-false ผ่านและ active lock = 0. Remote work เสร็จแล้ว แต่ local summary พบ contract ไม่สอดคล้องกัน:
preflight รองรับ evidence chain ที่เริ่มโดยไม่มี plan แต่ summary บังคับอ่าน `plan.json`. Implementation จึงยอม
เฉพาะ complete planless chain ที่ preflight มี null prior hash, ทุก hash/status ผ่าน และจบด้วย verified
all-false restore; ไม่ต้อง Provider replay, Queue resend หรือ Remote mutation เพิ่ม.

Instagram Lark continuation preflight ผ่าน 15-table inventory และ exact D1 boundary แต่ same-operation attempt
36 หยุดก่อน Lark write ด้วย `LARK_PREFLIGHT_FAILED`: RAW Meta `metric_date` ยังเป็น date-only string ขณะที่
Lark Date field contract ต้องเป็น epoch milliseconds. Active lock = 0, ไม่มี Lark phase write และ Worker
restore/readback all-false ผ่าน. Implementation จึงแปลงเฉพาะ RAW Lark write-set เป็น Bangkok day epoch โดย
ไม่เปลี่ยน source normalizer หรือ D1 date-only contract และทำ polling ให้หยุดทันทีเมื่อ attempt ใหม่เป็น
terminal failed เพื่อ restore โดยไม่รอ bounded timeout เต็ม.

การ retry Lark หลัง failure ต้องตั้ง explicit terminal-recovery และยอมเฉพาะ durable boundary ที่ error เป็น
`LARK_PREFLIGHT_FAILED`, D1 complete, ไม่มี destination-preflight/Lark/completion phase, Coverage valid,
work ยัง active และ lock = 0; error ชนิดอื่นหรือมี partial Lark phase จะ fail closed.

Polling terminal detection ต้องเห็นทั้ง Queue attempt ใหม่และ `finished_at` ใหม่กว่าก่อนส่ง เพื่อไม่ตีความ
failed status เก่าระหว่าง Queue admission กับ Worker เปลี่ยน sync row เป็น running. หาก invocation ยัง running
ให้รอ terminal/read-only ต่อและห้าม restore/deploy ซ้อน.

หลัง stale-status race ส่งผลให้ restore Worker ขณะ Queue invocation เพิ่งเริ่ม, durable Instagram Sync Run
ค้าง `running` โดย attempts คงที่ 38, lock = 0, records written = 0 และยังมีเฉพาะ source-staging/D1 phases;
ไม่มี destination-preflight/Lark/completion phase. Cloudflare กำหนด Queue consumer wall time สูงสุด 15 นาที
จึงยืนยันได้ว่า invocation เดิมสิ้นสุดแล้ว. Recovery guard ใหม่ยอม boundary นี้เฉพาะเมื่อเปิด explicit
Meta orphaned-running recovery, ทั้ง Sync Run และ Queue attempt ไม่มี update เกิน 16 นาที, lock = 0, D1/
Coverage เดิม valid และ snapshot ทุก field คงที่ตลอดอีก 30 วินาที; หาก attempt, phase, count หรือ status
ขยับจะ fail closed. Guard ไม่แก้ durable row, ไม่ replay Provider และใช้ same-operation Lark continuation เดิม.

Fenced continuation ผ่านและเพิ่ม main Queue attempt เป็น 39 แต่หยุดก่อน destination-preflight/Lark write ด้วย
`LARK_PREFLIGHT_FAILED`: internal null descriptor ใช้ `response_shape=unavailable` ซึ่งไม่ใช่ option ของ Shared
RAW Lark contract (`values|total_value|scalar|other`). Worker restore/readback all-false ผ่าน, lock = 0 และ
records written = 0. Implementation map เฉพาะ Lark write-set ของ descriptor นี้เป็น `other`; ค่า metric ยังคง
null และ original descriptor ยังคงอยู่ใน `source_payload_json`, ส่วน internal normalizer ยังรักษา
`unavailable` เพื่อไม่ทำข้อมูลต้นทางสูญหาย.

Attempt 40 ผ่าน RAW metric shape แล้วแต่หยุดก่อน Lark write ที่ canonical `MKT_Accounts.account_type`:
internal Instagram classification เป็น `creator` ขณะที่ Live Shared table รองรับเฉพาะ
`business_account|channel|page|profile`. Read-only Live inventory ยืนยัน records ปัจจุบันใช้ Facebook
`page` และ YouTube `channel`. Implementation จึงรักษา RAW source classification เดิม แต่ map Canonical
Instagram `business -> business_account`, `creator -> profile`, Facebook เป็น `page` และ omit unknown;
ไม่มีการสร้าง Select option หรือเปลี่ยน Live schema.

Attempt 41 ผ่าน account mapping แล้วและหยุดก่อน Lark write ที่ `MKT_Content.content_type=carousel`.
Read-only inventory ของ Select fields ทั้ง 7 Organic destinations ยืนยัน RAW options ตรงกับ source taxonomy
ครบ แต่ Canonical `MKT_Content` ใช้ shared taxonomy `live|post|reel|short|story|video`. Implementation รักษา
RAW type เดิมและ map Canonical `image|carousel|status|link -> post`; `video|reel|story|live` คงค่าเดิม;
unknown/other ถูก omit แทนการปลอม classification. Select field อื่นของ Organic write-set ตรง Live options แล้ว.

Instagram Lark completion ผ่าน 7/7 destinations และ final reconciliation: RAW accounts/content/metrics
`1/26/187`, Canonical account/account-daily/content/content-daily `1/1/26/26`, failed 0, D1/Coverage drift 0
และ Provider request 0. Idempotent verifier เห็น attempt 50 และ completion เดิมจึงผ่านก่อน invocation นั้น
เขียน Sync Run รอบใหม่; restore จึงตัด invocation หลังเริ่มและทำให้ late proof เห็น `running`/lock แทน success.
Implementation แก้ polling ให้ completion หลัง resend ต้องเห็น `finished_at` ใหม่กว่าก่อนส่งด้วย ไม่ใช่เพียง
attempt increment + durable completion เดิม; ห้าม restore จน invocation ใหม่ settle จริง.

Invocation attempt 50 ที่ถูก restore ตัดทิ้ง Sync Run เป็น `running`; automatic attempt 51 ไม่เปลี่ยน
Business/Completion และ lease หมดโดย lock = 0. Closeout จะไม่ mutate Sync Run หรือส่ง Queue เพิ่ม: late proof
ยอม post-completion orphan เฉพาะ exact durable completion/parity เดิม, Sync started หลัง completed_at,
ไม่มี error/lock, latest Sync/Queue activity เกิน Cloudflare 15-minute limit พร้อม margin 1 นาที และ snapshot
ทุก field คงที่อีก 30 วินาที. Evidence บันทึก orphan ตามจริงและไม่ปลอม Sync status เป็น success.
Read-only `verify-late-completion`/`summary` อนุญาต explicit exact-head closeout operator ที่ผ่าน CI
เพื่ออ่าน evidence chain ของ execution Head เดิม; phase อื่นห้าม cross-head และไม่มี Remote mutation.
Instagram late proof ผ่าน post-completion orphan stability 31 วินาทีแล้ว แต่ summary รุ่นเดิมเลือก shortened
chain ทุกครั้งที่มี late proof จึงข้าม full `verify-lark/resend/verify-idempotent` evidence และพบ hash gap.
Summary จะเลือก full chain เมื่อ idempotent evidence มีอยู่ และใช้ shortened chain เฉพาะ late-only recovery
ที่ไม่มี idempotent phase เท่านั้น.

Exact-head CI ของ summary fix ผ่านครบทั้ง Branch Verification และ Meta End-to-End Verification. Instagram
summary ปิดเป็น accepted แล้วด้วย evidence chain 14 phases: Lark parity และ idempotent rerun ผ่าน, Worker
restore/readback all-false, Provider request เพิ่ม 0, Schedule activation 0 และ Remote mutation ใน closeout 0.
ชุดหลักฐาน successful chain ถูกคัดลอกไป asset checkout และตรวจ `diff -qr` ตรงกันทุกไฟล์; failure chains
ก่อนหน้าคงไว้เป็น forensic truth. Instagram July จึงเสร็จและไม่เป็น blocker; ขั้นถัดไปคือ Meta Ads required
May–July สำหรับ `chemistry_k2` และ `chemistry_k3` ผ่าน reviewed wrapper เดิม.

Meta Ads required May–July เริ่ม `chemistry_k2` แล้วหนึ่ง exact Queue send. Source staging คงอยู่ 4 units /
301 rows (`account` 1 และ `campaigns` 300) แต่ closeout OAuth เรียก `whoami` โดยไม่จำเป็นและ automatic
restore เดิมล้มเหลว. Meta D1-only restore authority ถูกเรียกทันทีและ verify Worker all-false ผ่าน; Schedule,
Lark และ Production ยังปิด. Exact operation ปัจจุบันเป็น honest orphan `running`, main attempts 6, lock = 0,
operation-scoped Ads Business rows 0, Coverage runs 0 และ Lark writes 0; ห้ามส่งซ้ำแบบ blind.

Implementation ปัจจุบัน pin reviewed one-command closeout จาก exact PR Head, ข้าม `whoami` เมื่อมี verified
account authority และเพิ่ม Meta D1 orphan guard ที่ต้อง inactivity อย่างน้อย 16 นาทีพร้อม stable snapshot อีก
30 วินาที, lock 0 และ Business/Coverage/Lark 0 ก่อน same-operation recovery. Exact-head CI ผ่านทั้งสอง
workflow ที่ `7e806d37`. จุดนี้เป็น safe account-switch checkpoint; `chemistry_k3` ยังไม่เริ่ม.

Same-operation orphan recovery ผ่าน stable preflight, backup, safe baseline deployment/readback และ D1-only
deployment/readback แล้วส่ง recovery job เดียวโดย `automaticResend=false`; Facebook retained operation ไม่ถูก
แตะ. Bounded verifier ไม่พบ accepted D1 boundary ภายใน 240 polls และจบตามจริงเป็น
`META_D1_ONLY_VERIFY_TIMEOUT` โดยไม่สร้าง summary หรือปลอม success. Failure path deploy safe baseline และ
verify read-back ผ่าน: Worker flags all-false, Lark/Schedule/Production ปิด และ Queue topology ตรง contract.
หลักฐาน active recovery กับ failure chain ก่อนหน้าถูกเก็บแยกกันครบ. ห้ามส่ง k2 ซ้ำจนกว่า read-only durable
diagnosis จะยืนยันสถานะหลัง timeout; `chemistry_k3` ยังไม่เริ่มและไม่ควรเริ่มขณะ k2 ยัง unresolved.

Post-restore exact-key read-only D1 diagnosis ยืนยันว่า recovery ไม่ได้หยุดนิ่ง: source staging เดินต่อจาก
4 units / 301 rows ไปถึง 66 units / 6,406 rows ที่ ads page 22 แต่ staging phase ยัง `complete=0`.
Sync Run ล่าสุดเป็น invocation-level `success` กับ `records_written=0`; durable accepted boundary ยังไม่มี
เพราะ Coverage, operation-scoped Ads entities/daily และ Lark rows ยังเป็นศูนย์, lock = 0. Fixed 240-poll
verifier จบก่อน long-running staging เสร็จ แล้ว continuation หลัง intentional all-false restore ถูกปิดตาม
contract เป็น `META_END_TO_END_GATES_DISABLED` ที่ main attempt 69 และเก็บ open DLQ ตาม forensic truth;
operation-scoped Meta alert ไม่เพิ่ม. รอบถัดไปต้องแก้ verifier ให้ต่ออายุเฉพาะเมื่อ exact staging progress
เดินจริงภายใน hard bound แล้วผ่าน exact-head tests/CI ก่อน guarded same-operation recovery; ห้าม blind resend.

Implementation ปัจจุบันเพิ่ม explicit partial-staging recovery เฉพาะ Meta Ads ซึ่งต้องยืนยัน invocation-level
Sync success แบบ zero-write, source phase incomplete ที่มี durable rows, ไม่มี D1 phase/Coverage/Business/Lark,
lock 0, activity เกิน 16 นาที และ snapshot ทุก field คงที่อีก 30 วินาที. Recovery modes ทั้งสามแบบยัง mutually
exclusive และ target fingerprint แยกกัน. Snapshot SQL อ่านเฉพาะ stage/count/update metadata; ไม่อ่าน cursor,
content identity หรือ raw source payload.

D1 verifier ใช้ base window เดิมและขยายเวลาเฉพาะเมื่อ exact Meta Ads Work ยัง active, Sync ไม่มี error,
ไม่มี Lark/full-completion/invalid Coverage และ source/D1/Sync/Queue activity ยังสดภายใน progress lease.
Extension มี explicit hard poll cap; stale progress, non-Ads target, terminal error หรือ hard cap หยุดแบบ
fail-closed และเข้าสู่ all-false restore เดิม. Focused operator tests ผ่าน 23/23, Meta regressions 26/26,
full `npm test`, Report reliability 101/101, `npm run check`, dependency audit 0 vulnerabilities,
Wrangler deploy dry-run และ `git diff --check` ผ่าน. Repository implementation ยังไม่มี Remote action และ
Worker คง verified all-false; ต้องผ่าน exact-head CI ก่อน recovery operation เดิม.

ผู้ใช้ลด Meta Ads scope เป็น July 2026 เท่านั้นหลังยืนยันว่า Full-history inventory ใหญ่เกินความจำเป็นและ
พื้นที่ Lark ไม่เหมาะกับ detailed mirror ของทั้ง `chemistry_k2`/`chemistry_k3`. Operation เดิม
`meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba` จบตามจริงด้วย
`META_END_TO_END_PAGE_LIMIT` ที่ Ads page 101, source staging 145 units / 14,306 rows, main attempts 149,
lock 0, operation Business/Coverage/Lark writes 0 และ Worker restore all-false. หลักฐานนี้เป็น forensic
failure เท่านั้น; ห้าม resume, ลบ, redrive หรือเปลี่ยนเป็น success.

Implementation ใหม่เปลี่ยน active Meta Ads source plan เป็น `account → ad-level daily → complete`, จำกัด
ช่วงไม่เกิน 31 วัน และ derive Campaign/Ad Set/Ad เฉพาะ identity ที่ปรากฏใน Daily Insights ของช่วงนั้นโดย
ไม่ enumerate Campaign/AdSet/Ad/Creative inventory. D1 คง July activity entities และ detailed daily facts;
Lark รับ Account + activity entities แต่ไม่รับ RAW Ads Daily หรือ MKT Ads Daily detailed rows. Coverage
แยก Account แบบ `full_inventory` กับ activity entities/daily แบบ exact `report_range`; customer-facing
1D/3D/7D/30D และ Top Ads ใช้ Shared checksummed report materializations. Operation fingerprint schema ใหม่
ทำให้ operation full-inventory เก่าใช้ต่อกับ runtime นี้ไม่ได้แบบ fail-closed.

Local verification ปัจจุบันผ่าน focused Meta 37/37, Meta regression 198/198, `npm run check`, full unit
2024/2024 และ Workers-runtime 16/16; ไม่มี Provider, Queue, D1, Lark, deploy, Schedule หรือ Production
mutation ในการเปลี่ยนนี้. ขั้นต่อไปคือ Gate ที่เหลือ, exact-head CI แล้วจึงเริ่ม fresh k2 July operation
หลัง Meta operator ยืนยัน Worker all-false เท่านั้น; k3 ยังไม่เริ่ม.
