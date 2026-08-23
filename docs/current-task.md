# Current Task — Customer-Owned Production Provisioning v1

## Status

```text
TASK_STATUS                              = IN_PROGRESS
CURRENT_PROGRAM                          = CUSTOMER_OWNED_PRODUCTION_PROVISIONING_V1
BASE_MAIN_SHA                            = a2835f40eac88301f980a59868a3362a2627151b
CUSTOMER_BASE_RUNTIME_READY              = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER        = NON_BLOCKING
PRODUCTION_D1_PROVISIONED                = TRUE
PRODUCTION_D1_MIGRATIONS                 = 21_OF_21
PRODUCTION_D1_QUICK_CHECK                = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED        = TRUE
PRODUCTION_DLQ_PROVISIONED               = TRUE
PRODUCTION_WORKER_DEPLOYED               = TRUE_DARK
PRODUCTION_WORKER_HEAD                   = 673431ad618a077f039a3844355ef36ff9a231ba
PRODUCTION_QUEUE_CONSUMERS               = MAIN_1_DLQ_1
PRODUCTION_SCHEDULE_ENABLED              = FALSE
PRODUCTION_BUSINESS_TRAFFIC              = CONTROLLED_BOOTSTRAP_AND_FAILED_TIKTOK_RECOVERY_ONLY
PRODUCTION_QUEUE_LARK_BOOTSTRAP_SMOKE    = PASS_IDEMPOTENT
PRODUCTION_CONNECTOR_UAT_ADMISSION       = MERGED_PR_677
LARK_TRANSPORT_REPAIR                    = MERGED_PR_678
LARK_TRANSPORT_REPAIR_MAIN_SHA           = 62bf0aa388ffc27c91242fd29f623fdf2fca518f
TIKTOK_PRODUCTION_UAT                    = FAILED_BEFORE_BUSINESS_WRITE
TIKTOK_PRODUCTION_UAT_FAILURE            = LARK_NETWORK_ERROR_AND_INTERRUPTED_PREFLIGHT
TIKTOK_PRODUCTION_UAT_SOURCE_WRITE       = ZERO
TIKTOK_PRODUCTION_UAT_TARGET_WRITE       = ZERO
TIKTOK_PRODUCTION_UAT_DLQ                = ONE_NEW_OPEN_FORENSIC_DO_NOT_BLIND_REDRIVE
TIKTOK_DLQ_REDRIVE_SUPPORT               = MERGED_PR_679
PRODUCTION_DARK_STATE_RESTORED           = TRUE
RECOVERY_PRS_681_689_692                  = CLOSED_WITHOUT_MERGE
CUSTOMER_CLOUDFLARE_PLAN                 = FREE_CPU_OVERRIDE_UNSUPPORTED
PRODUCTION_BUSINESS_TABLES               = ZERO_ROWS_ALL_CHANNELS
PRODUCTION_CONNECTION_OAUTH_ROWS         = ZERO
PRODUCTION_NOTIFICATION_DELIVERIES       = ZERO
CUSTOMER_LARK_USER_READBACK              = BLOCKED_91403_PERMISSION
CURRENT_REPAIR_BRANCH                    = NONE_EXTERNAL_AUTHORITY_BLOCKED
CUSTOMER_BASE_PR_661                     = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                        = DEFERRED_NO_MUTATION
```

## Customer Production live handoff — 2026-08-23

Exact Customer Cloudflare authority was revalidated against account `154f6bf72740d29d7453cec7fb800d32`
with OAuth identity `dev.datahub.2026@gmail.com`. No default/fallback account is authorized.

The reviewed 300-second CPU recovery config was rejected before Queue send because the Customer
account is on the Cloudflare Free plan (`100328`, configurable CPU limit unsupported). A second
reviewed hypothesis bounded only Lark transport (`15000 ms`, one attempt) and passed both Branch
Verification runs, but failed live:

- the exact retained fef DLQ was redriven once and only once;
- no idempotency job was sent;
- two attempts ended `LARK_NETWORK_ERROR`, one invocation remained interrupted in `running`, and a
  concurrent delivery recorded `SYNC_LOCK_BUSY`;
- all business-write counters remained zero;
- after early reviewed-dark restore, the generation terminalized into one new open forensic TikTok
  DLQ with `MKT_PRODUCTION_CONNECTOR_UAT_DISABLED`;
- the new DLQ must not be replayed/redriven blindly;
- PRs #681, #689 and #692 were closed without merge as required.

Remote Worker readback after restore proves exact merged source `673431ad...`, 100% traffic,
`workers_dev=false`, no CPU override, empty UAT selector, and TikTok/UAT/redrive/daily/weekly/report/AI/
notification gates false.

Production D1 readiness remains empty beyond reliability/bootstrap state: Organic, Ads, Commerce,
Chatwoot, YouTube analytics, report materializations, connection/OAuth rows and notification deliveries
all contain zero Customer Production business rows. Only the Lark report-settings bootstrap has passed.

External authority required before execution can continue safely:

1. either upgrade the exact Customer Cloudflare account to a plan supporting the reviewed CPU ceiling,
   or explicitly authorize a separate checkpoint/sub-chunk implementation workstream for Free-plan proof;
2. grant the current Lark user access to the Customer Base (current read-only table-list fails `91403`);
3. complete fresh Customer source authorization/ownership proof: Facebook scope, YouTube Channel-owner
   OAuth consent, Google Ads OAuth + Developer Token Live access, WooCommerce API access and Chatwoot access;
4. provision reviewed connector secrets/connections into Customer Cloudflare only after each ownership
   proof passes. Local Integration credentials must not be copied merely because they exist.

Until those actions are complete, do not enable connectors, schedules, reports, AI or notifications and
do not promote catalog readiness.

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
- Worker `social-mkt-sync-worker` remains dark-deployed from reviewed source head `b85649fb0f4e5da69624fbc35b8b39a9cb149880` until the current reviewed fixes are deployed for recovery;
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

The first customer-owned Production attempt proved admission and Queue routing, but failed before any business write:

- one `tiktok.creator.native.sync` Queue job used trigger `production_connector_uat`;
- reliability run started under `chemistry_k` / `tiktok` / `native_import`;
- failure occurred while searching existing records in logical target `MKT_Content_Daily`;
- error code was `LARK_CLIENT_PROGRAMMING_ERROR`;
- `records_pulled`, `records_created`, `records_updated`, `records_skipped`, and `records_written` all remained `0`;
- one terminal DLQ record and critical reliability evidence were retained;
- the protected Native TikTok source was not written;
- the UAT connector flag, UAT admission flag, selector, schedules, AI and notifications were restored to the dark state after the failure.

Retained DLQ authority:

- job type `tiktok.creator.native.sync`;
- trigger `production_connector_uat`;
- metric date `2026-08-22`;
- status remains open until reviewed redrive support is deployed and recovery is executed.

Do not manually alter the retained DLQ row or resolve its incident alerts before verified recovery.

## Reviewed shared Lark transport repair

PR #678 merged at `62bf0aa388ffc27c91242fd29f623fdf2fca518f` after full Branch Verification.

The reviewed repair:

1. serializes request bodies before entering the network transport boundary;
2. classifies serialization failure as permanent `LARK_REQUEST_SERIALIZATION_ERROR` without starting Fetch;
3. normalizes any non-`RuntimeError` thrown by `fetch()` or `response.text()` inside the transport boundary to retryable `LARK_NETWORK_ERROR`;
4. preserves `LARK_REQUEST_TIMEOUT` for timeouts;
5. preserves existing Lark `RuntimeError` classifications;
6. keeps errors outside the transport boundary fail-closed as programming errors;
7. preserves App-token/path sanitization;
8. preserves existing ambiguous Create/retry-mode semantics.

The original Production incident is still treated as a repair hypothesis until the retained failed payload is replayed on the reviewed repair and the same logical read proceeds successfully.

