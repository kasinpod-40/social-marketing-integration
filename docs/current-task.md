# Current Task — Multichannel Runtime & Schedule LIVE Activation Final Closure v1

## Status

```text
TASK_STATUS                         = FACEBOOK_TIKTOK_RELEASED_WEEKLY_TIME_GATE_REMAINS
CURRENT_PROGRAM                     = INTEGRATION_FINAL_CLOSEOUT_WAIT_AUTOMATIC_WEEKLY_20260817
BRANCH                              = codex/facebook-tiktok-release-closeout
EXACT_BASE                          = dff7c1e6cfe78740945f2a7e991ba8cc3a5acab5
INTEGRATION_WORKSPACE               = AUTHORIZED
PRODUCTION                          = BLOCKED
NOTIFICATION_RUNTIME                = ENABLED_RUNTIME_FOR_AUTOMATIC_WEEKLY
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
BASE_NOTIFICATION_AUTOMATION        = DISABLED
DLQ_REDRIVE                         = BLOCKED_OFF
```

### Automatic Weekly negative-channel Quality Gate repair — 2026-08-17

Automatic Weekly สำหรับช่วง `2026-08-10..2026-08-16` ทำงานตาม Schedule จริง แต่หยุดแบบ
fail-closed ก่อน Notification admission ด้วย
`LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED / weaknesses_missing_negative_channel`.
Fresh AI row เดิม generated ครบสี่ outputs แต่ Weaknesses กล่าว metric เชิงลบโดยไม่ระบุชื่อช่องทาง
ตาม Quality Gate. D1 delivery row และ Lark message เป็นศูนย์; terminal work/alert/DLQ เดิมต้องเก็บเป็น
forensic evidence และห้าม replay/redrive/reset.

Root cause คือ compact per-row `writerContract.weaknesses` บอกเพียงให้ใช้ negative evidence แต่ไม่บังคับ
ชื่อช่องทาง ขณะที่ Quality Gate ต้องมีทั้ง exact negative channel และ negative metric. Permanent fix ขยาย
contract ให้ระบุ channel + metric จาก `ch/m`, คง fallback เมื่อไม่มี negative comparison และ bump Fresh
Decision identity `v4 -> v5` เพื่อสร้าง immutable identity ใหม่โดยไม่แก้แถวเดิม.

#### Implementation result — pre-release

```text
SCHEDULED_PERIOD                    = 2026-08-10..2026-08-16
ORIGINAL_WORK                       = TERMINAL_FAIL_CLOSED
ORIGINAL_FAILURE                    = WEAKNESSES_MISSING_NEGATIVE_CHANNEL
ORIGINAL_MESSAGE_SEND_COUNT         = 0
ORIGINAL_DELIVERY_ROWS              = 0
ORIGINAL_FORENSIC_IDENTITY          = PRESERVED_NO_REPLAY_NO_REDRIVE
ROOT_CAUSE                          = PER_ROW_WEAKNESSES_CONTRACT_TOO_WEAK_FOR_GATE
PERMANENT_CONTRACT                  = REQUIRE_EXACT_NEGATIVE_CHANNEL_AND_METRIC
FRESH_IDENTITY                      = V5_NEW_IMMUTABLE_IDENTITY
LIVE_V5_READ_ONLY_PREFLIGHT         = PASS_PERIOD_20260810_20260816_CHANNELS_8
LIVE_V5_INPUT_BUDGET                = PASS_METRIC_2212_STATUS_593
LIVE_V5_EXISTING_IDENTITY_ROWS      = ZERO
FOCUSED_TESTS                       = PASS_22_OF_22
ARCHITECTURE_REPOSITORY_HYGIENE    = PASS
FULL_UNIT_TESTS                     = PASS_3048_OF_3048
WORKERS_RUNTIME_TESTS               = PASS_18_OF_18
REPORT_RELIABILITY_TESTS            = PASS_105_OF_105
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS_API_AND_SYNC_NO_DEPLOY
QUEUE_DELIVERY_DEPLOYMENT           = PENDING_REVIEWED_RELEASE
PRODUCTION                          = BLOCKED_UNCHANGED
```

### Downstream Facebook Dashboard truth repair — 2026-08-15

ผู้ใช้ส่ง Fresh Lark Base export หลัง Facebook current totals เริ่มขึ้น Dashboard แล้ว และอนุมัติให้แก้
ค่าที่เหลือซึ่งยังแสดงศูนย์หลอก. Scope นี้แยกจาก Source replay: ห้ามส่ง Queue, fresh run, deploy,
retention deletion หรือแก้ canonical `current_value` ด้วยมือ. ใช้ Base export เป็น read-only authority,
แก้เฉพาะ permanent Facebook normalization พร้อม tests และบันทึกข้อจำกัดของ Dashboard presentation.

Fresh export ยืนยัน Facebook ContentDaily 425 แถว. Snapshot ล่าสุดมี 91 Content: Views/Likes/Comments
ครบ แต่ Graph payload ใส่ `shares.count` เฉพาะ 66 RAW Content และละ `shares` object 27 RAW Content;
ContentDaily ล่าสุดจึงมี shares จริง 63 แถวและ null 28 แถว. Strict aggregate ปิด Total Shares,
Total Engagement และ Engagement Rate เป็น N/A. Permanent fix แปลงเฉพาะ omitted `shares` property จาก
successful Page Posts inventory เป็น observed zero; explicit `shares:null` ยังคง null เพื่อ fail closed.

Dashboard export ยืนยัน Organic KPI 17 blocks ยัง filter ด้วย preserved Display V2 เพียง condition เดียว
และ Statistics SUM แสดง numeric null เป็น 0. Period 7D ยังเป็น `baseline_incomplete` จริงที่ coverage
8/91 จึงห้าม fabricate ค่า. Signed `.base` export ไม่ถูกแก้หรือ import กลับ และ Live Dashboard PATCH
ยังไม่อยู่ใน public verified mutation boundary.

#### Implementation result

```text
BASE_EXPORT_READ_ONLY_AUDIT          = PASS
FACEBOOK_CONTENT_DAILY_ROWS          = 425
LATEST_TRACKED_CONTENT               = 91
LATEST_VIEWS_LIKES_COMMENTS          = COMPLETE_91_OF_91
LATEST_SHARES_NON_NULL_NULL          = 63_28
LATEST_OBSERVED_SHARE_SUM            = 2439
OMITTED_SHARES_NORMALIZATION         = IMPLEMENTED_ZERO_ONLY_WHEN_PROPERTY_ABSENT
EXPLICIT_NULL_SHARES                 = PRESERVED_NULL
PROVIDER_QUEUE_D1_LARK_MUTATIONS     = 0_0_0_0
MERGE                                = PR_652_MAIN_2E4336D8
LIVE_DEPLOYMENT                      = PASS_WORKER_377BB562_100_PERCENT
POST_DEPLOY_ALERT_DLQ_LOCK           = ZERO_ZERO_ZERO
FRESH_SCHEDULED_SOURCE_EVIDENCE      = TIME_GATED_20260817_0730
DASHBOARD_PATCH                      = NOT_RUN_UNSUPPORTED_PUBLIC_BOUNDARY
PERIOD_7D_BASELINE                   = INCOMPLETE_8_OF_91_NA_NOT_ZERO
FOCUSED_FACEBOOK_REGRESSION          = PASS_39_OF_39
ARCHITECTURE_REPOSITORY_HYGIENE      = PASS
FULL_UNIT_WORKER_TESTS               = PASS_3048_PLUS_18
REPORT_RELIABILITY_TESTS             = PASS_105_OF_105
NPM_AUDIT                            = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                       = PASS_BOTH_WORKERS_NO_DEPLOY
```

