# Current Task — Multichannel Runtime & Schedule LIVE Activation Final Closure v1

## Status

```text
TASK_STATUS                         = DASHBOARD_READY_YOUTUBE_ANALYTICS_LIVE_VALIDATION_CHATWOOT_BLOCKERS
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
6. Chatwoot Conversations list เป็น mutable offset pagination ไม่มี snapshot cursor; durable continuation
   เดิมยึด page-order fingerprint จึง fail เมื่อรายการเลื่อนระหว่าง invocation.
7. Controlled Chatwoot `r5` ใช้ manual daily trigger ขณะที่ steady-state schedule flag เปิดอยู่ จึงถูก
   fail-closed ก่อนสร้าง Work/Provider/D1/Lark business mutation; `r6` ใช้ scheduled trigger ที่ตรง config.
8. Live Provider metadata มี 7,720 conversations สูงกว่า ignored active bound 5,000; ขยายเฉพาะ
   `CHATWOOT_API_MAX_ROWS` และ `CHATWOOT_MAX_CONVERSATIONS` เป็น bounded 10,000 ก่อนชน limit.
9. Live `r6` จบ discovery pass แรกที่ 7,720 IDs แล้วพบ ID ใหม่หลัง immutable cutoff ทันทีใน pass 2;
   stable-ID fix เดิมนับ post-boundary creation เป็น convergence progress แม้ไม่เลือกเขียน จึงอาจวน
   verification ไม่จบในบัญชีที่มีแชทใหม่ต่อเนื่อง. แก้ให้เก็บ ID เพื่อ dedupe ต่อ แต่เพิ่ม counter/อ่าน
   detail เฉพาะ Conversation ที่ `created_at <= windowEndAt`.

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

### Live metric-date correction

Fresh operation `facebook-contentdaily-20260810-r1` completed without DLQ/alerts and wrote 64
observations with 2,351 shares, but durable reconciliation found D1 `metric_date=2026-08-11` while
the requested and canonical Lark date was `2026-08-10`. Root cause is the shared Organic History
Writer deriving Coverage/observation date only from `observedAt` and ignoring the explicit date in
the prepared Daily rows. The follow-up hotfix accepts an explicit `metricDate` while preserving the
existing default, and emits an unchanged `checkpoint` for historical observations so a fresh `r2`
can add durable correct-day evidence without deleting or mutating `r1`.

```text
R1_LIFECYCLE                       = COMPLETED_ATTEMPT_98
R1_CONTENT_ROWS                    = 64
R1_TOTAL_SHARES                    = 2351
R1_DLQ_ROWS                        = 0
R1_OPEN_ALERTS                     = 0
R1_D1_METRIC_DATE                  = 2026-08-11_INCORRECT
EXPECTED_METRIC_DATE               = 2026-08-10
HISTORY_DATE_HOTFIX_FOCUSED        = PASS_16_OF_16
HISTORY_DATE_HOTFIX_FULL_UNIT      = PASS_2995_OF_2995
HISTORY_DATE_HOTFIX_WORKERS        = PASS_18_OF_18
HISTORY_DATE_HOTFIX_REPORT         = PASS_105_OF_105
HISTORY_DATE_HOTFIX_AUDIT          = PASS_0_VULNERABILITIES
HISTORY_DATE_HOTFIX_DRY_RUN        = PASS
R2_FRESH_OPERATION                 = PENDING_REVIEWED_MERGE
DASHBOARD_MATERIALIZATION          = BLOCKED_UNTIL_R2_RECONCILES
```

Hotfix นี้ขยายเฉพาะ hard maximum ของ `MKT_META_SOURCE_MAX_UNITS` จาก 500 เป็น 2,500 โดยคง default ที่ 500 และคงขอบเขต rows/bytes เดิม เพื่อให้ Instagram inventory 1,857 รายการเดินต่อแบบ resumable ได้โดยไม่เปลี่ยน retry, idempotency หรือ write semantics.

Live progress หลัง deploy ยืนยันว่าช่วงวันที่ของ Instagram หลุดหายสองชั้นก่อนถึง adapter ทำให้ previous-day catch-up กลายเป็น full-account inventory 1,857 รายการ ทั้งที่ adapter มี newest-first bounded date-range contract อยู่แล้ว; hotfix จึงส่ง `periodStart`/`periodEnd` ผ่าน orchestration และ source collector เดิม โดยไม่เปลี่ยน Provider query schema หรือ write semantics.

Instagram R2 ยืนยันว่า period-bound contract ถูกใช้แล้ว แต่พบว่า source ceiling 2,500 ถูกส่งเป็น `listPhaseUnits.limit` ครั้งเดียว ขัดกับ D1 store page cap 500; hotfix จึงอ่าน staged units แบบหลายหน้าไม่เกิน 500 และ fail closed เมื่อ cursor ไม่เดินหรือจำนวน units ไม่ครบ.

Instagram R3 สำเร็จด้วย 1 content, 7 insight rows, D1 3/3 operations, Lark 7/7 tables, warning 0 และ reconciliation `failed=0`. Daily materialization มี D1/Lark snapshots ครบ 32 identities สำหรับ 8 platforms × `1D/3D/7D/30D`; Lark stable-key duplicate เป็นศูนย์ทุก Report table. Paid Ads predecessor DLQ 8 รายการถูกเก็บเป็นหลักฐานและ recovery ใช้ operation IDs `-r2` ใหม่โดยไม่ redrive.

Google Ads fresh LIVE ใช้ run ใหม่ `609cc147-809b-404a-a484-dcbb82c12a6f` โดยไม่ replay historical run ที่ถูกป้องกันไว้: signed delivery รับ 7/7 chunks และ 1,335/1,335 rows, admission `completed` ด้วย send attempt เดียว, reconciliation ครบ 6 datasets และ `failed_rows=0`. D1/Lark readback ตรงกันที่ Ads entities 1,105 และ Daily facts 390; Google Ads report R3 ทั้ง `1D/3D/7D/30D` มี coverage 1 และ fresh source watermark เดียวกัน. Google Ads Manager Script UI ยืนยัน script หลัก Enabled และ Provider frequency `Daily between 6:00 AM and 7:00 AM`; PREVIEW script ไม่มี schedule จึงไม่เกิด duplicate provider producer.

Blockers ที่ยังทำให้ห้ามประกาศ `MULTICHANNEL_RUNTIME_SCHEDULE_LIVE_PASS` เหลือสองรายการ:
YouTube Analytics customer-credential runtime bridge แก้ใน Repository และผ่าน gates แล้ว แต่ยังรอ
reviewed deployment กับ controlled live validation; Chatwoot pagination ยังเปลี่ยนระหว่าง continuation.
Public YouTube, Google Ads fresh LIVE, existing report coverage และ Dashboard materialization พร้อมตรวจ;
Production/Notification/DLQ redrive ยังปิด.

## Downstream Weekly Executive Decision Preview blocker — 2026-08-10

Fresh period `2026-08-03..2026-08-09` ถูกเลือกได้หลัง Daily materialization 32/32 แล้ว แต่ Fresh Executive Decision Preview หยุดก่อน mutation ด้วย `LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED`: AI metric-summary มี 8,435 characters เทียบเพดานที่ review แล้ว 8,000. รอบนี้มี `recordWriteCount=0`, `triggerWriteCount=0`, Queue/Notification/Schedule action = 0 และ Production ยัง BLOCKED.

Root cause แรกอยู่ที่ AI evidence serializer ซึ่ง serialize rank-1 candidate ซ้ำ: candidate เดียวกันอยู่ใน `contentCandidates`/`adCandidates` แล้วแต่ถูกใส่ซ้ำเป็น `topContent`/`topAds` ใน payload เดียวกัน. Hotfix PR #586 ลบเฉพาะ AI-side duplicate aliases โดยคง 3 Content + 3 Ads candidates, business facts, Decision Quality Gate และเพดาน 8,000 ไว้เหมือนเดิม. Historical factual aliases และ Historical Weekly delivery ไม่ถูกแก้หรือ rerun.

หลัง PR #586 merge การ rerun เดิมลด payload จาก 8,435 เป็น 8,220 characters แต่ยังเกินเพดาน 8,000 และยังหยุดก่อน mutation (`recordWriteCount=0`, `triggerWriteCount=0`). Root cause ชั้นที่สองคือ ranked `contentCandidates`/`adCandidates` ถูก serialize ครบอยู่แล้วใน `channelBusinessEvidence` แต่ยังถูก flatten ซ้ำทั้ง collection ภายใต้ `decisionEvidence`.

Hotfix PR #587 ลบเฉพาะ duplicate candidate collections จาก `decisionEvidence`; candidate facts สูงสุด 3 Content + 3 Ads ต่อ channel ยังคงอยู่ใน `channelBusinessEvidence`, ส่วน `scaleEvidenceAdNames`, `funnelDivergences`, `organicPaidMappingAvailable`, candidate-name validation, Decision Quality Gate และ `MAX_METRIC_SUMMARY_CHARS=8000` คงเดิม. ไม่มี Remote action ใน implementation นี้ และ Fresh Preview จะรันใหม่ได้หนึ่งครั้งหลัง #587 merge เพราะ live attempt ล่าสุดไม่มี record/trigger mutation.

## YouTube Customer OAuth runtime credential-path incident — 2026-08-10

### Incident status before correction (superseded diagnosis)

```text
INCIDENT                            = YOUTUBE_CUSTOMER_OAUTH_RUNTIME_CREDENTIAL_PATH_REGRESSION
CUSTOMER_CONNECTION                = CONNECTED_VALIDATED
ACTIVE_ENCRYPTED_REFRESH_REFERENCE = PRESENT_AND_MATCHED
CUSTOMER_RECONNECT_REQUIRED        = NO_ASSUMED_BEFORE_LIVE_REFRESH
PUBLIC_YOUTUBE_SYNC                = PASS
OWNER_ANALYTICS                    = BLOCKED
REPOSITORY_FIX                     = IN_PROGRESS
REMOTE_DEPLOYMENT                  = NOT_AUTHORIZED_BY_THIS_TASK
LIVE_ANALYTICS_REVALIDATION        = PENDING_AFTER_REVIEWED_DEPLOYMENT
```

### Diagnostic correction record

Read-only D1 audit เดิมยืนยันเพียงว่า Customer Connection ยังเป็น `connected/validated` และ
`credential_reference` ตรงกับ active encrypted Refresh Token; หลักฐานนั้นยังไม่พิสูจน์ว่า Google
refresh grant ใช้งานได้จริง. Source inspection พบเพิ่มว่า YouTube ingestion สร้าง Owner client จาก
legacy `YOUTUBE_OAUTH_*` environment path โดยไม่อ่าน Customer Connection/credential reference
ที่ callback บันทึกไว้ จึงต้องแก้ Repository bridge ก่อนทำ Live refresh preflight.

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

### Implementation result

```text
STATUS                            = REPOSITORY_FIXED_DEPLOYED_OWNER_RECONSENT_REQUIRED
REPOSITORY_FIXED                  = YES
LIVE_VALIDATED                    = NO
CUSTOMER_ACTION                   = ONE_TIME_GOOGLE_CONSENT_BY_ACTUAL_CHANNEL_OWNER
CUSTOMER_RECONNECT_REQUIRED       = YES_ONCE_BECAUSE_RETAINED_REFRESH_GRANT_IS_INVALID
OWNER_CREDENTIAL_SOURCE           = ENCRYPTED_CUSTOMER_CONNECTION_D1
LEGACY_OWNER_OAUTH_FALLBACK       = PROHIBITED_WHEN_ANALYTICS_ENABLED
FOCUSED_REGRESSION                = PASS
FULL_UNIT_TESTS                   = PASS
WORKERS_RUNTIME_TESTS             = PASS_18_OF_18
REPORT_RELIABILITY_TESTS          = PASS_105_OF_105
ARCHITECTURE_HYGIENE              = PASS_749_FILES_0_CYCLES
DEPENDENCY_AUDIT                  = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                    = PASS
DIFF_CHECK                        = PASS
REMOTE_DEPLOYMENT                 = PASS_REVIEWED_WORKER_DEPLOYED
LIVE_OWNER_PREFLIGHT              = BLOCKED_GOOGLE_INVALID_GRANT
LIVE_ANALYTICS_CATCH_UP           = NOT_RUN
```

Runtime routes ทั้ง dedicated และ compatibility path ใช้ `createYouTubeRuntimeClients` ร่วมกัน.
เมื่อ Analytics เปิด Factory จะอ่าน exact YouTube Customer Connection จาก D1, ตรวจ
`connected/validated`, approved scopes, active encrypted credential reference และ configured Channel
ก่อนสร้าง Owner client ผ่าน shared Google refresh provider. Access Token อยู่ใน memory เท่านั้น;
Public/API-key และ operator dry-run paths คงเดิม. หลัง reviewed deploy, Live refresh ของ retained
credential ถูก Google ปฏิเสธด้วย `invalid_grant`; การ publish OAuth app ไม่สามารถชุบ refresh grant
เดิมที่ถูกเพิกถอน/หมดอายุได้. การทดลอง consent ด้วยบัญชีนักพัฒนาสองบัญชีแลก code/scopes สำเร็จ
แต่คืน `channelId=null` และถูก callback ปิดเป็น `identity_mismatch` โดยไม่มี Queue/Lark write จึงยืนยันว่า
บัญชีเหล่านั้นไม่ใช่ owner ของ configured customer Channel.

ข้อสรุปสุดท้ายคือ ลูกค้าต้องเปิด Connect link ใหม่และ consent **ครั้งเดียว** ด้วย Google account/Brand
Account ที่เป็น owner ของ Channel จริงเพื่อออก Refresh Token ใหม่. หลังได้ grant ใหม่ ระบบใช้ Refresh
Token ต่อได้โดยไม่ให้ลูกค้ากดทุกวัน; จะขอใหม่เฉพาะเมื่อ Google/ผู้ใช้ revoke, token หมดอายุจาก policy
หรือ credential ถูกลบ. ห้ามทดลองบัญชีนักพัฒนาเพิ่มและห้ามประกาศ Owner Analytics ผ่านก่อน preflight,
catch-up และ D1/Lark reconciliation สำเร็จ.

## Chatwoot stable-identity pagination live closeout — 2026-08-10

```text
REPOSITORY_FIX                     = MERGED_PR_597
FOCUSED_CHATWOOT_TESTS             = PASS_25_OF_25
FULL_UNIT_TESTS                    = PASS_2933_OF_2933
WORKERS_RUNTIME_TESTS              = PASS_18_OF_18
ACTIVE_WORKER_VERSION              = 367a5c03-650b-44ce-9efa-b0da3cce3d7b_100_PERCENT
CONTROLLED_OPERATION               = chatwoot-daily-20260809-r6
PROVIDER_TOTAL_CONVERSATIONS       = 7720_READ_ONLY_METADATA
MAX_CONVERSATIONS                  = 10000_REMOTE_READBACK
PAGINATION_DRIFT_ALERTS            = 0_DURING_R6
LIVE_COMPLETION                    = R6_RETAINED_LIVENESS_EVIDENCE_CUTOFF_FIX_GATED
D1_LARK_RECONCILIATION             = PENDING_COMPLETION
DLQ_BULK_REDRIVE                   = NOT_RUN
PRODUCTION                         = BLOCKED
```

PR #597 เลิกใช้ mutable page fingerprint และ persist เฉพาะ PII-free stable numeric Conversation IDs,
ใช้ page list เพื่อ discovery, fetch exact detail ต่อ ID และวนจาก page 1 จน pass เต็มไม่พบ ID ใหม่.
Controlled `r5` ถูก gate ปฏิเสธก่อน business mutation เพราะ manual trigger ไม่ตรง steady-state schedule;
`r6` ใช้ scheduled trigger, เดินข้ามหลาย provider pages โดย seen IDs เพิ่มและ drift alert เป็นศูนย์.

ระหว่าง Live scan พบ Provider total 7,720 สูงกว่า active bound 5,000 จึงขยายเฉพาะ ignored runtime
limits เป็น 10,000, ผ่าน Wrangler dry-run, deploy reviewed `origin/main` ล่าสุด และ read back active
version 100%. ห้ามประกาศ Chatwoot PASS จน `r6` completed, checkpoint generation ตรง, exact alerts
เป็นศูนย์ และ 15 D1/Lark table identities reconcile. รายละเอียดอยู่ที่
`docs/project-brain/chatwoot-stable-identity-pagination-live-closeout-2026-08-10.md`.

Live pass แรกของ `r6` จบที่ 7,720 IDs แล้ว pass 2 พบ post-boundary ID ใหม่ทันที จึงยืนยัน liveness
defect เพิ่มเติม. Cutoff correction ผ่าน focused `25/25`, full unit `2933/2933`, Workers runtime
`18/18`, report reliability `105/105`, architecture/hygiene, audit และ deploy dry-run แล้ว; ยังต้อง
review/deploy และรอ exact operation convergence ก่อน reconciliation.

## Facebook ContentDaily Live source repair — 2026-08-11

### Objective and scope

แก้เหตุที่ Facebook source work เดิมจบ control-plane แต่ `MKT_Content_Daily` ไม่มีแถวและ Dashboard
แสดงศูนย์ โดยห้าม replay/redrive operation เดิม ห้าม fabricate metric และใช้ fresh operation ID เท่านั้น.

### Confirmed evidence

- PR #623 merge แล้วและ exact-head CI ผ่าน; post-merge `--recover` read-only fail closed เพราะ
  `sourceContentRows=89`, `contentDailyRows=0`, `targetDayAccountDailyRows=0`.
- GET-only probe ของ 10 Post identities ยืนยัน `/post/insights` คืน 0 แถวทั้ง date-bound/lifetime
  variants; token permissions มี `pages_read_engagement` แต่ขาด `read_insights`.
- Post node `shares` ผ่าน Graph v25 และคืนค่าจริง; in-memory write-set preview จาก 89 bounded Posts
  สร้าง 64 ContentDaily rows, total shares 2,351 และ observation date `2026-08-10`.

### Implementation result

```text
STATUS                              = REPOSITORY_FIX_GATES_PASS_LIVE_FRESH_RUN_PENDING
PR_623_RECOVERY_CONTROL_FIX         = MERGED_B7FA1629
OLD_OPERATION_REPLAY                = PROHIBITED_NOT_RUN
DLQ_REDRIVE                         = NOT_RUN
PROVIDER_GET_ONLY_PROBE             = PASS_BOUNDED
FACEBOOK_REQUIRED_PERMISSION        = PAGE_SCOPES_PASS_READ_INSIGHTS_OPTIONAL
POST_SHARES_FALLBACK                = OBSERVED_VALUES_ONLY
PREVIEW_SOURCE_CONTENT_ROWS         = 89
PREVIEW_CONTENT_DAILY_ROWS          = 64
PREVIEW_TOTAL_SHARES                = 2351
PREVIEW_OBSERVATION_DATE            = 2026-08-10
MISSING_VIEWS_LIKES_COMMENTS        = NULL_NOT_ZERO
FOCUSED_REGRESSION                  = PASS_41_OF_41
FULL_UNIT_TESTS                     = PASS_2994_OF_2994
WORKERS_RUNTIME_TESTS               = PASS_18_OF_18
REPORT_RELIABILITY_TESTS            = PASS_105_OF_105
ARCHITECTURE_HYGIENE                = PASS
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS
DIFF_CHECK                          = PASS
LIVE_DEPLOYMENT                     = PENDING_REVIEWED_MERGE
FRESH_OPERATION                     = PENDING_NEW_ID
DASHBOARD_MATERIALIZATION           = PENDING_LIVE_RECONCILIATION
PRODUCTION                          = BLOCKED
```
