# Current Task — Multichannel Runtime & Schedule LIVE Activation Final Closure v1

## Status

```text
TASK_STATUS                         = DASHBOARD_READY_YOUTUBE_ANALYTICS_CHATWOOT_BLOCKERS
CURRENT_PROGRAM                     = MULTICHANNEL_RUNTIME_SCHEDULE_LIVE_ACTIVATION_V1
BRANCH                              = codex/google-ads-live-schedule-closeout
EXACT_BASE                          = 99c88691db1237c9a08dff6922d1836486f3772d
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
3. Instagram previous-day catch-up ไม่ส่งช่วงวันที่ผ่าน orchestration/source collector ไปยัง adapter จึงขยายเป็น full-account inventory 1,857 รายการแทน 1 วัน.
4. Meta staged-unit reader ส่ง total ceiling 2,500 เป็น D1 page limit ครั้งเดียว ทั้งที่ store รับได้สูงสุด 500; แก้เป็น bounded pagination 500 + remainder.
5. Paid Ads Report 8 jobs แรกขาด ignored runtime binding `LARK_TABLE_MKT_REPORT_TOP_ADS`; live schema preview ยืนยัน table เดิมโดยไม่มี schema action แล้วเพิ่มเฉพาะ binding ก่อนส่ง operation IDs ใหม่.

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
STATUS                              = DASHBOARD_READY_YOUTUBE_ANALYTICS_CHATWOOT_BLOCKERS_REMAIN
LARK_PLATFORM_OPTIONS               = ADDITIVE_FIX_APPLIED_AND_READ_BACK
RELIABILITY_OUTBOX_PENDING          = 0
RELIABILITY_MIRROR_NEW_FAILURES     = 0_AFTER_TWO_PRIMARY_CRON_INTERVALS
QUEUE_TERMINALIZATION_FIX           = MERGED_PR_580_AND_DEPLOYED
META_SOURCE_UNIT_CAPACITY_HOTFIX    = IMPLEMENTED_BOUNDED_2500_DEFAULT_UNCHANGED
INSTAGRAM_INVENTORY_PERIOD_HOTFIX   = IMPLEMENTED_EXISTING_DATE_RANGE_CONTRACT
META_STAGED_UNIT_PAGINATION_HOTFIX  = IMPLEMENTED_D1_PAGE_CAP_500
FOCUSED_REGRESSION                  = PASS_21_OF_21
FULL_UNIT_TESTS                     = PASS_2900
WORKERS_RUNTIME_TESTS               = PASS_18
REPORT_RELIABILITY_TESTS            = PASS_105
ARCHITECTURE_HYGIENE                = PASS
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS
SAFE_CONFIG_RECONCILIATION          = COMPLETE_LOCAL_IGNORED_CONFIG
API_ACTIVE_VERSION                  = 4166852d-c8bb-438a-9ab4-ffeec9520a7f
SYNC_ACTIVE_VERSION                 = 04dc61e2-1f6a-4c79-9226-6dedbbec9593
REMOTE_ACTIVATION                   = SOURCE_AND_REPORT_SCHEDULES_ON
SOURCE_CATCH_UP_COMPLETE            = TIKTOK_FACEBOOK_INSTAGRAM_YOUTUBE_PUBLIC_META_ADS_GOOGLE_ADS_WOOCOMMERCE
SOURCE_CATCH_UP_BLOCKED             = YOUTUBE_ANALYTICS_CHATWOOT
INSTAGRAM_CATCH_UP                  = R3_PASS_D1_LARK_RECONCILIATION_FAILED_0
DAILY_REPORT_MATERIALIZATION        = PASS_32_OF_32_D1_AND_LARK
LARK_REPORT_READBACK                = SNAPSHOTS_32_METRICS_1236_TOP_CONTENT_80_TOP_ADS_40
REPORT_DATA_STATUS                  = COMPLETE_17_PARTIAL_3_REVISABLE_12
ACTIVE_NONEXPIRED_LOCKS             = 0
ACTIVE_WORK                         = PROTECTED_META_ADS_FORENSIC_HISTORY_ONLY
GOOGLE_ADS_FRESH_LIVE_RUN           = PASS_609cc147_7_OF_7_CHUNKS_1335_OF_1335_ROWS
GOOGLE_ADS_RECONCILIATION           = PASS_6_DATASETS_FAILED_ROWS_0
GOOGLE_ADS_D1_LARK_PARITY           = PASS_ENTITIES_1105_DAILY_390
GOOGLE_ADS_REPORT_R3                = PASS_4_OF_4_FRESH_WATERMARK
GOOGLE_ADS_PROVIDER_SCHEDULE        = PASS_DAILY_0600_0700_PROVIDER_LOCAL_TIME
NOTIFICATION_RUNTIME                = BLOCKED_OFF
AUTOMATIC_WEEKLY_NOTIFICATION       = BLOCKED_OFF
DLQ_REDRIVE                         = BLOCKED_OFF
PRODUCTION                          = BLOCKED
```

Hotfix นี้ขยายเฉพาะ hard maximum ของ `MKT_META_SOURCE_MAX_UNITS` จาก 500 เป็น 2,500 โดยคง default ที่ 500 และคงขอบเขต rows/bytes เดิม เพื่อให้ Instagram inventory 1,857 รายการเดินต่อแบบ resumable ได้โดยไม่เปลี่ยน retry, idempotency หรือ write semantics.