PR #652 ผ่าน Meta End-to-End และ Branch Verification แล้ว merge เข้า `main`. PR #653 ถูก rebase บน
merge ดังกล่าว จากนั้น Worker version `377bb562-46f0-44af-8aea-13b3e928bcaf` deploy จาก exact main
`dff7c1e6cfe78740945f2a7e991ba8cc3a5acab5` และรับ traffic 100%. Immediate D1 readback พบ alert ใหม่
0, DLQ ใหม่ 0 และ active lock 0; Meta Ads A22 เพียงรายการเดียวยังคงเป็น retained forensic work ตาม
authority เดิม. ไม่มี Queue/manual source run ถูกใช้แทน scheduled evidence.

### Downstream authority override — 2026-08-11

The original scope below intentionally kept Notification runtime and Automatic Weekly OFF during the
Multichannel Runtime/Schedule activation. That historical boundary was later superseded **only for the
approved Automatic Weekly Executive Notification workstream** after the user reviewed the successful one-shot
message and explicitly approved automatic weekly delivery. PR #630 implemented the guarded automatic path;
PR #633 fixed the live source-Settings authority boundary. Integration Workspace activation is now complete:
Notification runtime/send/mirror are enabled in `runtime` mode, Automatic Weekly is enabled for Monday 08:30
Asia/Bangkok, AI Materialization Automation remains enabled, Base Notification Automation remains disabled,
and Production/DLQ redrive remain blocked. Detailed evidence is in
`docs/project-brain/lark-automatic-weekly-executive-notification-2026-08-11.md` and
`docs/tasks/lark-automatic-weekly-executive-notification-v1.md`.

### TikTok MKT_Accounts master completion — 2026-08-16

Live `MKT_Accounts` เดิมมีเฉพาะ YouTube, Facebook และ Instagram เพราะ TikTok Native sync เขียน
`MKT_Content`/`MKT_Content_Daily` แต่ไม่เคยอ่านหรือเขียน Account master; ไม่เกี่ยวกับการลบ non-TikTok
RAW tables. Exact live backfill เพิ่มเพียง `tiktok:chemistry_k` หลังสำรอง 3 rows เดิมแบบ private และ
ตรวจ readback ว่า 3 identities เดิมไม่เปลี่ยน ทำให้ Live master ครบ 4 Organic channels.

Repository implementation เพิ่ม Account master ใน validation, legacy, staged/D1-first และ history routes.
Stable key คือ `tiktok:${accountId}`; source-handle guard ต้องผ่านก่อน plan และระบบเขียน Account หลัง
Content/Daily สำเร็จเท่านั้น จึงไม่ประกาศ `connected` เมื่อ Business write ล้ม. Staged path preflight
Account ครั้งเดียวและเขียนครั้งเดียวหลังทุก unit; retry/rerun ใช้ deterministic `last_sync_at` จาก
`metricDate` และเป็น idempotent upsert. งานนี้ไม่แก้ Facebook, schedule, secret หรือ Production.

#### Implementation result — TikTok Account master

```text
ROOT_CAUSE                         = TIKTOK_PIPELINE_OMITTED_MKT_ACCOUNTS
LIVE_MKT_ACCOUNTS_BEFORE          = 3
LIVE_MKT_ACCOUNTS_AFTER           = 4
LIVE_TIKTOK_ACCOUNT_CREATE        = PASS_EXACT_1
PRIOR_ACCOUNT_IDENTITIES          = PASS_UNCHANGED_3_OF_3
ACCOUNT_STABLE_KEY                = tiktok:chemistry_k
PRIVATE_BACKUP                    = PASS_3_ROWS_SHA256_42D849EB
PERMANENT_PIPELINE                = PR_653_MERGED_DEPLOYED
MAIN_MERGE                        = dff7c1e6cfe78740945f2a7e991ba8cc3a5acab5
WORKER_VERSION                    = 377bb562_100_PERCENT
POST_DEPLOY_ALERT_DLQ_LOCK        = ZERO_ZERO_ZERO
POST_DEPLOY_MKT_ACCOUNTS          = PASS_4_OF_4
FOCUSED_TIKTOK_TESTS              = PASS_25_OF_25
D1_FIRST_ORDERING_TESTS           = PASS_2_OF_2
FULL_UNIT_TESTS                   = PASS_3048_OF_3048
WORKERS_RUNTIME_TESTS             = PASS_18_OF_18
REPORT_RELIABILITY_TESTS          = PASS_105_OF_105
ARCHITECTURE_HYGIENE              = PASS
DEPENDENCY_AUDIT                  = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                    = PASS_API_AND_SYNC_NO_DEPLOY
PRODUCTION                        = BLOCKED_UNCHANGED
```

Permanent maintenance ถูก merge/deploy แล้วใน Worker รุ่นที่รับ traffic 100%. GET-only readback หลัง deploy
ยืนยัน `MKT_Accounts` ครบ 4/4 โดย TikTok เป็น `connected`; scheduled source evidence รอบถัดไปยังคงเป็น
หลักฐานตามเวลาและห้ามใช้ manual run แทน.
รายละเอียดอยู่ที่ `docs/project-brain/tiktok-mkt-accounts-master-2026-08-16.md`.

### Downstream storage authority override — 2026-08-14

ผู้ใช้อนุมัติให้ยกเลิก non-TikTok Lark RAW mirrors แบบถาวรโดยไม่สร้าง feature switch. Active API
Connector paths ต้องเก็บ source/history/coverage ใน D1 และเขียน Lark เฉพาะ customer-facing
`MKT_*`/Report tables. `RAW_TikTok_Creator_Videos` ยังคงเป็น protected Lark Native source แบบ
read-only. Repository implementation อยู่บน branch แยก `codex/remove-lark-raw-mirrors` เพื่อไม่ชน
Facebook work และไม่ deploy/merge/ลบ Live table ระหว่าง Chatwoot operation ที่กำลังทำงาน.

Exact cleanup scope มี 27 tables: Meta/shared Ads 5, YouTube 3, WooCommerce 9 และ Chatwoot 10.
ก่อนลบ Live ต้อง backup/checksum, apply D1 migration 0020, fresh YouTube Owner Analytics catch-up,
stable-key parity, reviewed deploy, fresh scheduled cycles และ zero-consumer proof. รายละเอียดและ exact
inventory อยู่ที่ `docs/project-brain/non-tiktok-lark-raw-retirement-2026-08-14.md`.

#### Implementation result

