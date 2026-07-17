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

Status 2026-07-17: Public/Owner preflight, three-table Lark Schema Apply และ Manual Queue core happy path passed. Local Table IDs are stored only in ignored `wrangler.sync.jsonc`.

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

Reliability fault cases ที่ยังต้องทำ:

1. Video ID returned by Playlist but absent from `videos.list`
2. Previously observed Video disappears
3. Previously observed Analytics Stable key disappears on exact re-fetch while never-observed gaps remain silent
4. Channel identity mismatch without Channel/Video identity in Worker/D1/Lark operational output
5. Quota exhaustion versus rate-limit/server retry
6. D1 warning-alert persistence failure → Retry and no Queue Ack
7. Distributed lock collision/renewal
8. Retry exhaustion → DLQ/System Alert

## Activation gate

Only after every Live DEV UAT item passes:

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
