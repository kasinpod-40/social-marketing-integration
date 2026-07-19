# 10 — Next Actions

## Shared task workflow

ChatGPT Work and Codex share `docs/current-task.md`. YouTube large-account patch active ใน DEV และ smoke ผ่านกับช่อง 2 videos แต่ Customer 837-video Live UAT ยังไม่รัน. All other unverified connectors remain fail-closed.

## Immediate post-review handoff

1. Completed: Commit/Push `44377ce`, Apply migration 0004, Deploy DEV patch และ Full/Incremental/Analytics smoke กับ DEV channel 2 videos
2. Keep Production disabled; ห้ามตีความ DEV 2-video smoke หรือ deterministic 837 fixture เป็น Customer 837-video Live UAT
3. เตรียม Customer-owned Channel, matching Owner OAuth, Lark Base และ Cloudflare DEV/Staging profile แยกจาก developer resources
4. รัน Initial Full และยืนยัน tracked inventory 837, 17 playlist pages/17 resource chunks, checkpoint 837 และ no duplicate
5. รัน Content incremental 100 + Analytics tracked/selected/queried 837 พร้อม failed=0/completeness=`complete`
6. ทดสอบ Live retry/resume กลาง page/chunk แบบควบคุมได้โดยไม่ทำลาย Provider/Lark data
7. Observe one natural 07:50 Asia/Bangkok Analytics run ใน environment 837 และยืนยัน counters/alerts
8. งาน Instagram/Facebook/TikTok ถัดไปต้องสร้าง large-account fixtures และ reuse `sync_work_*`

## Clean candidate verification for v0.11.0

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.11.0.zip
```

## YouTube DEV access and schema

Status 2026-07-19: Public/Owner preflight, three-table Lark Schema Apply, DateTime/Permission verification, Queue/Reliability UAT, activation deployment and Active smoke test passed. Local Table IDs are stored only in ignored `wrangler.sync.jsonc`.

Completed setup reference:

```bash
npm run preflight:youtube
npm run setup:youtube-schema
CONFIRM_WRITE=YES npm run setup:youtube-schema:apply
```

Destination/Sync Log/System Alert mappings ถูกตรวจว่าเป็นค่าจริงและไม่ซ้ำแล้ว. Release examples ยังปิดทุก flag; ignored DEV config เปิดเฉพาะ environment ที่ผ่าน UAT แล้ว.

## Active DEV operations

DEV activation policy:

```text
MKT_CONNECTOR_YOUTUBE_ENABLED=true
MKT_SCHEDULE_YOUTUBE_ENABLED=true
MKT_YOUTUBE_ANALYTICS_ENABLED=true
MKT_YOUTUBE_ANALYTICS_TIME=07:50
MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS=7
```

Generate an optional manual active job body:

```bash
npm run job:youtube-sync
```

Core UAT ที่ผ่านแล้ว:

1. Public Channel/uploads/video และ Owner OAuth preflight
2. First Full sync
3. Idempotent Full rerun
4. Checkpoint-driven recent-window incremental update
5. Manual Full reconciliation ในสภาพไม่มี missing resource
6. Owner Analytics small Pacific-date range แบบ valid no-data
7. Verify RAW, Canonical, Account, Sync Log และ System Alert counts ใน Lark

Reliability fault cases ที่ผ่าน Live DEV:

1. Distributed lock collision → bounded retry → success และ cleanup
2. Controlled timeout → retry exhaustion → DLQ → D1/Lark Critical Alert
3. Safe restore → retry-0 healthy run และ Test incident retained as `resolved`
4. Live OAuth read-only identity mismatch → Permanent classification + redaction

Production-path deterministic cases ที่ผ่าน:

1. Playlist ID absent from `videos.list` และ previously observed Video disappears → retain/no-delete/no-zero
2. Previously observed Analytics Stable key disappears on exact re-fetch while never-observed gaps remain silent
3. Quota exhaustion เป็น terminal; rate-limit/server failure เป็น bounded retry
4. D1 warning-alert persistence failure → Retry and no Queue Ack
5. Lease renewal/loss, retry routing, DLQ persistence และ Alert mirror/redaction

ไม่จงใจสร้าง actual Provider missing/private/deleted, เผา quota, บังคับ 429 หรือทำ D1 outage. ให้เฝ้าดู scenario เหล่านี้เมื่อเกิดตามธรรมชาติและใช้ Alert/Runbook เดิม.

## Completed activation

- YouTube connector/job เป็น `active`
- Data API Cron: `50 0,6,12,18 * * *` (ทุก 6 ชั่วโมง)
- Analytics: วันละครั้ง 07:50 Asia/Bangkok, query 7 completed Pacific dates
- Worker version: `2037232c-152a-4e26-95fa-fca044f65bd9`
- Post-patch Data API และ Owner Analytics smoke: success/retry 0; Analytics tracked/selected/queried 2/2/2 complete, staging/lock/open alert 0 และ Lark duplicates 0

Next work must not silently expand into Meta, WooCommerce, Chatwoot, Ads activation or Lark AI notification.

## TikTok parallel operations

- Continue observing Daily report at 08:10 Asia/Bangkok.
- Continue observing Weekly report Monday 08:15 Asia/Bangkok.
- These observations do not block the completed YouTube activation.

## Production ownership

Customer Production must use customer-owned Lark Base/App, Cloudflare/D1/Queues, Google project/OAuth credentials and YouTube assets. DEV identifiers and credentials must never be copied into a Production profile or release ZIP.