```text
NON_TIKTOK_LARK_RAW_WRITERS       = REMOVED_FROM_ACTIVE_CONTRACTS
NON_TIKTOK_LARK_RAW_PROVISIONING  = REMOVED_FROM_ACTIVE_SCHEMA
CHATWOOT_LARK_TARGETS             = 5_CUSTOMER_FACING_TABLES
WOOCOMMERCE_LARK_TARGETS          = 5_CUSTOMER_FACING_TABLES
YOUTUBE_LARK_RAW_TARGETS          = 0
YOUTUBE_ANALYTICS_D1_MIGRATION    = APPLIED_REMOTE_2026_08_14
YOUTUBE_ANALYTICS_D1_STORE        = ADDED_IDEMPOTENT_NEWER_WINS
TIKTOK_NATIVE_RAW                 = PROTECTED_READ_ONLY_UNCHANGED
LIVE_TABLE_DELETION               = PASS_EXACT_27_OF_27
DEPLOY_MERGE_REMOTE_MUTATION       = PR_641_MERGED_CURRENT_WORKER_808FE569_100_PERCENT
REMOTE_D1_BACKUP                  = PASS_129_MIB_SHA256_7A828BF0
PRIVATE_LARK_BACKUP               = PASS_27_TABLES_20072_RECORDS
LARK_BACKUP_MANIFEST              = SHA256_29CC5C19
YOUTUBE_D1_CATCHUP                = PASS_FRESH_EXACTLY_ONCE_20260804_20260811
YOUTUBE_ANALYTICS_D1_FACTS        = PASS_2532_DISTINCT_KEYS
YOUTUBE_D1_LARK_STABLE_KEY_PARITY = PASS_2532_OF_2532_HASH_EQUAL
YOUTUBE_NEW_ALERT_DLQ             = ZERO_ZERO
LARK_CONSUMER_AUDIT               = PASS_46_TABLES_931_FIELDS_139_VIEWS_0_WORKFLOWS
LARK_TARGET_REFERENCES            = ZERO
NEXT_REQUIRED_EVIDENCE            = AUTOMATIC_WEEKLY_20260817_0830
CI_INITIAL_RESULT                  = FAILED_STALE_RAW_EXPECTATIONS_24_TESTS
CI_FIX                             = IMPLEMENTED_OPERATOR_AND_FIXTURE_CONTRACT_ALIGNMENT
FULL_UNIT_TESTS                    = PASS_NPM_TEST
WORKERS_RUNTIME_TESTS              = PASS_18_OF_18
REPORT_RELIABILITY_TESTS           = PASS_105_OF_105
ARCHITECTURE_HYGIENE               = PASS
DEPENDENCY_AUDIT                   = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                     = PASS_API_AND_SYNC
DIFF_CHECK                         = PASS
```

PR #641 initial CI correctly exposed retained rollout/test contracts that still required legacy RAW table
mappings: Meta parity expectations used 7/11 targets, WooCommerce expected 14 targets, YouTube dry-run
preflight required three RAW mappings, and direct D1-first YouTube fixtures had no Analytics fact store.
The focused correction removes only those stale requirements and supplies the new D1 Analytics fixture;
it does not change Facebook metrics/provider logic. Focused tests 75/75, full `npm test`, report
reliability 105/105, architecture/hygiene, audit 0 vulnerabilities, deploy dry-run and diff check pass.

PR #641 merge เข้า `main` ที่ `ffb537958f406f5c44cedc109c657c5f198739d2`. ก่อน remote mutation
ได้ export D1 ขนาด 129 MiB และสำรอง Lark RAW ทั้ง 27 ตารางแบบ private local ครบ 20,072 records พร้อม
Fields, Views, full Records, exact stable-key lists และ per-file/manifest checksums; TikTok Native RAW
ถูกตรวจว่าคงอยู่. Migration `0020` apply สำเร็จและ Worker version
`7754be21-8be3-43b3-a537-9dc858b6f5b7` รับ traffic 100% โดย schedules/Queue topology เดิมไม่เปลี่ยน.

Fresh YouTube Owner Analytics catch-up ถูกส่งครั้งเดียวสำหรับ `2026-08-04..2026-08-11`; run
`c5d0e46e-492f-4a27-a0ec-0aa3a4d850d5` จบ success, selected/queried `837/837`, failed 0,
Analytics 2,532 rows, missing 0, alert/DLQ ใหม่ 0. D1 fact keys 2,532 รายการตรงกับ legacy Lark backup
ครบทุก key และ SHA-256 เท่ากัน โดย duplicate/missing/extra เป็นศูนย์. Lark GET-only consumer audit ตรวจ
46 non-target tables, 931 fields, 139 hydrated views และ workflow inventory แล้วไม่พบ target Table ID
reference.

Fresh scheduled Connector evidence หลัง reviewed deploy ผ่านครบสำหรับ WooCommerce, Instagram,
Meta/shared Ads, YouTube และ Chatwoot. Facebook operation `facebook-scheduled-20260815` จบ
`completed` เวลา `2026-08-16T02:21:13.679Z`; Coverage เป็น `complete/full_inventory` 89/89,
failed 0 และ D1 ตรงกับ Lark `MKT_Content`/`MKT_Content_Daily` 89/89 ทั้ง identity และ
Views/Likes/Comments/Shares. Scheduled retention `mkt-content-daily-retention-20260816` ผ่านหนึ่งครั้ง;
GET-only readback หลัง Facebook จบพบ 9,139/10,000 rows, unmanaged 0 และ delete candidate 0.

ก่อนลบได้ revalidate Lark backup 27/27 files, manifest SHA-256
`29cc5c19ec33292e0f42d814bcd90b03df465254176473811e010b0c5c1b2eef`, D1 backup SHA-256
`7a828bf065fbaba843ed88508c1c0d8a3d99773f957ca58beec81def670bd4e6`, YouTube D1↔legacy
backup 2,532/2,532 hash equal, zero target references, zero active locks และ zero current alert/DLQ.
Exact operator ลบ 27 ตารางทีละ Table ID สำเร็จ; readback หลังแต่ละรายการยืนยัน target เดียวหาย,
non-target identities ไม่เปลี่ยน และ protected `RAW_TikTok_Creator_Videos` ยังอยู่. ไม่มี manual
Queue run, replay, redrive, Worker deploy หรือ bulk mutation. Meta Ads A22 คงเป็น retained forensic
identity ที่ไม่มี active lock และไม่ใช่ current incident. Remaining Integration gate ที่อาศัยเวลาเหลือ
เฉพาะ Automatic Weekly วันจันทร์ 2026-08-17 เวลา 08:30 Asia/Bangkok; Production ยังรอ
customer-owned provisioning/UAT แยกต่างหาก.

#### Implementation result — Live RAW retirement closeout docs

