# Current Task — YouTube Organic DEV Implementation v0.11.0-rc.1

## Task metadata

- **Status:** `implementation_complete_pending_external_dev_access_and_live_uat`
- **Official clean baseline:** `v0.10.2-multi-channel-foundation-approved`
- **Working candidate:** `v0.11.0-rc.1`
- **Blueprint:** `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`
- **Connector status:** `uat_pending`
- **Schedule:** `disabled`
- **Last updated:** `2026-07-15`
- **Owners:** ChatGPT Work (technical review/release) + developer (DEV credentials and guarded live execution)

## Objective

ทำ YouTube Organic DEV implementation ตาม Blueprint ที่ผ่าน Technical review โดยเพิ่มเส้นทาง Manual UAT ที่ Fail-closed, ใช้ Reliability layer เดิม และยังไม่เปิด Scheduled/Production traffic.

## Approved contracts

- RAW latest-state: `RAW_YouTube_Channels`, `RAW_YouTube_Videos`
- Owner Analytics period facts: `RAW_YouTube_Analytics_Daily` แบบ RAW-only ใน Phase 1
- Channel → `MKT_Accounts`
- Video current state → `MKT_Content`
- Data API cumulative snapshot → `MKT_Content_Daily`
- Stable key/date/null/reconciliation contracts ยึด Blueprint v0.10.2
- Missing/private/deleted candidate ต้อง retain row/metrics, ไม่ลบและไม่เติมศูนย์
- Analytics ใช้ exact Pacific `source_metric_date`, `sort=day,video`, bounded batching/pagination

## Implemented in this candidate

1. Generic Lark Schema Preview/Apply engine ที่รับ Schema contract ได้หลายชุด โดยรักษา Report compatibility
2. YouTube RAW three-table installer ที่ derive จาก Blueprint กลาง
3. Guarded commands:
   - `npm run setup:youtube-schema`
   - `CONFIRM_WRITE=YES npm run setup:youtube-schema:apply`
4. YouTube DEV access preflight สำหรับ Public Data API และ optional Owner Analytics OAuth
5. API key / OAuth refresh-token runtime clients พร้อม cache และ placeholder rejection
6. RAW Channel, Video และ Analytics mapping พร้อม response-grain validation
7. `MKT_Accounts`, `MKT_Content`, `MKT_Content_Daily` destination plans โดย Plan ทุกตารางก่อน Write และเขียน Account เป็นลำดับสุดท้าย
8. Manual Queue job `youtube.channel.organic.sync` ที่รันได้เฉพาะ `trigger=manual_uat`
9. Separate UAT gate `MKT_CONNECTOR_YOUTUBE_UAT_ENABLED=true` ขณะที่ normal `MKT_CONNECTOR_YOUTUBE_ENABLED=false`
10. D1 checkpoint, recent-window incremental mode และ periodic full reconciliation
11. Reuse Sync Log, distributed lock/renewal, bounded retry, DLQ และ System Alerts
12. Reconciliation warning หลังรอบสำเร็จเมื่อ Video resource หาย โดยไม่ทำให้ Queue retry ซ้ำ
13. Dry-run/manual payload helper `npm run job:youtube-uat`
14. No YouTube Scheduler producer
15. Analytics reconciliation ตรวจเฉพาะ Stable keys ที่เคยพบใน Video/ช่วงวันที่ที่ re-fetch จริง; แถวที่หายถูก retain และสร้าง `YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED`
16. D1 warning alert เป็น Primary gate จริง: Persist ไม่สำเร็จกลายเป็น Retryable failure และ Queue ห้าม Ack
17. Operational redaction กลางสำหรับ Worker logs, D1 payload/error และ Lark reliability mirror โดยไม่เปิดเผย Channel/Video/Handle/Lock identity
18. Release examples ใช้ Placeholder เท่านั้นและ Repository hygiene ไม่มี macOS metadata

## External actions intentionally not executed

- ไม่ Apply/แก้ Lark DEV Base เพราะไม่มี authorized Lark credential/local Table IDs ใน Source artifact
- ไม่เรียก YouTube API เพราะยังไม่มี authorized DEV Channel ID/API key/OAuth ใน Session
- ไม่ Deploy Cloudflare Worker
- ไม่ส่ง Queue message จริง
- ไม่เปลี่ยน YouTube จาก `uat_pending` เป็น `active`
- ไม่เปิด Schedule, Meta หรือ Production

