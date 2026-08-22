# Current Task — Customer-Owned Production Provisioning v1

## Status

```text
TASK_STATUS                              = IN_PROGRESS
CURRENT_PROGRAM                          = CUSTOMER_OWNED_PRODUCTION_PROVISIONING_V1
BASE_MAIN_SHA                            = b85649fb0f4e5da69624fbc35b8b39a9cb149880
CUSTOMER_BASE_RUNTIME_READY              = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER        = NON_BLOCKING
PRODUCTION_D1_PROVISIONED                = TRUE
PRODUCTION_D1_MIGRATIONS                 = 21_OF_21
PRODUCTION_D1_QUICK_CHECK                = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED        = TRUE
PRODUCTION_DLQ_PROVISIONED               = TRUE
PRODUCTION_WORKER_DEPLOYED               = TRUE_DARK
PRODUCTION_WORKER_HEAD                   = b85649fb0f4e5da69624fbc35b8b39a9cb149880
PRODUCTION_QUEUE_CONSUMERS               = MAIN_1_DLQ_1
PRODUCTION_SCHEDULE_ENABLED              = FALSE
PRODUCTION_BUSINESS_TRAFFIC              = CONTROLLED_BOOTSTRAP_AND_FAILED_TIKTOK_UAT_ONLY
PRODUCTION_QUEUE_LARK_BOOTSTRAP_SMOKE    = PASS_IDEMPOTENT
PRODUCTION_CONNECTOR_UAT_ADMISSION       = MERGED_PR_677
TIKTOK_PRODUCTION_UAT                    = FAILED_BEFORE_BUSINESS_WRITE
TIKTOK_PRODUCTION_UAT_FAILURE            = LARK_CLIENT_PROGRAMMING_ERROR_ON_MKT_CONTENT_DAILY_SEARCH
TIKTOK_PRODUCTION_UAT_SOURCE_WRITE       = ZERO
TIKTOK_PRODUCTION_UAT_TARGET_WRITE       = ZERO
TIKTOK_PRODUCTION_UAT_DLQ                = ONE_OPEN_RETAIN_FOR_REPLAY
PRODUCTION_DARK_STATE_RESTORED           = TRUE
CURRENT_REPAIR_BRANCH                    = work/lark-transport-error-classification-v1
CUSTOMER_BASE_PR_661                     = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                        = DEFERRED_NO_MUTATION
```

## Objective

Provision the existing Social MKT Data Hub runtime into customer-owned Production infrastructure without creating a second architecture or reopening completed Integration Workspace work.

Reuse the existing shared Worker, D1 migrations, Queue/DLQ, connector, report, Lark Native AI and notification contracts. Production schedules remain off until bindings, secrets, table mappings, connector UAT, report/AI/notification verification and first controlled scheduled proof are complete.

## Verified Production foundation

Customer-owned Production has passed these external gates:

- Production D1 exists in the customer Cloudflare account;
- migrations `0001` through `0021` applied exactly once;
- `d1_migrations` reports 21 applied migrations and no pending migration;
- `PRAGMA quick_check` returns `ok`;
- main Queue and DLQ exist;
- Worker `social-mkt-sync-worker` is dark-deployed from exact source head `b85649fb0f4e5da69624fbc35b8b39a9cb149880`;
- main Queue and DLQ each have exactly one Worker consumer;
- `workers_dev=false`, no Cron trigger, no route;
- required Lark App secret is configured in customer-owned Cloudflare secret storage;
- customer Base mappings resolve to `✨Marketing Content Calendar`;
- protected `RAW_TikTok_Creator_Videos` remains a read-only source.

Production resource IDs and credentials remain local/customer-owned and must not be committed.

## Verified Queue → Worker → Customer Lark bootstrap smoke

The controlled non-connector `report.settings.seed` Production smoke passed before connector admission:

- before run: zero `chemistry_k` report-setting rows and zero dead letters;
- first Queue job created exactly 74 canonical `chemistry_k` report settings;
- first run dead-letter delta = 0;
- exact same Queue payload was submitted a second time;
- rerun created 0 records and changed 0 records;
- Production report-setting row count remained 74;
- rerun dead-letter delta = 0;
- protected TikTok source write count = 0;
- connector/schedule/notification/AI enable count = 0.

Therefore customer-owned Queue → Worker → Lark infrastructure and stable-key idempotency are externally proven independently of connector UAT.

## Controlled Production connector-UAT admission

PR #677 merged the reviewed fail-closed UAT lane at `b85649fb0f4e5da69624fbc35b8b39a9cb149880`.

Contract remains:

1. Normal Production execution still requires `largeAccount.productionReady=true`.
2. Controlled UAT requires all of:
   - `MKT_ENV=production` / `chemistry_k`;
   - connector feature flag enabled;
   - connector status `dev_ready` with only `liveAccountUat` pending;
   - `MKT_PRODUCTION_CONNECTOR_UAT_ENABLED=true`;
   - exact connector selector match;
   - canonical Queue trigger `production_connector_uat`.
