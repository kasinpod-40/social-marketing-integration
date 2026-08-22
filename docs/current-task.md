# Current Task — Customer-Owned Production Provisioning v1

## Status

```text
TASK_STATUS                         = IN_PROGRESS
CURRENT_PROGRAM                     = CUSTOMER_OWNED_PRODUCTION_PROVISIONING_V1
BASE_MAIN_SHA                       = b92308ea649d0bed45c2ad893c1be2d4fef0592d
CUSTOMER_BASE_RUNTIME_READY         = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER   = NON_BLOCKING
PRODUCTION_D1_PROVISIONED           = TRUE
PRODUCTION_D1_MIGRATIONS            = 21_OF_21
PRODUCTION_D1_QUICK_CHECK           = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED   = TRUE
PRODUCTION_DLQ_PROVISIONED          = TRUE
PRODUCTION_WORKER_DEPLOYED          = FALSE
PRODUCTION_SCHEDULE_ENABLED         = FALSE
PRODUCTION_BUSINESS_TRAFFIC         = ZERO
CUSTOMER_BASE_PR_661                = ISOLATED_NO_MUTATION
GOOGLE_ADS_LIVE_PR_673              = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                   = DEFERRED_NO_MUTATION
```

## Objective

Provision the existing Social MKT Data Hub runtime into customer-owned Production infrastructure without creating a second architecture or reopening completed Integration Workspace work.

Reuse the existing shared Worker, D1 migrations, Queue/DLQ, connector, report, Lark Native AI and notification contracts. Production must remain dark until every binding, secret, table mapping and controlled verification gate is complete.

## Verified production foundation

Customer-owned Cloudflare foundation has been provisioned outside the repository:

- one Production D1 database in APAC;
- one main sync Queue;
- one DLQ;
- D1 migrations `0001` through `0021` applied exactly once;
- `d1_migrations` readback reports 21 applied migrations and no pending migration;
- `PRAGMA quick_check` returns `ok`;
- no Production Worker has been deployed yet;
- no Queue producer/consumer, Cron, connector, report or notification traffic has been opened.

Production resource IDs and credentials remain local/customer-owned and must not be committed.

## Current repository blocker

`wrangler.sync.example.jsonc` drifted behind the active Lark runtime table contract. Current runtime mapping includes `MKT_ADS_ASSET_GROUPS`, `MKT_REPORT_TOP_ADS` and `MKT_AI_REPORT_RUNS`, while the release Wrangler example omitted their environment mappings. `.dev.vars.example` also omitted the Ads Asset Groups mapping.

This workstream must close that drift before a Production config is derived from the release example.

### Required repository fix

1. Add the missing active Lark table mappings to safe release examples.
2. Add a regression derived from `LARK_TABLE_ENV` so every `LARK_TABLE_MKT_*` mapping plus protected `RAW_TikTok_Creator_Videos` must exist in both `.dev.vars.example` and `wrangler.sync.example.jsonc`.
3. Keep retired non-TikTok RAW table mappings out of the active release requirement.
4. Preserve all connector, schedule, report, notification, Storage and DLQ-redrive gates fail-closed.
5. Pass Branch Verification before merge.

## Production continuation after merge

After the deployment-contract fix is merged into `main`:

1. Refresh an isolated Production worktree to the exact merged `main` SHA.
2. Resolve current customer Lark Table IDs read-only from the customer Base using the existing customer-base tooling; do not ask for manual re-entry when the existing client can enumerate them.
3. Generate a local ignored Production Wrangler config with `MKT_ENV=production` and `MKT_CUSTOMER_PROFILE=chemistry_k`.
4. Bind the customer-owned D1 and Queue/DLQ.
5. Keep Cron triggers absent for the initial dark deployment and keep all business/schedule/report/notification gates false.
6. Set required Production secrets through Wrangler/secret storage only; never commit or print them.
7. Run deploy dry-run and runtime/config validation.
8. Deploy the Worker dark and verify exact version/bindings with zero business traffic.
9. Execute one bounded manual sync and verify D1↔Lark readback.
10. Repeat the exact scope to prove idempotency.
11. Verify retry, lock, DLQ and controlled replay behavior.
12. Verify Report materialization → Lark Native AI → notification using the existing shared system.
13. Enable Production schedules only after all controlled gates pass, then verify the first scheduled execution.

## Safety rules

- Never push directly to `main`.
- Never commit Production resource IDs, tokens, secrets, customer credentials or local Wrangler config.
- Do not reuse or overwrite the user's default Cloudflare login; Production uses an isolated named Wrangler auth profile/worktree.
- Do not touch PR #661 Base migration state while provisioning Cloudflare Production.
- Do not mutate the protected Lark Native TikTok source table.
- Do not touch PR #673 Google Ads live runner or its worktree.
- TikTok Ads remains deferred under PR #220.
- Do not deploy a Worker while this repository deployment-contract blocker is open.
- Do not enable Cron/schedules before controlled Production verification is complete.
