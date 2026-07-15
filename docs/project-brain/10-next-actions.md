# 10 — Next Actions

## Shared task workflow

ChatGPT Work and Codex share `docs/current-task.md`. The six-part Multi-channel foundation is implemented and recorded there; all unverified connectors remain fail-closed.

## Clean candidate verification for v0.10.2-rc.1

Preserve local `.dev.vars` and `wrangler.sync.jsonc`, then verify the source tree with:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run
npm audit --offline
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.10.2-rc.1.zip
```

### 1. Client Views — completed and live-verified

```bash
npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply
npm run setup:report-views
```

Final Preview on 2026-07-14 showed zero create/update actions and zero conflicts. Filter and Hidden fields are installed. Lark UI Sort `rank` ascending with Automatic sorting is saved and verified for:

- `📊 Client Metrics` (safe combined default)
- `📊 Daily Metrics`
- `📈 Weekly Metrics`
- `🏆 Top Content` (safe combined default)
- `🏆 Daily Top Content`
- `🏅 Weekly Top Content`

Advanced Permissions is enabled and the saved `Client` role uses View only for `MKT_Report_Metric_Values`/`MKT_Report_Top_Content`, with No access for Daily, AI technical, Sync/System, and all RAW tables. No DEV member is assigned; customer Production must map real client members.

### 2. Enable and deploy scheduled reports — completed

```bash
npm run enable:tiktok-report-schedules
CONFIRM_WRITE=YES npm run enable:tiktok-report-schedules:apply
npx wrangler deploy --config wrangler.sync.jsonc
```

Both flags are `true`; Worker version `ba6f3968-628c-4c61-b7eb-62647b38f547` deployed successfully on 2026-07-14.

### 3. Operational observation

- First post-deploy cron passed at 22:01 Asia/Bangkok with `status=success`, `skipped=40`, and no error.
- Observe a scheduled Daily report at 08:10 Asia/Bangkok.
- Observe a scheduled Weekly report on Monday at 08:15 Asia/Bangkok.
- No manual failure injection is required; deterministic tests cover first-write failure and partial-write/retry safety.
- Weekly complete-baseline observation follows naturally after enough prior-period snapshots exist.

## Remaining TikTok operations

- Observe the naturally due Daily report at 08:10 Asia/Bangkok.
- Observe the naturally due Weekly report on Monday at 08:15 Asia/Bangkok.
- Confirm Weekly changes from `partial` to `complete` after enough comparison-period snapshots accumulate.
- These are operational observations and do not block the next connector workstream.

## Next workstream after v0.10.2-rc.1

1. Supply an authorized DEV YouTube Channel ID and API/OAuth credential outside source control.
2. Run YouTube identity/source preflight and compare real payloads with `youtube-organic-v1`.
3. Review `Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.1.xlsx` and Apply the three YouTube RAW tables, then add real Table IDs to local config.
4. Complete Manual YouTube sync, rerun idempotency, reconciliation and reliability UAT before changing `uat_pending` to `active`.
5. Open Meta App/Page/Instagram permissions in parallel; then add separate Facebook and Instagram business adapters over the shared transport.
6. Connect WooCommerce and Chatwoot only after their sanitized fixtures are validated against authorized DEV payloads.
7. Validate Ad/Creative and money-micros mappings with sandbox payloads before building Meta/TikTok/Google Ads adapters over Canonical Ads v2.
8. Add Lark AI Summary + Lark Group Notification after at least two organic sources are Live-verified.
9. Run final cross-channel DEV regression and documentation.
10. Customer Production setup later using customer-owned Lark, Cloudflare, apps, credentials, and platform assets.
