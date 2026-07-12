# 10 — Next Actions

## Current gate: TikTok Organic Report v0.7.1

Steps 1–6 of the original roadmap are complete in Live DEV. v0.7.1 closes the code-level report/reliability blockers found in the v0.7.0 review. The next gate is Step 7 Lark schema + Live DEV UAT, and Report schedule must remain disabled until all items below pass.

1. Untrack local config once with `git rm --cached wrangler.sync.jsonc`, then confirm `npm run check`, full tests, and Wrangler dry-run pass.
2. Apply the Lark schema changes from `docs/tiktok-organic-report-blueprint-v0.7.0.md` and the release Excel Blueprint.
3. Create `MKT_Report_Metric_Values` and `MKT_Report_Top_Content`; set their stable-key fields as Primary.
4. Extend `MKT_Metric_Definitions`, `MKT_Report_Settings`, and `MKT_Report_Snapshots` exactly as specified.
5. Configure the two new Lark Table IDs in `wrangler.sync.jsonc`.
6. Run `CONFIRM_WRITE=YES npm run seed:metrics` and rerun to prove idempotency.
7. Run `MKT_CUSTOMER_PROFILE=dev_ft_pumkin CONFIRM_WRITE=YES npm run seed:report-settings` and rerun.
8. Send a manual `report.daily.generate` Queue job and validate all three output tables plus `MKT_Sync_Log`.
9. Rerun the same period and confirm all output rows are skipped/updated without duplicates.
10. Send `report.weekly.generate`; validate cumulative delta, previous-period comparison, partial-baseline flag, and Top Content ranking.
11. Create client-facing Lark views and hide RAW/Daily/Sync/System views from client roles.
12. Enable Daily/Weekly report schedules only after Live DEV UAT passes.

## After Step 7

1. Lark AI summary + Lark group notification.
2. Facebook / Instagram / YouTube Organic.
3. Meta Ads / TikTok Ads / Google Ads as a separate Ads workstream.
4. WooCommerce.
5. Chatwoot.
6. Production setup using customer-owned Lark, Cloudflare, apps, credentials, and platform assets.
