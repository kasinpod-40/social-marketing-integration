# Social Marketing Data Integration

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base สำหรับ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ JavaScript ES Modules, Cloudflare Workers, D1, Queues และ Lark Open API

Storage direction ปัจจุบันคือ API Provider → D1 source/history/coverage → customer-facing Lark
`MKT_*`/Report. ระบบไม่สร้าง non-TikTok Lark RAW mirrors ใหม่และไม่มี switch เปิดกลับ; เฉพาะ
`RAW_TikTok_Creator_Videos` เป็น protected Lark Native source แบบ read-only. Exact retirement scope
และ safe deletion gate อยู่ที่ `docs/project-brain/non-tiktok-lark-raw-retirement-2026-08-14.md`.

Customer Base consolidation workstream ปัจจุบันใช้ exact local Lark `.base` export เป็น Source authority
แทน Live Source token: `Social MKT Data Hub(20260818-030125).base`, SHA-256
`c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`. Direct inspection ยืนยัน
33 Tables, 723 Fields, 35,528 unique Records, 111 Views, 12 Relations, 4 Formulas, 6 Dashboards,
2 Automations และ 4 Advanced Permission roles. Policy B ล็อก clone parity ที่ 32 Tables และให้ Target
`🎵 RAW_TikTok_Creator_Videos` เป็น `protected_external_reuse`: live Target เป็น authority, migration ห้าม
clone/compare/apply/verify/repair ตารางนี้และยังอยู่ใต้ immutable pre-existing Target write fence เต็มรูปแบบ.
GET-only v6 customer audit ผ่าน `policyBPreviewReady=true`, `remoteMutationCount=0`; Apply ยังปิดเพราะ
full parity ของ clone scope ยังไม่ครบ. Canonical Field/Record/Relation/Formula/basic View verifier และ documented
View `hierarchy_config` parity phase ถูกเพิ่มแบบ fail-closed; View properties ที่ยังไม่มี documented write contract,
Dashboard/Workflow materialization และ Advanced Permission remap ยังคง block จนพิสูจน์ coverage ได้ครบ.
รายละเอียดอยู่ที่ `docs/project-brain/customer-base-consolidation-v1.md`.

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
PASS; Production ยัง blocked. Chatwoot stable-identity pagination fix merge/deployแล้ว และ Repository
แก้ fresh Daily ให้ใช้ bounded `updated_within` discovery ครั้งเดียวแทน full-account two-pass; Initial และ
legacy in-progress operations ยังคง stable two-pass. PR #643 merge และ deploy แล้วบน Worker version
`9d768d22-4f96-48aa-87d7-f1dd86c991a6` ที่ traffic 100%; เหลือ fresh scheduled Daily validation โดย
ไม่ใช้ manual run แทนหลักฐาน.
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
```