```text
FACEBOOK_SCHEDULED_OPERATION       = COMPLETED_FULL_INVENTORY_89_OF_89_FAILED_0
FACEBOOK_D1_LARK_CURRENT_MKT       = PASS_89_OF_89_METRICS_EQUAL
MKT_CONTENT_DAILY                 = PASS_9139_OF_10000_UNMANAGED_0_DELETE_CANDIDATES_0
PRIVATE_BACKUP_CHECKSUMS           = PASS_27_OF_27
YOUTUBE_D1_LEGACY_BACKUP_PARITY    = PASS_2532_OF_2532_HASH_EQUAL
LARK_TARGET_REFERENCES             = ZERO
ACTIVE_LOCK_CURRENT_ALERT_DLQ      = ZERO_ZERO_ZERO
LIVE_LARK_RAW_DELETE               = PASS_EXACT_27_OF_27
PROTECTED_TIKTOK_NATIVE_RAW        = PASS_PRESENT_UNCHANGED
NON_TARGET_LARK_TABLES             = PASS_UNCHANGED
REPLAY_REDRIVE_MANUAL_QUEUE        = ZERO_ZERO_ZERO
REPOSITORY_CHECK                  = PASS
FULL_UNIT_TESTS                    = PASS_3047_OF_3047
WORKERS_RUNTIME_TESTS              = PASS_18_OF_18
REPORT_RELIABILITY_TESTS           = PASS_105_OF_105
DEPENDENCY_AUDIT                   = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                     = PASS_API_AND_SYNC
DIFF_CHECK                         = PASS
NEXT_TIME_BASED_GATE               = AUTOMATIC_WEEKLY_20260817_0830
PRODUCTION                         = BLOCKED_CUSTOMER_OWNED_PROVISIONING_UAT
```

### Downstream Chatwoot Daily incremental authority — 2026-08-15

ผู้ใช้อนุมัติให้แก้ Daily ที่เสียเวลาจากการสแกน Conversation ทั้งบัญชีสอง pass. Fresh Daily state ต้องใช้
bounded Provider `updated_within` query ครั้งเดียวสำหรับ immutable rolling 3-day window แล้วอ่าน detail
เฉพาะ changed stable IDs. Initial/Reconciliation และ legacy operation ที่เริ่ม full discovery แล้วคง
stable-ID two-pass path เดิม เพื่อไม่เปลี่ยน continuation contract กลางงาน.

#### Implementation result

```text
ROOT_CAUSE                          = DAILY_REUSED_FULL_ACCOUNT_TWO_PASS_DISCOVERY
DAILY_DISCOVERY                     = UPDATED_WITHIN_ONCE_BOUNDED
INITIAL_RECONCILIATION_DISCOVERY    = STABLE_IDENTITY_TWO_PASS_UNCHANGED
LATE_MESSAGE_AND_STATE_UPDATES      = INCLUDED_BY_CONVERSATION_UPDATED_AT
REPORTING_EVENTS                    = EXISTING_SERVER_SIDE_SINCE_UNTIL_UNCHANGED
LEGACY_IN_PROGRESS_STATE            = PRESERVE_STABLE_TWO_PASS
PII_IN_DURABLE_STATE                = ZERO
WEBHOOK_REQUIRED                    = NO
FOCUSED_TESTS                       = PASS_27_OF_27
CHATWOOT_REGRESSION                 = PASS_222_OF_222
FULL_UNIT_TESTS                     = PASS_3015_OF_3015
WORKERS_RUNTIME_TESTS               = PASS_18_OF_18
REPORT_RELIABILITY_TESTS            = PASS_105_OF_105
ARCHITECTURE_HYGIENE                = PASS
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS_API_AND_SYNC
DIFF_CHECK                          = PASS
CURRENT_DAILY_20260814              = COMPLETED_FAILED_0_ALERT_0_DLQ_0_LOCK_0
REMOTE_PROVIDER_PREFLIGHT           = PASS_GET_ONLY_51_ROWS_51_UNIQUE_ONE_REQUEST
MERGE_DEPLOY                        = PR_643_MERGED_WORKER_9D768D22_100_PERCENT
POST_DEPLOY_READBACK                = PASS_ALERT_0_DLQ_0_LOCK_0_MANUAL_WORK_0
NEXT_REQUIRED_EVIDENCE              = FRESH_SCHEDULED_DAILY_INCREMENTAL
CURRENT_ACTIVE_CONTINUATION         = TERMINAL_COMPLETED
PRODUCTION                          = BLOCKED
```

Exact Chatwoot continuation เดิมจบ `completed` แล้ว โดย failed units, exact open alerts, DLQ และ active
locks เป็นศูนย์. GET-only tenant preflight ของ rolling 3 days + 5 minutes ผ่านด้วย one request: 51 rows,
51 unique IDs, duplicate 0 และ `hasMore=false`. PR #643 ผ่าน Branch Verification และ merge เข้า `main`
ที่ `77f9c92efe36a6b36d6eed66bffc04e90326fe10`; Integration Worker version
`9d768d22-4f96-48aa-87d7-f1dd86c991a6` รับ traffic 100%. Post-deploy readback พบ alert ใหม่ 0,
DLQ ใหม่ 0, active lock 0 และไม่มี Chatwoot Work ที่ถูกส่งเองหลัง deploy. ขั้นถัดไปเหลือเฉพาะ fresh
scheduled Daily ว่า list discovery เกิดครั้งเดียว, checkpoint generation ตรง, zero new exact alert/DLQ
และ D1/Lark parity 15 targets. รายละเอียด:
`docs/project-brain/chatwoot-daily-updated-within-incremental-2026-08-15.md`.

### Downstream non-wait closeout authority — 2026-08-15

ผู้ใช้สั่งให้ทำทุกงานที่ไม่ต้องรอโดยไม่แตะ branch Facebook. งานนี้ใช้ worktree แยกและไม่มี Worker deploy,
Queue send, replay/redrive, schedule change, Production provisioning หรือ Lark delete.

```text
TIKTOK_PARTIAL_WRITE_ALERTS        = RESOLVED_BY_NEW_GENERATION_EXACT_2
ALERT_BULK_MUTATION                = ZERO
RECENT_OPEN_ALERTS_SINCE_AUG15     = ZERO
RECENT_OPEN_DLQ_SINCE_AUG15        = ZERO
ACTIVE_LOCKS                       = ZERO
KNOWN_RETAINED_FORENSIC_WORK       = META_ADS_A22_EXACT_1_PROHIBITED_FROM_TERMINALIZE
D1_CURRENT_SIZE                    = 151_74_MIB
D1_TABLES_ROWS_INDEXES             = 70_TABLES_175855_ROWS_104_INDEXES
D1_LINEAR_PROJECTION_1Y            = APPROX_609_35_MIB
D1_LINEAR_PROJECTION_3Y            = APPROX_1524_56_MIB
D1_PRIVATE_BACKUP_CHECKSUM         = PASS_SHA256_7A828BF0_FULL
D1_LOCAL_RESTORE_DRILL             = PASS_INTEGRITY_OK_70_TABLES_MIGRATION_0020_REAPPLIED
LARK_RAW_BACKUP_REVALIDATION       = PASS_27_TABLES_20072_RECORDS
STORAGE_LOAD_10X_100X              = PASS_INDEXED_QUERIES_INTEGRITY_OK
MKT_CONTENT_DAILY_RECORDS          = 9291_AFTER_EXACT_LIVE_RETENTION
MKT_CONTENT_DAILY_BOUNDED_PREVIEW  = RETAIN_9291_DELETE_CANDIDATES_10649
MKT_CONTENT_DAILY_EFFECTIVE_WINDOW = 4_COMPLETED_DAYS_PLUS_LATEST_EVERY_CONTENT
MKT_CONTENT_DAILY_LIVE_DELETE      = PASS_10649_EXACT_NON_FACEBOOK_RECORDS
MKT_CONTENT_DAILY_FACEBOOK         = DEFERRED_PROTECTED_425_OF_425
MKT_CONTENT_DAILY_AUTO_RETENTION   = DEPLOYED_DAILY_0805_FACEBOOK_DEFERRED
CUSTOMER_PRODUCTION_RUNBOOK        = PREPARED_NO_REMOTE_PROVISIONING
FOCUSED_NON_WAIT_TESTS             = PASS_15_OF_15
FULL_UNIT_TESTS                    = PASS_3030_OF_3030
WORKERS_RUNTIME_TESTS              = PASS_18_OF_18
REPORT_RELIABILITY_TESTS           = PASS_105_OF_105
ARCHITECTURE_HYGIENE               = PASS_775_FILES_2305_DEPENDENCIES_0_CYCLES
DEPENDENCY_AUDIT                   = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                     = PASS_API_AND_SYNC
DIFF_CHECK                         = PASS
```

