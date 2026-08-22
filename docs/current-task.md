# Current Task — Customer-Owned Production Provisioning v1

## Status

```text
TASK_STATUS                              = IN_PROGRESS
CURRENT_PROGRAM                          = CUSTOMER_OWNED_PRODUCTION_PROVISIONING_V1
BASE_MAIN_SHA                            = 88d7f69fe42a437bdb344893b61a2f02c7b701ca
CUSTOMER_BASE_RUNTIME_READY              = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER        = NON_BLOCKING
PRODUCTION_D1_PROVISIONED                = TRUE
PRODUCTION_D1_MIGRATIONS                 = 21_OF_21
PRODUCTION_D1_QUICK_CHECK                = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED        = TRUE
PRODUCTION_DLQ_PROVISIONED               = TRUE
PRODUCTION_WORKER_DEPLOYED               = TRUE_DARK
PRODUCTION_WORKER_HEAD                   = 88d7f69fe42a437bdb344893b61a2f02c7b701ca
PRODUCTION_QUEUE_CONSUMERS               = MAIN_1_DLQ_1
PRODUCTION_SCHEDULE_ENABLED              = FALSE
PRODUCTION_BUSINESS_TRAFFIC              = CONTROLLED_BOOTSTRAP_ONLY
PRODUCTION_QUEUE_LARK_BOOTSTRAP_SMOKE    = PASS_IDEMPOTENT
PRODUCTION_CONNECTOR_UAT                 = BLOCKED_BY_LARGE_ACCOUNT_LIVE_UAT_GATE
CUSTOMER_BASE_PR_661                     = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                        = DEFERRED_NO_MUTATION
```

## Objective

Provision the existing Social MKT Data Hub runtime into customer-owned Production infrastructure without creating a second architecture or reopening completed Integration Workspace work.

Reuse the existing shared Worker, D1 migrations, Queue/DLQ, connector, report, Lark Native AI and notification contracts. Production schedules remain off until bindings, secrets, table mappings, connector UAT, report/AI/notification verification and first controlled scheduled proof are complete.

## Verified production foundation

Customer-owned Production has now passed the following external gates:

- Production D1 exists in the customer Cloudflare account;
- migrations `0001` through `0021` applied exactly once;
- `d1_migrations` readback reports 21 applied migrations and no pending migration;
- `PRAGMA quick_check` returns `ok`;
- main Queue and DLQ exist;
- Worker `social-mkt-sync-worker` is dark-deployed from exact source head `88d7f69fe42a437bdb344893b61a2f02c7b701ca`;
- main Queue and DLQ each have exactly one Worker consumer;
- `workers_dev=false`, no Cron trigger, no route, and all connector/schedule/report/notification execution gates remain false;
- required Lark App secret is configured in customer-owned Cloudflare secret storage;
- customer Base mappings were resolved read-only from `✨Marketing Content Calendar` and the protected `RAW_TikTok_Creator_Videos` mapping remains read-only.

Production resource IDs and credentials remain local/customer-owned and must not be committed.

## Verified Queue → Worker → Customer Lark bootstrap smoke

The first controlled Production business-path smoke used the existing non-connector `report.settings.seed` job. This deliberately did not enable any connector, schedule, AI or notification gate.

Verified evidence:

- before run: zero `chemistry_k` report-setting rows and zero dead letters;
- first Queue job created exactly 74 canonical `chemistry_k` report settings;
- first run dead-letter delta = 0;
- exact same Queue payload was submitted a second time;
- rerun created 0 records and changed 0 records;
- Production report-setting row count remained 74;
- rerun dead-letter delta = 0;
- protected TikTok source write count = 0;
- connector/schedule/notification/AI enable count = 0.

Therefore the customer-owned Queue → Worker → Lark path and stable-key idempotency are externally proven before any connector is admitted.

## Current repository blocker — controlled Production connector UAT admission

