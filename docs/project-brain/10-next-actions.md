# 10 — Next Actions

## Immediate closeout commands for v0.9.5

Preserve local `.dev.vars` and `wrangler.sync.jsonc`, then run:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run
```

### 1. Client Views — completed and live-verified

```bash
npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply
npm run setup:report-views
```

Final Preview on 2026-07-14 showed zero create/update actions and zero conflicts. Follow each `VIEW_HIDDEN_FIELDS_REVIEW_REQUIRED` manual action and set `rank` ascending for:

- `📊 Client Metrics` (safe combined default)
- `📊 Daily Metrics`
- `📈 Weekly Metrics`
- `🏆 Top Content` (safe combined default)
- `🏆 Daily Top Content`
- `🏅 Weekly Top Content`

### 2. Enable and deploy scheduled reports

```bash
npm run enable:tiktok-report-schedules
CONFIRM_WRITE=YES npm run enable:tiktok-report-schedules:apply
npx wrangler deploy --config wrangler.sync.jsonc
```

Confirm local config has both flags `true`, remains untracked, and Worker deploy succeeds.

### 3. Operational observation

- Observe a scheduled Daily report at 08:10 Asia/Bangkok.
- Observe a scheduled Weekly report on Monday at 08:15 Asia/Bangkok.
- No manual failure injection is required; deterministic tests cover first-write failure and partial-write/retry safety.
- Weekly complete-baseline observation follows naturally after enough prior-period snapshots exist.

## Next workstream after TikTok closeout

1. Lark AI Summary + Lark Group Notification.
2. Open DEV access/preflight for YouTube, Meta, Google Ads, TikTok Ads, WooCommerce, and Chatwoot in parallel.
3. YouTube Organic connector.
4. Facebook + Instagram Organic through a shared Meta connector/auth layer.
5. WooCommerce and Chatwoot.
6. Ads data model/connectors.
7. Final cross-channel DEV regression and documentation.
8. Customer Production setup later using customer-owned Lark, Cloudflare, apps, credentials, and platform assets.
