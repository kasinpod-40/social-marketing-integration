# Current Task — Multichannel Runtime & Schedule LIVE Activation Final Closure v1

## Status

```text
TASK_STATUS                         = DASHBOARD_READY_YOUTUBE_ANALYTICS_LIVE_VALIDATION_CHATWOOT_BLOCKERS
CURRENT_PROGRAM                     = MULTICHANNEL_RUNTIME_SCHEDULE_LIVE_ACTIVATION_V1
BRANCH                              = codex/youtube-owner-preflight-invalid-grant-record
EXACT_BASE                          = f07626f68f3d9f15a444250636fada0443b42047
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
FULL_UNIT_TESTS                     = PASS_2910
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
SOURCE_CATCH_UP_BLOCKED             = YOUTUBE_ANALYTICS_LIVE_VALIDATION_CHATWOOT
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

Blockers ที่ยังทำให้ห้ามประกาศ `MULTICHANNEL_RUNTIME_SCHEDULE_LIVE_PASS` เหลือสองรายการ:
YouTube Analytics customer-credential runtime bridge แก้ใน Repository, merge และ reviewed deploy แล้ว;
Owner preflight ไปถึง Google token endpoint แต่ถูกปฏิเสธด้วย sanitized OAuth `invalid_grant` ก่อน
Provider read/Business write จึงยังไม่ส่ง Analytics catch-up. Chatwoot pagination ยังเปลี่ยนระหว่าง continuation.
Public YouTube, Google Ads fresh LIVE, existing report coverage และ Dashboard materialization พร้อมตรวจ;
Production/Notification/DLQ redrive ยังปิด.

## Downstream Weekly Executive Decision Preview blocker — 2026-08-10

Fresh period `2026-08-03..2026-08-09` ถูกเลือกได้หลัง Daily materialization 32/32 แล้ว แต่ Fresh Executive Decision Preview หยุดก่อน mutation ด้วย `LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED`: AI metric-summary มี 8,435 characters เทียบเพดานที่ review แล้ว 8,000. รอบนี้มี `recordWriteCount=0`, `triggerWriteCount=0`, Queue/Notification/Schedule action = 0 และ Production ยัง BLOCKED.

Root cause แรกอยู่ที่ AI evidence serializer ซึ่ง serialize rank-1 candidate ซ้ำ: candidate เดียวกันอยู่ใน `contentCandidates`/`adCandidates` แล้วแต่ถูกใส่ซ้ำเป็น `topContent`/`topAds` ใน payload เดียวกัน. Hotfix PR #586 ลบเฉพาะ AI-side duplicate aliases โดยคง 3 Content + 3 Ads candidates, business facts, Decision Quality Gate และเพดาน 8,000 ไว้เหมือนเดิม. Historical factual aliases และ Historical Weekly delivery ไม่ถูกแก้หรือ rerun.

หลัง PR #586 merge การ rerun เดิมลด payload จาก 8,435 เป็น 8,220 characters แต่ยังเกินเพดาน 8,000 และยังหยุดก่อน mutation (`recordWriteCount=0`, `triggerWriteCount=0`). Root cause ชั้นที่สองคือ ranked `contentCandidates`/`adCandidates` ถูก serialize ครบอยู่แล้วใน `channelBusinessEvidence` แต่ยังถูก flatten ซ้ำทั้ง collection ภายใต้ `decisionEvidence`.

Hotfix PR #587 ลบเฉพาะ duplicate candidate collections จาก `decisionEvidence`; candidate facts สูงสุด 3 Content + 3 Ads ต่อ channel ยังคงอยู่ใน `channelBusinessEvidence`, ส่วน `scaleEvidenceAdNames`, `funnelDivergences`, `organicPaidMappingAvailable`, candidate-name validation, Decision Quality Gate และ `MAX_METRIC_SUMMARY_CHARS=8000` คงเดิม. ไม่มี Remote action ใน implementation นี้ และ Fresh Preview จะรันใหม่ได้หนึ่งครั้งหลัง #587 merge เพราะ live attempt ล่าสุดไม่มี record/trigger mutation.

## YouTube Customer OAuth runtime credential-path incident — 2026-08-10

### Incident status before correction

```text
INCIDENT                            = YOUTUBE_CUSTOMER_OAUTH_RUNTIME_CREDENTIAL_PATH_REGRESSION_AND_STALE_TOKEN
CUSTOMER_CONNECTION                = CONNECTED_VALIDATED_METADATA
ACTIVE_ENCRYPTED_REFRESH_REFERENCE = PRESENT_AND_MATCHED_BUT_PROVIDER_REJECTED
CUSTOMER_RECONNECT_REQUIRED        = YES_AFTER_OAUTH_APP_READINESS
PUBLIC_YOUTUBE_SYNC                = PASS
OWNER_ANALYTICS                    = BLOCKED
REPOSITORY_FIX                     = MERGED_PR_593
REMOTE_DEPLOYMENT                  = PASS_VERSION_25f835d9
LIVE_ANALYTICS_REVALIDATION        = FAILED_CLOSED_INVALID_GRANT
```

### Diagnostic correction record

คำอธิบายก่อนหน้าที่สรุปว่า OAuth owner ของลูกค้าไม่ตรง Channel และเสนอให้ลูกค้า Connect ใหม่
เป็นการวินิจฉัยที่ไม่ครบและทำให้โยนภาระไปที่ลูกค้าผิดจุด. Read-only D1 audit ยืนยันว่า Customer
Connection ยังเป็น `connected/validated`, `credential_reference` ตรงกับ active encrypted
Refresh Token และก่อน reviewed deploy ไม่มี recorded refresh failure. Source inspection ยืนยันว่า YouTube ingestion
สร้าง Owner client จาก legacy `YOUTUBE_OAUTH_*` environment path โดยไม่อ่าน Customer
Connection/credential reference ที่ callback บันทึกไว้.

ผลรัน `organic_end_to_end` ที่สำเร็จหลัง identity mismatch มี
`analyticsCompletenessStatus=not_enabled`, tracked/queried/rows เป็นศูนย์ จึงพิสูจน์เฉพาะ Public
YouTube path ไม่ใช่ Owner Analytics success. ห้ามใช้ success เหล่านั้นประกาศปิด Analytics blocker.

### Objective and scope

- ใช้ active encrypted YouTube Customer Connection จาก D1 เป็น Owner Analytics credential source;
- reuse Shared Google OAuth refresh provider, encrypted credential repository และ YouTube API client;
- ตรวจ customer, connector, scopes, connection/access status, active credential reference และ configured Channel แบบ fail-closed ก่อน Provider request;
- เมื่อ Analytics เปิด ห้าม fallback ไป legacy static access/refresh token;
- Public Data API, dry-run/Lark-UAT public-only paths, D1-first writes, pagination, retry, stable keys และ Lark reconciliation ต้องคง contract เดิม;
- ไม่สร้าง invitation ใหม่ ไม่ขอ customer consent ใหม่ ไม่ rotate/delete Secret และไม่ Deploy จาก implementation scope นี้.

### Acceptance criteria

- Analytics-enabled runtime สร้าง Owner client จาก encrypted Customer Connection เท่านั้น;
- missing/invalid connection, scope, active credential หรือ Channel mapping หยุดก่อน Analytics request ด้วย sanitized permanent error;
- legacy `YOUTUBE_OAUTH_*` values ไม่ถูกอ่านเป็น fallback เมื่อ Analytics เปิด;
- Analytics-disabled และ operator public-only behavior ไม่เปลี่ยน;
- focused customer-connection/runtime/routing tests, `npm run check`, full tests, report reliability,
  audit, deploy dry-run และ `git diff --check` ผ่าน;
- หลัง implementation ต้องอัปเดตหัวข้อนี้และ Project Brain แยก `REPOSITORY_FIXED` ออกจาก
  `LIVE_VALIDATED`; ห้ามบันทึกว่า Live แก้แล้วก่อน reviewed deploy และ controlled Analytics run ผ่าน.

### Implementation and reviewed-live result

```text
STATUS                            = REPOSITORY_FIXED_DEPLOYED_LIVE_TOKEN_REJECTED
REPOSITORY_FIXED                  = YES
LIVE_VALIDATED                    = NO
CUSTOMER_ACTION                   = CONFIRM_PUBLISH_APP_THEN_RECONNECT_ONCE
CUSTOMER_RECONNECT_REQUIRED       = YES_AFTER_APP_READINESS
OWNER_CREDENTIAL_SOURCE           = ENCRYPTED_CUSTOMER_CONNECTION_D1
LEGACY_OWNER_OAUTH_FALLBACK       = PROHIBITED_WHEN_ANALYTICS_ENABLED
FOCUSED_REGRESSION                = PASS
FULL_UNIT_TESTS                   = PASS_2910
WORKERS_RUNTIME_TESTS             = PASS_18_OF_18
REPORT_RELIABILITY_TESTS          = PASS_105_OF_105
ARCHITECTURE_HYGIENE              = PASS_749_FILES_0_CYCLES
DEPENDENCY_AUDIT                  = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                    = PASS
DIFF_CHECK                        = PASS
MERGED_PR                         = 593
MERGED_SHA                        = f07626f68f3d9f15a444250636fada0443b42047
REMOTE_DEPLOYMENT                 = PASS_VERSION_25f835d9_81e3_4acb_b62e_a678fd4c90fc
LIVE_OWNER_PREFLIGHT_R1           = SAFE_REJECT_METRIC_DATE_GENERATION_MISMATCH_WRITES_0
LIVE_OWNER_PREFLIGHT_R2           = FAILED_GOOGLE_OAUTH_INVALID_GRANT_READS_0_WRITES_0
LIVE_ANALYTICS_CATCH_UP           = NOT_SENT_FAIL_CLOSED
GOOGLE_CLOUD_OWNER_CONSOLE        = PASS_2SV_EXTERNAL_TESTING_CONFIRMED
SECONDARY_CONSOLE_SESSION         = INSUFFICIENT_PROJECT_PERMISSION
PRODUCTION_NOTIFICATION_DLQ       = UNCHANGED_BLOCKED_OFF
```

Runtime routes ทั้ง dedicated และ compatibility path ใช้ `createYouTubeRuntimeClients` ร่วมกัน.
เมื่อ Analytics เปิด Factory จะอ่าน exact YouTube Customer Connection จาก D1, ตรวจ
`connected/validated`, approved scopes, active encrypted credential reference และ configured Channel
ก่อนสร้าง Owner client ผ่าน shared Google refresh provider. Access Token อยู่ใน memory เท่านั้น;
Public/API-key และ operator dry-run paths คงเดิม. การแก้ครั้งนี้ไม่ได้สร้าง invitation, ไม่ rotate/delete
Secret และไม่ mutate Production.

Reviewed deploy เปิด merged SHA บน Integration Workspace เป็น Worker version
`25f835d9-81e3-4acb-b62e-a678fd4c90fc` ที่ 100%. Preflight R1 ถูก generation fence ปฏิเสธอย่าง
ปลอดภัยเพราะ controller ใช้ metric date ผิดวันและไม่มี Business write; R2 แก้ identity ใหม่แล้วไปถึง
Google token endpoint แต่ refresh ถูกปฏิเสธด้วย `invalid_grant`, Provider reads/writes เป็นศูนย์.
จึงไม่ส่ง catch-up และไม่ redrive/retry อัตโนมัติ.

สถานะ D1 `connected/validated` พิสูจน์เฉพาะ metadata/reference consistency ไม่ได้พิสูจน์ว่า token ยัง
ใช้กับ Provider ได้. หลังเปิด 2-Step Verification แล้ว Google Cloud readback ยืนยัน exact OAuth client
ตรงกับ client ที่ callback ใช้ และ app เป็น `External / Testing`. ต้องเปลี่ยน publishing posture ที่ได้รับ
อนุมัติก่อน แล้วค่อยให้ owner reconnect หนึ่งครั้งเพื่อออก refresh token ใหม่. ห้ามส่งลิงก์ consent ใหม่
ก่อนปิด app-readiness gate และยังคง `LIVE_VALIDATED=NO` จน Owner preflight กับ controlled Analytics
catch-up/reconciliation ผ่านจริง.