Connector catalog correctly blocks normal Production execution until `largeAccount.productionReady=true`. TikTok, YouTube and WooCommerce are currently `dev_ready`: all technical/large-fixture gates are complete and only `liveAccountUat` is pending. Marking them `verified` before customer Production evidence would be false evidence, while bypassing `assertConnectorRunnable()` would weaken the safety contract.

This workstream must add one explicit fail-closed lane that lets a `dev_ready` connector perform its missing customer Production UAT without opening scheduled Production execution.

### Required contract

1. Normal Production execution remains unchanged: a connector with `productionReady=false` is rejected.
2. Controlled Production UAT is admitted only when all are true:
   - runtime is `MKT_ENV=production` / `chemistry_k`;
   - connector feature flag itself is enabled;
   - connector large-account status is `dev_ready`, meaning only `liveAccountUat` is pending;
   - dedicated Production-UAT feature flag is enabled;
   - exact connector allowlist matches the connector being executed;
   - Queue job uses the canonical `production_connector_uat` trigger.
3. `foundation_ready` and `planned` connectors remain blocked even in the UAT lane.
4. Scheduled/manual legacy triggers cannot consume the UAT exception.
5. Default examples keep the UAT feature flag false and connector allowlist empty.
6. No connector is promoted to `verified` in this change. Promotion requires retained external Production UAT evidence in a later reviewed change.
7. No Cron/schedule activation is part of this change.

### First adopter after merge

TikTok Creator is the first Production UAT candidate because it is `dev_ready`, its source is already the customer-owned Lark Native table, and its remaining large-account gate is exactly `liveAccountUat`.

The first live UAT must:

- enable only TikTok connector + controlled Production-UAT admission;
- keep all schedules, reports, notifications and unrelated connectors disabled;
- submit one bounded `tiktok.creator.native.sync` job with trigger `production_connector_uat`;
- read the protected Native TikTok table only;
- verify D1 reliability state and Customer Lark `MKT_Accounts` / `MKT_Content` / `MKT_Content_Daily` writes;
- rerun the same exact scope and prove stable-key idempotency;
- restore the temporary UAT admission gate to false after evidence capture;
- only then promote TikTok `liveAccountUat=true` / large-account status `verified` in a separate reviewed PR.

## Remaining Production continuation

After the controlled connector-UAT admission change is merged and TikTok external UAT passes:

1. promote TikTok large-account readiness from `dev_ready` to `verified` with retained evidence;
2. verify retry, lock, DLQ and controlled replay behavior;
3. verify Report materialization → Lark Native AI → notification using the existing shared system;
4. repeat the reviewed connector Production-UAT/promotion process for other eligible connectors as customer credentials/assets permit;
5. enable Production schedules only after all required controlled gates pass;
6. verify the first scheduled execution before declaring Production cutover complete.

## Safety rules

- Never push directly to `main`.
- Never commit Production resource IDs, tokens, secrets, customer credentials or local Wrangler config.
- Do not reuse or overwrite the user's default Cloudflare login; Production uses the isolated named Wrangler auth profile/worktree.
- Do not touch PR #661 Base migration state while provisioning Cloudflare Production.
- Do not mutate the protected Lark Native TikTok source table.
- TikTok Ads remains deferred under PR #220.
- Do not fake `largeAccount.productionReady` or `liveAccountUat` before external evidence exists.
- Do not create a generic Production bypass around `assertConnectorRunnable()`.
- Do not enable Cron/schedules before controlled Production verification is complete.

## Required tests for this workstream

- Connector registry: standard Production path still rejects non-verified connectors.
- Connector registry: controlled UAT admits `dev_ready` only when explicit admission is true.
- Connector registry: controlled UAT still rejects planned/foundation-ready connectors.
- Worker routing: `production_connector_uat` + exact UAT env gates admits the intended connector.
- Worker routing: wrong trigger, disabled UAT flag, wrong connector allowlist and scheduled trigger all fail closed.
- Job catalog: canonical Production UAT trigger is centralized.
- Release examples: UAT flag defaults false and connector selector defaults empty.
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Implementation result

Pending implementation on `work/production-connector-uat-admission-v1`.
