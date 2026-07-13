# 10 — Next Actions

## Current gate: Lark Report Schema Installer v0.8.2

Steps 1–6 are complete in Live DEV. v0.8.2 fixes Number formatter request bodies after v0.8.1 Apply failed before the first action. Report schedule must remain disabled until every gate below passes.

1. Run `npm run setup:report-schema` in Preview mode.
2. Review `readyToApply`, `conflicts`, `warnings`, `manualActions`, and `environmentUpdates`.
3. Resolve every type conflict, ambiguous table, or missing configured Table ID before writing.
4. Run `CONFIRM_WRITE=YES npm run setup:report-schema:apply` only when Preview is ready.
5. Copy returned Table IDs into local `wrangler.sync.jsonc`; never commit that file.
6. Run Preview again; it must show zero write actions and zero conflicts.
7. Review any `PRIMARY_FIELD_REVIEW_REQUIRED` items in Lark UI.
8. Run `CONFIRM_WRITE=YES npm run seed:metrics` twice to prove idempotency.
9. Run `MKT_CUSTOMER_PROFILE=dev_ft_pumkin CONFIRM_WRITE=YES npm run seed:report-settings` twice.
10. Send manual `report.daily.generate`; validate Snapshots, Metric Values, Top Content, and Sync Log.
11. Rerun the same period and confirm no duplicate rows.
12. Send manual `report.weekly.generate`; validate cumulative delta, comparison, baseline coverage, and ranking.
13. Create client-facing Views/Permissions; hide RAW/Daily/Sync/System tables from client roles.
14. Enable Daily/Weekly schedules only after Live DEV UAT passes.

## After Step 7

1. Lark AI summary + Lark group notification.
2. Facebook / Instagram / YouTube Organic.
3. Meta Ads / TikTok Ads / Google Ads as a separate Ads workstream.
4. WooCommerce.
5. Chatwoot.
6. Production setup using customer-owned Lark, Cloudflare, apps, credentials, and platform assets.