Exact TikTok alerts `1a2a3464-...` และ `2bec4508-...` มี sync run เดิม `success`, Work `completed`,
generation ใหม่สำเร็จต่อเนื่องอย่างน้อยสองรอบ, active TikTok lock/DLQ เป็นศูนย์ จึงเปลี่ยนเฉพาะ alert
สองแถวเป็น `resolved` พร้อม closure reference `resolved_by_new_generation`. Historical Alert/DLQ อื่นคง
forensic evidence และไม่มี bulk mutation.

D1 capacity audit เป็น SELECT-only และเก็บ evidence private ที่
`/private/tmp/social-mkt-d1-capacity-audit-20260815.json`. อัตรา 14 วันล่าสุดเป็น projection แบบเส้นตรง
ไม่ใช่ quota guarantee. Local 10x/100x load test ใช้ Migration 0009 จริง: 100x มี Organic observations
1,208,200 แถวและ Ads daily 823,800 แถว; indexed 30-day queries ใช้ 873.68 ms และ 162.99 ms,
`PRAGMA integrity_check=ok`. Backup ก่อน Migration 0020 restore เข้า SQLite local ผ่าน 70 tables แล้ว
apply Migration 0020 ซ้ำผ่าน; Remote D1 ไม่ถูกแก้.

หลัง YouTube scheduled write ยืนยัน `RecordExceedLimit`, fresh preflight อ่าน `MKT_Content_Daily` 19,940
แถวและแยก Facebook ออกจาก delete scope ทั้งหมด. Reviewed operator สำรอง full Records/exact candidates/D1
authority แบบ private พร้อม checksums แล้วลบ exact non-Facebook 10,649 แถว: TikTok 8,138 และ YouTube
2,511. Readback เหลือ 9,291 แถวตรง plan; Facebook 425/425 และ Instagram 37/37 คงเดิม, TikTok Native RAW
identity/source fingerprint ไม่เปลี่ยน, D1/Queue/Worker mutation เป็นศูนย์.

PR #647 เพิ่ม permanent retention job เวลา 08:05 ก่อน Daily Report 08:10. Job ใช้ stable Queue identity,
หยุดเมื่อมี active sync lock, ตรวจซ้ำก่อนทุก exact-ID batch, เก็บ latest ทุก Content และ defer Facebook
จน credential gate ผ่าน. Worker version `3d9c363d-d1fc-4cfe-b275-9fa75b0a6ca1` รับ traffic 100%; immediate
post-deploy alert/DLQ/lock/manual-retention work เป็นศูนย์. รายละเอียด:
`docs/project-brain/mkt-content-daily-retention-live-closeout-2026-08-15.md`.

งานที่เหลือซึ่งต้องรอจริง: Facebook token `pages_read_user_content` + fresh run (แยกจาก closeout นี้), fresh
post-deploy scheduled cycles รวม scheduled retention รอบแรกก่อน RAW retirement, Automatic Weekly วันจันทร์
08:30 และ customer-owned Production assets. Runbook อยู่ที่
`docs/runbooks/customer-owned-production-cutover-v1.md`.

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

The notification-off criterion above is historical to this task and is superseded only by the approved downstream
Automatic Weekly authority recorded at the top of this document. DLQ redrive and Production remain blocked.

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
NOTIFICATION_RUNTIME                = ENABLED_RUNTIME_FOR_AUTOMATIC_WEEKLY
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
BASE_NOTIFICATION_AUTOMATION        = DISABLED
AUTOMATIC_WEEKLY_ACTIVE_VERSION     = f19492d2-67f4-4b7c-ba78-3bb84fb439e8_100_PERCENT
AUTOMATIC_WEEKLY_IMMEDIATE_SENDS    = 0
DLQ_REDRIVE                         = BLOCKED_OFF
PRODUCTION                          = BLOCKED
```

### Automatic Weekly Executive live activation — 2026-08-11

PR #630 implemented the automatic Weekly orchestration. A read-only live preview then exposed a source-Settings
shape mismatch (`matchCount=0`) with zero mutation; PR #633 corrected the activation boundary by reading raw
Lark Setting records from exact canonical keys and merged at
`89f9c615f2ae20f798b089e639c3d9dd5f1cb38a` after exact-head CI passed.

The first execute after #633 activated three exact 7D Settings but Cloudflare rejected the new Worker version
because the automatic Worker path imports `node:crypto` and the ignored active config lacked Node compatibility.
That attempt had `settingsWriteCount=3`, `workerDeploymentCount=0`, Queue admission 0 and message send 0. The
recovery preserved those active Settings, added `nodejs_compat` to ignored `wrangler.sync.jsonc`, and completed
with active Worker version `f19492d2-67f4-4b7c-ba78-3bb84fb439e8` serving 100% traffic. Recovery wrote zero
additional Settings, admitted zero immediate Queue jobs and sent zero immediate Lark messages. Runtime/send/mirror
are now enabled in runtime mode, Automatic Weekly is enabled Monday 08:30 Asia/Bangkok, AI Materialization
Automation is enabled, Base Notification Automation is disabled, and Production remains blocked. The next eligible
period is `2026-08-10..2026-08-16`, due Monday `2026-08-17 08:30 Asia/Bangkok`.

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

The final sentence above is historical to the original Multichannel activation. Notification runtime and Automatic
Weekly are now enabled under the downstream authority recorded in this document; Production and DLQ redrive remain
blocked.

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
STATUS                              = LIVE_CLOSED_DURABLE_AND_DASHBOARD_VERIFIED
PR_623_RECOVERY_CONTROL_FIX         = MERGED_B7FA1629
PR_629_POST_SHARES_FALLBACK         = MERGED_70001D30
PR_632_HISTORY_METRIC_DATE_FIX      = MERGED_A8606384
OLD_OPERATION_REPLAY                = PROHIBITED_NOT_RUN
DLQ_REDRIVE                         = NOT_RUN
PROVIDER_GET_ONLY_PROBE             = PASS_BOUNDED
FACEBOOK_REQUIRED_PERMISSION        = PAGE_SCOPES_PASS_READ_INSIGHTS_OPTIONAL
POST_SHARES_FALLBACK                = OBSERVED_VALUES_ONLY
PREVIEW_SOURCE_CONTENT_ROWS         = 89
PREVIEW_CONTENT_DAILY_ROWS          = 64
PREVIEW_TOTAL_SHARES                = 2351
PREVIEW_OBSERVATION_DATE            = 2026-08-10
LIVE_R2_OPERATION                   = facebook-contentdaily-20260810-r2
LIVE_R2_ATTEMPTS                    = 98
LIVE_CONTENT_DAILY_ROWS             = 64
LIVE_CONTENT_DAILY_DISTINCT_KEYS    = 64
LIVE_TOTAL_SHARES                   = 2352
LIVE_METRIC_DATE                    = 2026-08-10
LIVE_COVERAGE                       = COMPLETE_64_OF_64_FAILED_0
LIVE_DLQ_OPEN_ALERTS                = 0_0
MISSING_VIEWS_LIKES_COMMENTS        = NULL_NOT_ZERO_READ_INSIGHTS_NOT_GRANTED_TO_ACTIVE_TOKEN
FOCUSED_REGRESSION                  = PASS
FULL_UNIT_TESTS                     = PASS_2995_OF_2995
WORKERS_RUNTIME_TESTS               = PASS_18_OF_18
REPORT_RELIABILITY_TESTS            = PASS_105_OF_105
ARCHITECTURE_HYGIENE                = PASS
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS
DIFF_CHECK                          = PASS
EXACT_HEAD_CI                       = PASS_BRANCH_31483799036_META_31483799052
LIVE_DEPLOYMENT                     = PASS_WORKER_5EDE6471_100_PERCENT
DASHBOARD_MATERIALIZATION           = PASS_1D_3D_7D_30D_SHARES_2352_AVAILABLE
LARK_OPENAPI_READBACK               = PASS_GET_ONLY_CONTENTDAILY_64_METRICS_4_WINDOWS
DASHBOARD_VISUAL_ACCEPTANCE         = PASS_USER_CONFIRMED_2026_08_11
PRODUCTION                          = BLOCKED
```

