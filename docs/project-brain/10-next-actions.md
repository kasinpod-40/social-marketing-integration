# 10 — Next Actions

## Shared task workflow

ChatGPT Work and Codex share `docs/current-task.md`. The YouTube foundation is approved and v0.11.0-rc.1 implements only a guarded Manual DEV UAT path. All unverified connectors remain fail-closed.

## Clean candidate verification for v0.11.0-rc.1

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.11.0-rc.1.zip
```

## YouTube DEV access and schema

Status 2026-07-17: Public/Owner preflight, three-table Lark Schema Apply, DateTime/Permission verification, Manual Queue core และ safe Reliability fault UAT passed. Local Table IDs are stored only in ignored `wrangler.sync.jsonc`.

Completed setup reference:

```bash
npm run preflight:youtube
npm run setup:youtube-schema
CONFIRM_WRITE=YES npm run setup:youtube-schema:apply
```

Destination/Sync Log/System Alert mappings ถูกตรวจว่าเป็นค่าจริงและไม่ซ้ำแล้ว. Keep `MKT_CONNECTOR_YOUTUBE_ENABLED=false` and all YouTube schedules absent/disabled.

## Manual DEV UAT

Enable only the separate UAT gate:

```text
MKT_CONNECTOR_YOUTUBE_UAT_ENABLED=true
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_YOUTUBE_ANALYTICS_ENABLED=false   # first Public Data pass
```

Generate the Manual job body:

```bash
npm run job:youtube-uat
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

## Activation gate

หลัง ChatGPT Work ตรวจหลักฐานและข้อมูลรอบสุดท้ายแล้วจึงพิจารณา:

- change YouTube connector/job from `uat_pending` to `active`
- design a separately reviewed schedule and incremental Analytics date policy
- enable normal YouTube feature flag
- deploy and observe scheduled runs

Do not start Meta, WooCommerce, Chatwoot, Ads activation or Lark AI notification work inside this UAT task.

## TikTok parallel operations

- Continue observing Daily report at 08:10 Asia/Bangkok.
- Continue observing Weekly report Monday 08:15 Asia/Bangkok.
- These observations do not block YouTube Manual DEV UAT.

## Production ownership

Customer Production must use customer-owned Lark Base/App, Cloudflare/D1/Queues, Google project/OAuth credentials and YouTube assets. DEV identifiers and credentials must never be copied into a Production profile or release ZIP.
