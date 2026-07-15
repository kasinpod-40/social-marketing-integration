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

1. Put authorized `YOUTUBE_CHANNEL_ID`, Public API key and optional Owner Analytics OAuth only in `.dev.vars`/Cloudflare Secrets.
2. Keep `MKT_CONNECTOR_YOUTUBE_ENABLED=false` and all YouTube schedules absent/disabled.
3. Run:

```bash
npm run preflight:youtube
npm run setup:youtube-schema
CONFIRM_WRITE=YES npm run setup:youtube-schema:apply
```

4. Copy returned three RAW Table IDs into ignored local `wrangler.sync.jsonc`.
5. Verify `MKT_Accounts`, `MKT_Content`, `MKT_Content_Daily`, Sync Log and System Alerts IDs are real and unique.

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

UAT order:

1. Public Channel/uploads/video preflight
2. First Full sync
3. Idempotent rerun
4. Recent-window incremental update
5. Manual/periodic Full reconciliation
6. Video ID returned by Playlist but absent from `videos.list`
7. Previously observed Video disappears
8. Channel identity mismatch
9. Quota exhaustion versus rate-limit/server retry
10. Distributed lock collision/renewal
11. Retry exhaustion → DLQ/System Alert
12. Verify RAW, Canonical, Account, Sync Log and warning rows in Lark
13. Enable Owner Analytics separately and test a small Pacific-date range

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