Fresh `r2` ใช้ operation identity ใหม่เพียงครั้งเดียวและจบ `completed/success`; D1 และ Lark OpenAPI
readback ตรงกันที่ 64 stable ContentDaily keys วันที่ `2026-08-10`, shares รวม 2,352, null shares 0.
Materialization 1D/3D/7D/30D คืน `facebook:latest_total_shares=2352` และ availability `available`
ครบทุกช่วง; ผู้ใช้ยืนยัน Dashboard แสดง Facebook แล้ว. Active token `GET /me/permissions` ยังไม่มี
`read_insights` แม้ App permission จะพร้อมทดสอบ จึงคง Views/Likes/Comments เป็น N/A ตาม contract.

## YouTube customer-owner Analytics catch-up continuation — 2026-08-12

```text
CUSTOMER_OWNER_CONSENT              = PASS_CONNECTED_VALIDATED
OWNER_CHANNEL_SUFFIX                = MATCH_9GMA
APPROVED_SCOPES                     = PASS_2_OF_2
ACTIVE_REFRESH_CREDENTIAL           = PASS_NEW_ACTIVE_OLD_REPLACED
LIVE_OWNER_AUTHORIZATION            = PASS
CONTROLLED_CATCH_UP_RANGE            = 2026_08_04_TO_2026_08_10
FAILED_SYNC_RUN                      = bf9f39ef-fe9a-47ce-ab0e-25c2811013cf
FAILED_WORK                          = youtube:f54a3b902951abbf42baad950f74a2c8
FAILED_OPERATION_REPLAY             = PROHIBITED_NOT_RUN
FAILED_OPERATION_RECORDS_WRITTEN    = 0
ROOT_CAUSE                           = AVERAGE_VIEW_PERCENTAGE_FALSE_100_CEILING
REPOSITORY_HOTFIX                    = MERGED_PR_637_AND_PR_638_DEPLOYED
DEPLOYED_WORKER_VERSION              = 0aff7439-5ea2-4df3-8926-1b7430c98659_100_PERCENT
SECOND_FAILED_SYNC_RUN               = 30383548-d570-4fac-acfb-5c92f5ea9b7d
SECOND_FAILED_WORK                   = youtube:b9268e5ac108b031033727c0ecceb9e3
SECOND_FAILURE                       = LIKES_NON_NEGATIVE_CONSTRAINT
SECOND_OPERATION_RECORDS_WRITTEN     = 0
SECOND_OPERATION_REPLAY              = PROHIBITED_NOT_RUN
SIGNED_DAILY_COUNT_HOTFIX            = LIVE_VALIDATED
LIVE_ANALYTICS_CATCH_UP              = PASS_FRESH_OPERATION
LIVE_SYNC_RUN                        = 4ff26ea0-6a83-4781-95f1-ca0fe609a0e1_SUCCESS
LIVE_WORK                            = youtube:51b03da1705e0412a038e5dc51016c31_COMPLETED
LIVE_ANALYTICS_VIDEO_SCOPE           = 837_SELECTED_837_QUERIED_0_FAILED
LIVE_ANALYTICS_ROWS                  = 1919_COMPLETE_MISSING_0
LIVE_RECORDS_WRITTEN                 = 2079
LIVE_NEW_ALERTS                      = 0
LIVE_D1_CHECKPOINT                   = PASS_COMMITTED_TO_FRESH_RUN
LIVE_LARK_RECONCILIATION             = PASS_1919_OF_1919_UNIQUE_KEYS
LIVE_SIGNED_ADJUSTMENTS              = PASS_13_CELLS_PRESERVED
PRODUCTION                           = BLOCKED
FOCUSED_YOUTUBE_AND_WORKBOOK_TESTS   = PASS_23_OF_23
FULL_UNIT_TESTS                      = PASS_3008_OF_3008
WORKERS_RUNTIME_TESTS                = PASS_18_OF_18
REPORT_RELIABILITY_TESTS             = PASS_105_OF_105
ARCHITECTURE_HYGIENE                 = PASS
DEPENDENCY_AUDIT                     = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                       = PASS
DIFF_CHECK                           = PASS
```

Customer callback ผ่าน exact Channel/scopes และ rotate encrypted Refresh Token สำเร็จ. Fresh controlled
catch-up ผ่าน Owner authorization แล้ว แต่หยุด fail-closed เพราะ RAW adapter บังคับ
`averageViewPercentage <= 100`; Live Source คืนค่ามากกว่า 100 ซึ่งเกิดได้เมื่อผู้ชมรับชมซ้ำ. Hotfix ต้อง
รักษาค่า finite non-negative ตาม Source, ห้าม clamp เป็น 100, ยังปฏิเสธค่าติดลบ/non-finite และอัปเดต
Blueprint/Lark description ให้ตรงกัน. ห้าม replay Work ที่ล้ม; หลัง reviewed merge/deploy ให้ใช้ fresh
Queue delivery แล้วตรวจ completion, zero new exact alerts และ D1/Lark parity ก่อนประกาศ Live PASS.

### Implementation result (pre-deploy)