Live progress หลัง deploy ยืนยันว่าช่วงวันที่ของ Instagram หลุดหายสองชั้นก่อนถึง adapter ทำให้ previous-day catch-up กลายเป็น full-account inventory 1,857 รายการ ทั้งที่ adapter มี newest-first bounded date-range contract อยู่แล้ว; hotfix จึงส่ง `periodStart`/`periodEnd` ผ่าน orchestration และ source collector เดิม โดยไม่เปลี่ยน Provider query schema หรือ write semantics.

Instagram R2 ยืนยันว่า period-bound contract ถูกใช้แล้ว แต่พบว่า source ceiling 2,500 ถูกส่งเป็น `listPhaseUnits.limit` ครั้งเดียว ขัดกับ D1 store page cap 500; hotfix จึงอ่าน staged units แบบหลายหน้าไม่เกิน 500 และ fail closed เมื่อ cursor ไม่เดินหรือจำนวน units ไม่ครบ.

Instagram R3 สำเร็จด้วย 1 content, 7 insight rows, D1 3/3 operations, Lark 7/7 tables, warning 0 และ reconciliation `failed=0`. Daily materialization มี D1/Lark snapshots ครบ 32 identities สำหรับ 8 platforms × `1D/3D/7D/30D`; Lark stable-key duplicate เป็นศูนย์ทุก Report table. Paid Ads predecessor DLQ 8 รายการถูกเก็บเป็นหลักฐานและ recovery ใช้ operation IDs `-r2` ใหม่โดยไม่ redrive.

Google Ads fresh LIVE ใช้ run ใหม่ `609cc147-809b-404a-a484-dcbb82c12a6f` โดยไม่ replay historical run ที่ถูกป้องกันไว้: signed delivery รับ 7/7 chunks และ 1,335/1,335 rows, admission `completed` ด้วย send attempt เดียว, reconciliation ครบ 6 datasets และ `failed_rows=0`. D1/Lark readback ตรงกันที่ Ads entities 1,105 และ Daily facts 390; Google Ads report R3 ทั้ง `1D/3D/7D/30D` มี coverage 1 และ fresh source watermark เดียวกัน. Google Ads Manager Script UI ยืนยัน script หลัก Enabled และ Provider frequency `Daily between 6:00 AM and 7:00 AM`; PREVIEW script ไม่มี schedule จึงไม่เกิด duplicate provider producer.

External blockers ที่ยังทำให้ห้ามประกาศ `MULTICHANNEL_RUNTIME_SCHEDULE_LIVE_PASS` เหลือสองรายการ: YouTube Analytics OAuth owner ไม่ตรง configured channel และ Chatwoot pagination เปลี่ยนระหว่าง continuation. Public YouTube, Google Ads fresh LIVE, existing report coverage และ Dashboard materialization พร้อมตรวจ; Production/Notification/DLQ redrive ยังปิด.

## Downstream Weekly Executive Decision Preview blocker — 2026-08-10

Fresh period `2026-08-03..2026-08-09` ถูกเลือกได้หลัง Daily materialization 32/32 แล้ว แต่ Fresh Executive Decision Preview หยุดก่อน mutation ด้วย `LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED`: AI metric-summary มี 8,435 characters เทียบเพดานที่ review แล้ว 8,000. รอบนี้มี `recordWriteCount=0`, `triggerWriteCount=0`, Queue/Notification/Schedule action = 0 และ Production ยัง BLOCKED.

Root cause แรกอยู่ที่ AI evidence serializer ซึ่ง serialize rank-1 candidate ซ้ำ: candidate เดียวกันอยู่ใน `contentCandidates`/`adCandidates` แล้วแต่ถูกใส่ซ้ำเป็น `topContent`/`topAds` ใน payload เดียวกัน. Hotfix PR #586 ลบเฉพาะ AI-side duplicate aliases โดยคง 3 Content + 3 Ads candidates, business facts, Decision Quality Gate และเพดาน 8,000 ไว้เหมือนเดิม. Historical factual aliases และ Historical Weekly delivery ไม่ถูกแก้หรือ rerun.

หลัง PR #586 merge การ rerun เดิมลด payload จาก 8,435 เป็น 8,220 characters แต่ยังเกินเพดาน 8,000 และยังหยุดก่อน mutation (`recordWriteCount=0`, `triggerWriteCount=0`). Root cause ชั้นที่สองคือ ranked `contentCandidates`/`adCandidates` ถูก serialize ครบอยู่แล้วใน `channelBusinessEvidence` แต่ยังถูก flatten ซ้ำทั้ง collection ภายใต้ `decisionEvidence`.

Hotfix PR #587 ลบเฉพาะ duplicate candidate collections จาก `decisionEvidence`; candidate facts สูงสุด 3 Content + 3 Ads ต่อ channel ยังคงอยู่ใน `channelBusinessEvidence`, ส่วน `scaleEvidenceAdNames`, `funnelDivergences`, `organicPaidMappingAvailable`, candidate-name validation, Decision Quality Gate และ `MAX_METRIC_SUMMARY_CHARS=8000` คงเดิม. ไม่มี Remote action ใน implementation นี้ และ Fresh Preview จะรันใหม่ได้หนึ่งครั้งหลัง #587 merge เพราะ live attempt ล่าสุดไม่มี record/trigger mutation.