## Current repair — TikTok retained-DLQ redrive admission

The existing shared dead-letter redrive use case already supports reviewed fresh-generation recovery for non-stable jobs such as YouTube, plus special exact-stable handling for Google Ads and Facebook. TikTok was not in its supported allowlist, so the retained Production UAT DLQ could not be replayed through the canonical recovery path.

Current branch `work/tiktok-dlq-redrive-admission-v1` makes the minimal shared change:

1. add only `tiktok.creator.native.sync` to the existing supported redrive set;
2. reuse the existing fresh-generation redrive semantics rather than creating a TikTok-only replay engine;
3. preserve the original TikTok UAT `type`, `trigger=production_connector_uat`, and `metricDate`;
4. reserve a fresh durable `requestedAt` / redrive generation;
5. attach the existing `redriveOfDlqId` and `redriveReference` audit metadata;
6. leave Google Ads and Facebook exact-stable semantics unchanged;
7. keep unsupported job types fail-closed;
8. perform no Production mutation in this code-change workstream.

## Required tests for current repair

- TikTok sync is removed from the forbidden redrive set;
- exact Production UAT trigger and metric date survive redrive;
- redrive reserves a fresh requested generation;
- audit metadata is attached through the existing generic path;
- dead letter is marked redriven only through existing durable store semantics;
- unsupported job types still fail before prepare mutation or Queue send;
- existing YouTube, Google Ads and Facebook redrive tests remain green;
- full Branch Verification passes before Ready/Merge.

## Recovery after reviewed merge

1. Refresh isolated Production worktree to the exact reviewed `main` containing #678 and the TikTok redrive admission.
2. Deploy the reviewed Worker in dark state; Cron remains absent.
3. Enable only TikTok + controlled Production-UAT admission + DLQ redrive for the recovery window.
4. Submit one canonical `system.dead-letter.redrive` command for the exact retained TikTok DLQ ID; do not manufacture a replacement TikTok business job.
5. Verify the retained DLQ is redriven through existing store semantics and a new TikTok run succeeds.
6. Verify Customer Lark `MKT_Accounts`, `MKT_Content`, `MKT_Content_Daily`, D1 reliability state, and protected source zero-write.
7. Run the same logical TikTok scope once more and prove stable-key idempotency.
8. Resolve/close retained incident state only through existing reviewed reliability semantics after recovery evidence passes.
9. Restore TikTok/UAT/redrive gates to false; schedules/AI/notifications remain false.
10. Promote TikTok `liveAccountUat=true` in a separate reviewed readiness PR only after external evidence passes.
11. Continue other eligible connectors and enable schedules last.

## Safety rules

- Never push directly to `main`.
- Never commit Production resource IDs, tokens, secrets, customer credentials or local Wrangler config.
- Do not reuse or overwrite the user's default Cloudflare login; Production uses the isolated named Wrangler auth profile/worktree.
- Do not touch PR #661 Base migration state while provisioning Cloudflare Production.
- Do not mutate the protected Lark Native TikTok source table.
- TikTok Ads remains deferred under PR #220.
- Do not fake `largeAccount.productionReady` or `liveAccountUat` before external evidence exists.
- Do not create a generic Production bypass around `assertConnectorRunnable()`.
- Do not create a TikTok-only replay engine when the existing generic redrive semantics are sufficient.
- Do not replay the retained failed TikTok payload before the reviewed redrive admission is merged and deployed.
- Do not resolve retained failure evidence before successful recovery verification.
- Do not enable Cron/schedules before controlled Production verification is complete.

## Implementation result

In progress on `work/tiktok-dlq-redrive-admission-v1`:

- shared redrive allowlist admits `tiktok.creator.native.sync`;
- TikTok reuses generic fresh-generation redrive semantics;
- focused regression preserves the exact Production-UAT trigger and metric date;
- Production remains dark and no Cloudflare/Lark/D1/Queue mutation is performed by this code-change workstream.