Adapter, Source contract, Lark description และ workbook field metadata ใช้ contract เดียวกันแล้ว:
`averageViewPercentage` ต้องเป็น finite non-negative แต่ไม่จำกัดเพดาน 100 และเก็บ exact Source value.
Regression ครอบคลุมค่าจริง `125.5` และค่าติดลบที่ต้อง fail closed. Full repository gates ผ่านครบตาม
ตัวเลขด้านบน; ขั้นถัดไปคือ reviewed PR/merge/deploy แล้วส่ง fresh operation เท่านั้น.

### Post-PR #637 incident and second implementation result

PR #637 merge และ deploy เข้า Integration Worker สำเร็จที่ version
`c56c255f-2ca0-42be-ad2b-552d9b4f0fe5` 100%. Fresh operation ใหม่เพียงหนึ่งรอบผ่าน Owner OAuth,
exact Channel และ inventory 100 Videos/2 pages แล้วหยุดก่อน Analytics staging ด้วย
`likes must be a non-negative safe integer`. Run `30383548-d570-4fac-acfb-5c92f5ea9b7d` และ Work
`youtube:b9268e5ac108b031033727c0ecceb9e3` เป็น terminal, records written 0 และ exact alerts 2 รายการ
ถูกเก็บเป็นหลักฐานโดยไม่ replay.

Root cause ชั้นที่สองคือ RAW adapter ใช้ non-negative cumulative-count contract ของ Data API กับ
Analytics period metrics. Correction แยกสอง contract: Analytics `views`/`likes`/`comments`/`shares`
เก็บ signed safe integer adjustment ตาม Provider, ยังปฏิเสธ fractional/non-finite/unsafe value และไม่
round/clamp/fabricate; Channel/Video cumulative counts ยังคง non-negative. Adapter, tests, Blueprint,
Lark descriptions และ workbook อัปเดตแล้ว. Live status ยังไม่ปิดจน reviewed merge/deploy รอบที่สองและ
fresh operation ใหม่สำเร็จพร้อม reconciliation.

Focused regression `23/23`, full unit `3008/3008`, Workers runtime `18/18`, report reliability
`105/105`, architecture/repository hygiene, dependency audit 0 vulnerabilities, deploy dry-run และ
diff check ผ่าน. Workbook ตรวจ values/formulas และ render ครบ 10 sheets โดยไม่พบ formula error หรือ
layout regression. ข้อความนี้เป็นสถานะ pre-deploy ซึ่งถูก supersede โดย Live closure ด้านล่าง.

### Post-PR #638 reviewed deployment and Live closure

PR #638 merge เข้า `main` ที่ commit `61cd05afa0f0f1c402c206242c074296c9b47f86`; exact-head CI
`31567102553` ผ่านทุก step. Integration Worker version
`0aff7439-5ea2-4df3-8926-1b7430c98659` ถูก deploy และ read back ที่ traffic 100% เพียง version เดียว.
Owner preflight ก่อนส่งงานยืนยัน connection เดียวที่ `connected/validated`, exact Channel, approved
scopes 2 รายการ, active encrypted Refresh Token 1 รายการ และ active YouTube Work/lock เป็นศูนย์.

Fresh catch-up ถูกส่งเพียงครั้งเดียวที่ `2026-08-12T05:45:57.171Z` สำหรับ requested Analytics range
`2026-08-04..2026-08-10`; ไม่ replay/redrive failed Work ทั้งสองรายการ. Work ใหม่
`youtube:51b03da1705e0412a038e5dc51016c31` จบ `completed` และ run
`4ff26ea0-6a83-4781-95f1-ca0fe609a0e1` จบ `success`: inventory/resources 100/100, Analytics selected
837 Videos, queried 837, failed 0, returned 1,919 period rows, missing reconciliation rows 0 และเขียน
2,079 operations โดยไม่มี alert ใหม่.

D1 completion เป็น `write`, checkpoint ถูก commit ไปยัง fresh run และ `reconciliation.required=false`.
Lark GET-only readback พบ 1,919/1,919 rows กับ 1,919 unique stable keys, duplicate 0, Channel mismatch 0,
invalid metric 0 และ signed count adjustments 13 cells ถูกเก็บตาม Source จริง. Provider มี rows วันที่
`2026-08-04..2026-08-09` ภายใน requested window; วันที่ 10 ไม่มี Source row จึงไม่ fabricate/zero-fill.
YouTube Customer-owner Analytics blocker ของ Integration Workspace ปิดเป็น Live PASS แล้ว; Production
ยัง BLOCKED และ historical failed Works/alerts ยังคงเป็น immutable incident evidence.
## Facebook Reactions/Comments Post summaries — 2026-08-12

### Objective and scope

เติม Facebook Likes/Reactions และ Comments ให้ `MKT_Content_Daily` และ Organic Dashboard โดยใช้ค่า
จริงจาก Post summary, ไม่เพิ่มตาราง, ไม่ replay/redrive operation เก่า และไม่รวม TikTok Ads.

### Confirmed evidence

- Token ใหม่มี `read_insights`, `pages_show_list` และ `pages_read_engagement` แล้ว แต่ยังไม่มี
  `pages_read_user_content`.
- GET-only minimal reproduction ยืนยัน `shares` ผ่าน ขณะที่ `reactions` และ `comments` summary ถูก
  Graph ปฏิเสธด้วย code 10; root cause จึงเป็น permission grant ที่ active token ไม่ครบ.
- Canonical/D1/Lark mapping เดิมรองรับ `reactions_count → likes` และ
  `comments_count → comments` อยู่แล้ว จึงไม่ต้อง migration หรือแก้ Dashboard schema.

### Acceptance criteria

- Source request ใช้ `reactions.limit(0).summary(true)` และ `comments.limit(0).summary(true)` เท่านั้น;
  ห้ามดึง user list หรือ Comment text.
- `0` ที่ Source คืนต้องเก็บเป็นศูนย์จริง; field ที่ไม่คืนเป็น null/N/A; malformed count ต้อง fail closed.
- Facebook preflight ต้อง require `pages_show_list`, `pages_read_engagement`,
  `pages_read_user_content` และ `read_insights`.
- Focused/full repository gates และ exact-head CI ผ่านก่อน merge/deploy.
- ห้าม deploy ก่อน secrets ทั้ง User/Page token มี permission ครบ.
- หลัง deploy ใช้ fresh operation ID เท่านั้น แล้วตรวจ terminal success, Coverage, D1/Lark parity,
  zero new alert/DLQ และ materialization 1D/3D/7D/30D.

### Implementation result (repository pre-deploy)