## Required DEV inputs outside Source control

- `YOUTUBE_CHANNEL_ID` ของช่องที่ได้รับอนุญาตให้ทดสอบ
- `YOUTUBE_API_KEY` สำหรับ Public Data API หรือ OAuth credential ที่ใช้แทน
- Owner Analytics OAuth: client ID, client secret และ refresh token เมื่อต้องทดสอบ Analytics
- Lark App credential/app token และ Local Table IDs หลัง Schema Apply
- Secrets ต้องอยู่ใน `.dev.vars`, Cloudflare Secrets หรือ Secret Manager เท่านั้น

## Live execution order

1. เติม Local credentials และ Channel allowlist
2. `npm run preflight:youtube`
3. `npm run setup:youtube-schema` เพื่อ Preview
4. ตรวจ Plan แล้วใช้ `CONFIRM_WRITE=YES npm run setup:youtube-schema:apply`
5. ใส่ Table IDs ที่คืนมาใน ignored `wrangler.sync.jsonc`
6. Deploy DEV Worker โดย UAT flag เท่านั้น; normal YouTube flag และ Schedule คง false
7. Enqueue Manual UAT job จาก `npm run job:youtube-uat`
8. ทดสอบ First sync, idempotent rerun, incremental, full reconciliation, Analytics missing-key, identity mismatch, quota/rate-limit, D1 alert failure, lock/retry/DLQ และข้อมูลใน Lark
9. เปลี่ยน Connector เป็น `active` และออกแบบ Schedule เฉพาะหลัง Live DEV UAT ผ่าน

## Acceptance and verification

- Unit/Integration: 376/376 passed
- Workers runtime: 6/6 passed
- Focused Report reliability: 53/53 passed
- Focused YouTube/Reliability/Redaction: 37/37 passed
- Architecture: 109 source files / 230 local dependencies / 0 cycles
- Repository hygiene: passed
- npm audit: 0 vulnerabilities
- Wrangler dry-run: 443.78 KiB / gzip 90.89 KiB passed
- Clean archive extraction retest: `npm ci`, check, Unit 376/376, Workers 6/6, reliability 53/53, audit 0 และ dry-run ผ่าน; Archive verifier พบ blocked/missing/sensitive/duplicate = 0
- Live DEV UAT: `not_started_missing_external_access`

## Implementation result

- **Implementation:** แก้ Release example/hygiene และ packager, เติม previously-observed Analytics reconciliation, บังคับ D1 warning alert failure ให้ Retry และเพิ่ม Operational identity redaction กลาง
- **Files changed:** YouTube sync/adapters/preflight, Reliability runner/D1/Lark stores, API/Sync Workers, safe environment example, Release tooling, focused tests และเอกสาร handoff; ลบ Blueprint สำเนาซ้ำที่เนื้อหาเหมือน canonical file
- **Commands run:** `npm ci`, `npm run check`, `npm run test:unit`, `npm run test:worker`, `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, focused Node tests, `npm run release:package` และ `npm run release:verify -- ...zip`; ทำ gates ซ้ำจาก fresh ZIP extraction
- **Tests:** Source และ extracted-archive gates ด้านบนผ่านทั้งหมด; Workers runtime ต้องรันนอก filesystem/network sandbox เพราะ Miniflare เปิด loopback listener
- **Live UAT:** ไม่ได้เรียก YouTube/Lark API, ไม่ Apply Schema, ไม่ส่ง Queue จริง และไม่ Deploy
- **Remaining risks:** ต้องยืนยัน Analytics missing-key/re-fetch กับ Live payload, D1 retry/Alert ใน DEV Worker และตรวจข้อมูล retain จริงใน Lark ก่อน Activation
- **Recommended commit:** `fix: harden YouTube reconciliation and reliability`

## Work review

- **Technical architecture:** approved for Manual DEV UAT
- **Data model:** approved — Blueprint v0.10.2
- **Release decision:** package as `v0.11.0-rc.1`; do not promote YouTube to active
- **Recommended commit:** `fix: harden YouTube reconciliation and reliability`