3. Planned/foundation-ready connectors remain blocked.
4. Scheduled and legacy triggers cannot consume the exception.
5. Release examples keep UAT admission disabled by default.
6. No readiness promotion occurs before retained live evidence.
7. No Production Cron is enabled during UAT.

## TikTok Production UAT incident — 2026-08-22

TikTok Creator was the first adopter because catalog readiness is `dev_ready` and only `liveAccountUat` is pending.

The first customer-owned Production attempt proved that admission and Queue routing work, but the sync failed before any business write:

- one `tiktok.creator.native.sync` Queue job used trigger `production_connector_uat`;
- reliability run started under `chemistry_k` / `tiktok` / `native_import`;
- failure occurred while searching existing records in logical target `MKT_Content_Daily`;
- error code was `LARK_CLIENT_PROGRAMMING_ERROR`;
- `records_pulled`, `records_created`, `records_updated`, `records_skipped`, and `records_written` all remained `0`;
- one terminal DLQ record and critical reliability evidence were retained;
- the protected Native TikTok source was not written;
- the UAT connector flag, UAT admission flag, selector, schedules, AI and notifications were restored to the dark state after the failure.

Do not replay the retained DLQ or resolve the incident alerts until the shared Lark transport-classification repair is reviewed, merged and deployed.

## Current repair — shared Lark transport classification

Repository evidence shows `LarkBitableClient` currently treats only `TypeError` as a generic network failure in `normalizeRequestError()`. A non-`RuntimeError` exception from the actual Fetch/response-body transport boundary therefore falls through to permanent `LARK_CLIENT_PROGRAMMING_ERROR` and can terminalize a Queue message without normal transient retry.

This is the current repair hypothesis. Per the live verification rule, it becomes the confirmed root cause only after the retained Production DLQ is replayed on the reviewed fix and the same logical read proceeds successfully.

Required implementation contract:

1. Request-body serialization happens before the network transport boundary.
2. Serialization failure is permanent and must not invoke Fetch or retry as a network failure.
3. Any non-`RuntimeError` thrown by `fetch()` or `response.text()` inside the transport boundary is normalized to retryable `LARK_NETWORK_ERROR`, regardless of JavaScript Error subclass.
4. Timeout remains `LARK_REQUEST_TIMEOUT`.
5. Existing Lark `RuntimeError` classifications are preserved.
6. Errors outside the transport boundary remain fail-closed as programming errors.
7. App token/path sanitization remains unchanged.
8. Ambiguous Create semantics remain unchanged; internal retry is still controlled by the existing retry mode.

## Required tests for current repair

- plain `Error` from Fetch transport is `LARK_NETWORK_ERROR` and a read request can retry/recover;
- plain `Error` from response-body reading is `LARK_NETWORK_ERROR`;
- non-serializable request body is permanent `LARK_REQUEST_SERIALIZATION_ERROR` and Fetch is never started;
- token/path sanitization remains intact;
- existing Lark connector tests remain green;
- `npm run check`;
- `npm test`;
- `npm run test:report-reliability`;
- `npm audit`;
- `npm run deploy:dry-run`.

## Recovery after reviewed merge

1. Refresh isolated Production worktree to exact reviewed `main`.
2. Deploy the reviewed Worker in dark state; Cron remains absent.
3. Enable only TikTok + controlled Production-UAT admission for the recovery window.
4. Use the existing reviewed DLQ/redrive contract to replay the retained failed payload; do not create an unrelated replacement architecture.
5. Verify TikTok run success, D1 reliability state, Customer Lark `MKT_Accounts` / `MKT_Content` / `MKT_Content_Daily`, and protected source zero-write.
6. Run the same logical scope again and prove stable-key idempotency.
7. Resolve retained incident state only through existing reviewed reliability/redrive semantics after recovery is verified.
8. Restore TikTok/UAT/redrive gates to false.
9. Promote TikTok `liveAccountUat=true` in a separate reviewed readiness PR only after external evidence passes.
10. Continue other eligible connectors and enable schedules last.

## Safety rules

- Never push directly to `main`.
- Never commit Production resource IDs, tokens, secrets, customer credentials or local Wrangler config.
- Do not reuse or overwrite the user's default Cloudflare login; Production uses the isolated named Wrangler auth profile/worktree.
- Do not touch PR #661 Base migration state while provisioning Cloudflare Production.
- Do not mutate the protected Lark Native TikTok source table.
- TikTok Ads remains deferred under PR #220.
- Do not fake `largeAccount.productionReady` or `liveAccountUat` before external evidence exists.
- Do not create a generic Production bypass around `assertConnectorRunnable()`.
- Do not replay the retained failed TikTok payload before the reviewed repair is deployed.
- Do not resolve retained failure evidence before successful recovery verification.
- Do not enable Cron/schedules before controlled Production verification is complete.

## Implementation result

In progress on `work/lark-transport-error-classification-v1`:

- shared Lark client separates request serialization from the transport boundary;
- transport exceptions are normalized at the boundary instead of inferred later from `TypeError` only;
- focused regression coverage is being added;
- Production remains dark and no Cloudflare/Lark/D1/Queue mutation is performed by this code-change workstream.