```text
STATUS                              = REPOSITORY_IMPLEMENTED_CREDENTIAL_GATED
SOURCE_REACTIONS_SUMMARY            = IMPLEMENTED_LIMIT_0_SUMMARY_TRUE
SOURCE_COMMENTS_SUMMARY             = IMPLEMENTED_LIMIT_0_SUMMARY_TRUE
PII_COMMENT_BODY_READ               = NOT_REQUESTED
RAW_CANONICAL_D1_LARK_MAPPING       = REUSED_EXISTING_CONTRACT
MIGRATION_NEW_TABLE                 = NONE
MISSING_FIELD_SEMANTICS             = NULL_NOT_ZERO
OBSERVED_ZERO_SEMANTICS             = REAL_ZERO
MALFORMED_SUMMARY                   = FAIL_CLOSED
REQUIRED_PERMISSIONS                = PAGES_SHOW_LIST_PAGES_READ_ENGAGEMENT_PAGES_READ_USER_CONTENT_READ_INSIGHTS
LIVE_GET_ONLY_SCOPE                 = MISSING_PAGES_READ_USER_CONTENT
FOCUSED_META_FACEBOOK_TESTS         = PASS_416_OF_416
FULL_UNIT_TESTS                     = PASS_3009_OF_3009
WORKERS_RUNTIME_TESTS               = PASS_18_OF_18
REPORT_RELIABILITY_TESTS            = PASS_105_OF_105
ARCHITECTURE_HYGIENE                = PASS
DEPENDENCY_AUDIT                    = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                      = PASS
LIVE_DEPLOYMENT                     = BLOCKED_CREDENTIAL_SCOPE
FRESH_OPERATION_RECONCILIATION      = PENDING_AFTER_REVIEWED_DEPLOY
OLD_OPERATION_REPLAY_DLQ_REDRIVE    = PROHIBITED_NOT_RUN
PRODUCTION                          = BLOCKED
```

Implementation ใช้ helper ใน write-set เดิมและเส้นทาง Raw/Canonical/D1/Lark เดิมทั้งหมด. Full gates
ผ่านครบตามตัวเลขด้านบน; ขั้นถัดไปคือเปิด reviewed PR และให้ผู้ใช้ rotate/upload สอง secrets จาก token grant ที่มี
`pages_read_user_content` ก่อน Live deployment. รายละเอียดอยู่ที่
`docs/project-brain/facebook-reactions-comments-live-2026-08-12.md`.

### Downstream live-evidence override — 2026-08-15

ข้อสรุปว่า Token ยังขาด `pages_read_user_content` ข้างต้นถูกแทนที่ด้วย Business-ingestion evidence
จาก active Page credential จริง: fresh scheduled operation `facebook-scheduled-20260814` อ่าน Post
inventory 91/91 สำเร็จและเขียน Views/Likes/Comments/Shares ลง D1 กับ Lark ตรงกันทุก stable key.
User-token `/me/permissions` จึงไม่ใช่ gate ที่เพียงพอสำหรับตัดสิน Page-token capability และไม่ต้องรบกวน
ลูกค้าให้ออก Token ใหม่อีกในรอบนี้.

Dashboard materialization หลัง source completion ยังคืน Likes/Comments/Shares เป็น N/A เพราะ generic D1
report reader รวม stale Facebook identities 3 รายการซึ่งไม่อยู่ใน authoritative `full_inventory` ล่าสุด;
ค่า null ของรายการเก่าจึงทำให้ strict aggregate เป็น null. การแก้ต้องคง null semantics เดิมและ filter เฉพาะ
เมื่อ Coverage เป็น `complete`, `full_inventory`, ตรง `period_end`, failed 0 และ entity set ครบเท่านั้น.

#### Implementation result (dashboard regression fix pre-deploy)

```text
ACTIVE_PAGE_TOKEN_ROTATION           = NOT_REQUIRED_PROVIDER_CAPABILITY_PROVEN
FRESH_SOURCE_OPERATION               = FACEBOOK_SCHEDULED_20260814_COMPLETED
CONTENT_COVERAGE                     = COMPLETE_FULL_INVENTORY_91_OF_91_FAILED_0
D1_LARK_STABLE_KEY_PARITY            = PASS_91_OF_91
D1_LARK_VIEWS_TOTAL                  = PASS_1584330
D1_LARK_LIKES_TOTAL                  = PASS_16069
D1_LARK_COMMENTS_TOTAL               = PASS_70
D1_LARK_SHARES_TOTAL                 = PASS_2439_63_OBSERVED_ROWS
SOURCE_ALERT_DLQ                     = ZERO_ZERO
DASHBOARD_ROOT_CAUSE                 = THREE_STALE_IDENTITIES_OUTSIDE_LATEST_INVENTORY
STRICT_NULL_SEMANTICS                = PRESERVED
AUTHORITATIVE_INVENTORY_SCOPING      = IMPLEMENTED_FAIL_CLOSED
FOCUSED_REGRESSION                   = PASS_18_OF_18
FULL_UNIT_TESTS                      = PASS_3047_OF_3047
WORKERS_RUNTIME_TESTS                = PASS_18_OF_18
REPORT_RELIABILITY_TESTS             = PASS_105_OF_105
ARCHITECTURE_HYGIENE                 = PASS
DEPENDENCY_AUDIT                     = PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                       = PASS_API_AND_SYNC
DIFF_CHECK                           = PASS
REVIEWED_PR_CI                       = PASS_PR_649_TWO_VERIFY_CHECKS
MERGED_MAIN                          = 7F4C301413ACEC53E9003FEB08F936E38F5C14A4
LIVE_WORKER_VERSION                  = 808FE569_100_PERCENT
LIVE_DASHBOARD_REMATERIALIZATION     = PASS_1D_3D_7D_30D_EXACTLY_ONCE
D1_LARK_DASHBOARD_VIEWS              = PASS_1584330_AVAILABLE
D1_LARK_DASHBOARD_LIKES              = PASS_16069_AVAILABLE
D1_LARK_DASHBOARD_COMMENTS           = PASS_70_AVAILABLE
D1_LARK_DASHBOARD_SHARES             = PASS_NULL_NOT_OBSERVED_28_SOURCE_NULLS
FACEBOOK_CONNECTOR_SCHEDULE          = ENABLED_0730_ASIA_BANGKOK
FACEBOOK_RETENTION_DEFER_REMOVAL     = DEPLOYED_EMPTY_DEFER_SET
POST_DEPLOY_ALERT_DLQ_LOCK           = ZERO_ZERO_ZERO
NEXT_REQUIRED_EVIDENCE               = SCHEDULED_SYNC_0730_AND_RETENTION_0805_20260816
RAW_27_TABLE_DELETION                = OUT_OF_SCOPE_WAIT_SCHEDULED_EVIDENCE
```

PR #649 ผ่าน CI สองชุดและ merge เข้า `main` ที่ `7f4c301413acec53e9003feb08f936e38f5c14a4`.
Worker version `808fe569-8319-469b-b069-2b586642e630` รับ traffic 100% พร้อม Facebook connector/schedule
เปิด, retention เปิดและ deferred-platform set ว่าง; DLQ redrive ยังคงปิดและ Notification/ระบบอื่นคงเดิม.
Fresh Dashboard operation IDs `report-facebook-{1,3,7,30}d-20260814-postdeploy-r2` ถูก consume
อย่างละหนึ่งครั้งและ run สำเร็จทั้ง 4 รายการ. D1 กับ GET-only Lark readback ตรงกันทุกค่า/สถานะ.
Shares เป็น N/A อย่างถูกต้องเพราะ 28/91 current Source rows ไม่คืน `shares`; ไม่อนุมาน missing เป็น 0.
ไม่มี source rerun/replay/redrive หรือ manual retention. หลักฐานที่ต้องรอตามเวลาจริงคือ Facebook sync
07:30 และ retention 08:05 วันที่ 2026-08-16; Weekly Notification วันจันทร์ 08:30 และ RAW retirement
คงเป็น workstream แยก.
