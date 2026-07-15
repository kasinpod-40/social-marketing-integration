# 10 — Next Actions

## Shared task workflow

Before starting the next feature, ChatGPT Work must update `docs/current-task.md` with approved scope and contracts. Codex must read `AGENTS.md` and record implementation results back into the same task file. The current proposal is YouTube Organic Data Model/Access Preflight; no connector code is authorized while its status remains `ready_for_planning`.

## Clean baseline verification for v0.9.7

The v0.9.7 clean release intentionally excludes local `.dev.vars` and `wrangler.sync.jsonc`. Preserve those files on the developer machine, then verify the source tree with:

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

## Next workstream after TikTok closeout

1. Confirm and approve `docs/current-task.md`.
2. YouTube Organic Data Model + DEV access/source-contract preflight.
3. YouTube Organic connector after Blueprint approval.
4. Open Meta, Google Ads, TikTok Ads, WooCommerce, and Chatwoot DEV access/preflight in parallel.
5. Facebook + Instagram Organic through a shared Meta connector/auth layer.
6. WooCommerce and Chatwoot.
7. Lark AI Summary + Lark Group Notification after at least two organic sources are available.
8. Ads data model/connectors.
9. Final cross-channel DEV regression and documentation.
10. Customer Production setup later using customer-owned Lark, Cloudflare, apps, credentials, and platform assets.
