# Current Task — Multichannel Runtime & Schedule LIVE Activation Final Closure v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = MULTICHANNEL_RUNTIME_SCHEDULE_LIVE_ACTIVATION_V1
BRANCH                              = codex/multichannel-runtime-schedule-live-activation-v1
EXACT_BASE                          = e2e038b8214a472c3ea38876afbbadfa9329e5bd
INTEGRATION_WORKSPACE               = AUTHORIZED
PRODUCTION                          = BLOCKED
NOTIFICATION_RUNTIME                = BLOCKED_OFF
AUTOMATIC_WEEKLY_NOTIFICATION       = BLOCKED_OFF
DLQ_REDRIVE                         = BLOCKED_OFF
```

## Objective

เปิด Source runtime และ schedules ของ Integration Workspace ทุกช่องทางที่อนุมัติ เปิด Daily/Weekly Shared Report schedules ทำ fresh previous-completed-day catch-up และ materialize 1D/3D/7D/30D ให้ Dashboard พร้อมตรวจ โดยรักษา Notification runtime, automatic weekly notification, DLQ redrive และ Production เป็น OFF/BLOCKED

## In scope

- แก้ active reliability-mirror root cause และพิสูจน์ว่าไม่มี failure ใหม่อย่างน้อยสอง primary cron intervals;
- reconcile ignored real Wrangler configs โดยคง real bindings, IDs, routes, mappings และ Secrets;
- deploy safe all-false baseline ก่อนเปิด exact steady-state gates;
- เปิด TikTok, Facebook, Instagram, YouTube, Meta Ads, Google Ads, WooCommerce และ Chatwoot source schedules;
- restore Google Ads clean Manager Script, ทำ fresh LIVE หนึ่งครั้ง และเปิด Provider Daily Frequency;
- เปิด Daily Shared Report 08:10 Asia/Bangkok และ Weekly Shared Report Monday 08:15;
- ทำ fresh controlled catch-up สำหรับ previous completed day และ materialize รายงาน 32 jobs;
- ทำ remote readback จน Dashboard พร้อมตรวจ.

## Locked out of scope

- Production ทุกชนิด;
- Notification runtime, automatic weekly notification และ Base Notification Automation;
- DLQ bulk redrive หรือการทำ historical counts ให้ดูสะอาด;
- replay/resend Facebook `meta-facebook-daily-20260808-r2`;
- replay Google Ads historical run `88351cb4-714d-49ef-91db-d95550a93ebf`;
- replay historical Weekly Notification;
- rerun `display_value` migration/backfill หรือแก้ `current_value`;
- merge/rewrite/แก้ PR #579;
- เปลี่ยน Dashboard configuration.

## Root causes confirmed

1. Reliability mirror outbox เขียน Lark `MKT_Sync_Log.platform` ค่า `woocommerce` และ `chatwoot` ไม่ได้ เพราะ Single Select ขาดสอง options นี้ ทำให้ outbox ค้างและเกิด mirror DLQ ใหม่ทุก primary cron.
2. Queue terminalization เรียก shared `abandonWork` เฉพาะ YouTube/TikTok/Chatwoot ทำให้ stable resumable Facebook/Instagram/Meta Ads/Google Ads/WooCommerce permanent failures ถูก acknowledge แต่ Work ยัง `active`.

## Contract

- เพิ่ม Lark select options แบบ additive เท่านั้นและตรวจ exact readback;
- ขยาย existing Queue terminalization path เท่านั้น ไม่สร้าง reliability/lifecycle engine ใหม่;
- stable identity และ queue-safe completed-work guard ต้องคงเดิม;
- retained Meta Ads forensic work `meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba` ต้องไม่ถูก replay/terminalize/cleanup;
- Facebook R1 failed work ปิดเฉพาะ exact identity หลังพิสูจน์ว่า R2 generation ใหม่กว่าสำเร็จแล้ว โดยไม่ replay R1/R2;
- activation flags ต้อง derive จาก current code/tests และ deploy ตาม safe-baseline → active sequencing;
- missing metric ต้องคง null/N/A และทุก catch-up ใช้ operation IDs ใหม่.

## Acceptance criteria

- reliability outbox pending = 0 และ mirror DLQ ไม่มีรายการใหม่ในหน้าต่างอย่างน้อย 10 นาที;
- active non-expired locks = 0 และไม่มี conflicting queue work ยกเว้น documented retained forensic evidence;
- exact Queue producers/consumers และ D1/Queue bindings ไม่ drift;
- tracked fix ผ่าน focused tests, `npm run check`, `npm test`, report reliability, audit และ deploy dry-run;
- Draft PR ผ่าน exact-head CI, merge และ post-merge CI ก่อน Worker activation;
- API/Sync safe baseline และ active versions read back ได้;
- Source schedules 8 ช่องทาง ON โดย Google Ads เป็น Provider schedule และไม่มี duplicate Cloudflare producer;
- Google Ads fresh LIVE run ใช้ UUID ใหม่, 6 datasets, all chunks admitted, D1/Lark parity และ reconciliation PASS;
- Daily/Weekly report schedules ON ตามเวลาที่กำหนด;
- fresh previous-completed-day sources และ 32 daily materializations PASS;
- notification runtime/automatic weekly notification/DLQ redrive OFF และ Production BLOCKED;
- Dashboard พร้อมตรวจโดยไม่เปลี่ยน Dashboard configuration.

## Required tests

```text
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Implementation result

```text
STATUS                              = IN_PROGRESS
LARK_PLATFORM_OPTIONS               = ADDITIVE_FIX_APPLIED_AND_READ_BACK
RELIABILITY_OUTBOX_PENDING          = 0
QUEUE_TERMINALIZATION_FIX           = IMPLEMENTED_LOCAL_GATES_PASS
FOCUSED_REGRESSION                  = PASS_24_OF_24
FULL_UNIT_TESTS                     = PASS_2887
WORKERS_RUNTIME_TESTS               = PASS_18
REPORT_RELIABILITY_TESTS            = PASS_105
ARCHITECTURE_HYGIENE                = PASS
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS
SAFE_CONFIG_RECONCILIATION          = COMPLETE_LOCAL_IGNORED_CONFIG
REMOTE_ACTIVATION                   = NOT_STARTED
PRODUCTION                          = BLOCKED
```
