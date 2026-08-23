# Current Task — TikTok Workers Free Durable Continuations v1

## Status

```text
TASK_STATUS                              = IMPLEMENTED_READY_FOR_REVIEW
CURRENT_PROGRAM                          = TIKTOK_WORKERS_FREE_DURABLE_CONTINUATIONS_V1
BASE_MAIN_SHA                            = a2835f40eac88301f980a59868a3362a2627151b
CURRENT_BRANCH                           = codex/tiktok-free-plan-continuations-20260823
CUSTOMER_WORKERS_PLAN                    = FREE_UPGRADE_NOT_CURRENTLY_AVAILABLE
PRODUCTION_MUTATION_AUTHORIZED_THIS_BRANCH = FALSE
CUSTOMER_BASE_RUNTIME_READY              = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER        = NON_BLOCKING
PRODUCTION_D1_PROVISIONED                = TRUE
PRODUCTION_D1_MIGRATIONS                 = 21_OF_21
PRODUCTION_D1_QUICK_CHECK                = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED        = TRUE
PRODUCTION_DLQ_PROVISIONED               = TRUE
PRODUCTION_WORKER_DEPLOYED               = TRUE_DARK
PRODUCTION_WORKER_HEAD                   = 83547103-a095-442c-b43c-59ec525e2183_DARK_VERSION
PRODUCTION_QUEUE_CONSUMERS               = MAIN_1_DLQ_1
PRODUCTION_SCHEDULE_ENABLED              = FALSE
PRODUCTION_BUSINESS_TRAFFIC              = CONTROLLED_BOOTSTRAP_AND_FAILED_TIKTOK_UAT_ONLY
PRODUCTION_QUEUE_LARK_BOOTSTRAP_SMOKE    = PASS_IDEMPOTENT
PRODUCTION_CONNECTOR_UAT_ADMISSION       = MERGED_PR_677
LARK_TRANSPORT_REPAIR                    = MERGED_PR_678
LARK_TRANSPORT_REPAIR_MAIN_SHA           = 62bf0aa388ffc27c91242fd29f623fdf2fca518f
TIKTOK_PRODUCTION_UAT                    = FAILED_BEFORE_BUSINESS_WRITE
TIKTOK_PRODUCTION_UAT_FAILURE            = LARK_CLIENT_PROGRAMMING_ERROR_ON_MKT_CONTENT_DAILY_SEARCH
TIKTOK_PRODUCTION_UAT_SOURCE_WRITE       = ZERO
TIKTOK_PRODUCTION_UAT_TARGET_WRITE       = ZERO
TIKTOK_PRODUCTION_UAT_DLQ                = terminal:eafd8e43f1ae5113d12905301496fd4e_OPEN_FORENSIC
TIKTOK_DLQ_REDRIVE_SUPPORT               = DO_NOT_BLIND_REDRIVE
PRODUCTION_DARK_STATE_RESTORED           = TRUE
CURRENT_REPAIR_BRANCH                    = codex/tiktok-free-plan-continuations-20260823
CUSTOMER_BASE_PR_661                     = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                        = DEFERRED_NO_MUTATION
```

## Objective

Refactor the TikTok Creator native sync so one Cloudflare Queue delivery performs only a bounded durable source, preflight, write, or completion unit and then enqueues an exact-identity continuation. The customer cannot upgrade Workers at present, so the reviewed recovery must be compatible with the Workers Free CPU ceiling without weakening idempotency, reconciliation, source protection, Production admission, or dark-by-default controls.

This branch is implementation and test only. It must not deploy, enable Production flags, replay either retained TikTok incident, write Customer Lark/D1 business data, or resolve forensic evidence.

Latest user authority on 2026-08-23 confirms that the source accounts, source data, and connector
credentials used in the Integration Workspace are already customer assets. Customer Production is
therefore a runtime cutover to the customer-owned Cloudflare resources and customer Lark Base, not
a new per-channel ownership onboarding. A secret that cannot be exported/read back remains a
technical secret-setting step in Customer Cloudflare, not an ownership blocker.

## In scope — Workers Free continuation repair

1. Make controlled Production TikTok UAT a stable Queue operation so all continuation deliveries preserve exact `operationId`, `workKey`, `generation`, `originalRequestedAt`, trigger, metric date, and admission scope.
2. Bound RAW source staging to a configured number of pages per invocation and persist the page checkpoint before returning continuation-required.
3. Persist the computed business plan once per work generation so later preflight/write continuations do not rescan and rehash the entire RAW source.
4. Bound business preflight and write to a configured number of staged units per invocation.
5. Enqueue a fresh Queue continuation only after the durable phase checkpoint succeeds; ACK the current delivery through the normal success path.
6. Keep transient failures on the existing Queue retry path and permanent failures on the existing terminal path.
7. Complete work, checkpoint incremental state, and publish final reconciliation only after every source/preflight/write unit passes.
8. Keep the protected `RAW_TikTok_Creator_Videos` table read-only and D1-before-Lark write order unchanged.

## Out of scope — current branch

- Workers Paid upgrade or a raised `limits.cpu_ms` value;
- Production deploy, flag enablement, Queue send, DLQ redrive, live Customer Lark/D1 mutation, or schedule enablement;
- blind replay of `terminal:eafd8e43f1ae5113d12905301496fd4e` or the earlier failed generation;
- connector readiness promotion, other-channel credential onboarding, report/AI/notification enablement, or Production COMPLETE declaration.

## Acceptance criteria — current branch

- every continuation preserves stable Queue identity and canonical Production-UAT trigger;
- no continuation is enqueued before its source/business phase checkpoint is durable;
- repeated or out-of-order continuation deliveries are idempotent and cannot move durable counters backward;
- a bounded invocation processes no more than the configured source pages or business units;
- source staging, persisted plan, preflight, write, incremental checkpoint, and completion replay remain resumable;
- focused application/worker-runtime tests, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit`, and `npm run deploy:dry-run` pass;
- `Implementation result` is updated with files, commands, evidence, and remaining Production blockers before handoff.

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

Operator-access evidence supplied on 2026-08-23 confirms that `dev.datahub.2026@gmail.com`
can sign in to Lark and open the customer Base `✨Marketing Content Calendar`. Base sharing is
therefore not a remaining blocker. The live recovery preflight must still verify the Worker Lark
App/OAuth API scopes against that same Base; this is an API-binding check, not a request to share
the Base again. The screenshot URL/table token remains local evidence and must not be committed.

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
- status remains open as immutable forensic evidence; the reviewed recovery uses a fresh stable UAT and
  does not redrive this payload.

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

The original Production incident is still treated as a repair hypothesis until a fresh stable UAT on the
reviewed repair makes the same logical read proceed successfully. The retained failed payload is not replayed.

## Controlled cutover after reviewed merge

1. Deploy the exact reviewed Worker to customer Cloudflare while every connector, schedule, AI, and
   notification execution flag remains false.
2. Apply the customer Base mapping and customer-owned connector state/credentials to the customer D1,
   Worker bindings, and Secret store. Do not copy secret values into Git, logs, or evidence.
3. Run read-only binding and checkpoint preflight. The user-provided Lark screenshot already proves
   operator access; this step verifies only Worker App/OAuth API access and exact Table IDs.
4. Run one fresh stable TikTok Production UAT with Free-plan continuation budgets. Do not redrive
   `terminal:eafd8e43f1ae5113d12905301496fd4e`.
5. Prove D1-before-Lark writes, final reconciliation, protected RAW zero-write, and an idempotent rerun.
6. Run controlled UAT for the remaining customer connectors using their existing customer-owned
   source identities and checkpoints; promote readiness only from exact live evidence.
7. Enable source schedules one connector at a time. For each first scheduled operation verify that it
   continues from the migrated checkpoint, covers the expected time window, creates no duplicate stable
   keys, leaves no missing interval, and reaches D1/Lark parity before enabling the next connector.
8. Enable Daily/Weekly materialization only after source schedule proofs pass.
9. On Monday 2026-08-24 verify the automatic AI/Notification path sends the correct period and customer
   profile to the exact customer Lark group exactly once. Require one completed AI run, one claimed/sent
   delivery, one matching Notification Log row, stable message hash, zero duplicate delivery, and zero
   new exact-scope alert/DLQ/active lock.
10. Restore any temporary UAT flags to false and retain the reviewed normal schedules only after all
    first-run readbacks pass.

## Safety rules

- Never push directly to `main`.
- Never commit Production resource IDs, tokens, secrets, customer credentials or local Wrangler config.
- Do not reuse or overwrite the user's default Cloudflare login; Production uses the isolated named Wrangler auth profile/worktree.
- Do not touch PR #661 Base migration state while provisioning Cloudflare Production.
- Do not mutate the protected Lark Native TikTok source table.
- TikTok Ads remains deferred under PR #220.
- Do not fake `largeAccount.productionReady` or `liveAccountUat` before external evidence exists.
- Do not create a generic Production bypass around `assertConnectorRunnable()`.
- Do not replay or redrive the retained TikTok failure; recover with a fresh exact stable operation.
- Do not resolve retained failure evidence before successful recovery verification.
- Do not enable Cron/schedules before controlled Production verification is complete.
- Do not enable AI/Notification before source schedules and report materialization are complete for the
  intended period and exact customer group mapping is read back.

## Implementation result

Implemented on `codex/tiktok-free-plan-continuations-20260823` without Production mutation:

- controlled Production TikTok UAT and post-Lark runs preserve one stable Queue operation identity across
  all continuation deliveries;
- source staging, business-plan scan/finalization, preflight, write, and finalization are split into durable
  bounded Queue invocations;
- the immutable business plan is persisted once and its Classification Dictionary hash is checked on resume;
- continuation is enqueued only after its durable invocation phase is saved;
- duplicate/ambiguous Queue delivery replays the pending continuation, stale delivery skips, and an ahead
  sequence fails closed;
- Queue send failure remains retryable without losing the durable checkpoint;
- legacy non-stable paths preserve their existing unbounded compatibility behavior;
- example runtime config adds `MKT_TIKTOK_SOURCE_PAGES_PER_INVOCATION=1` and
  `MKT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION=1`;
- Production remains dark; no deploy, Queue send, Lark/D1 business write, flag enable, schedule enable,
  DLQ redrive, or retained-evidence mutation occurred on this branch.

Files changed:

- TikTok source/planner/business continuation use cases under `packages/application/src/use-cases/`;
- stable Queue identity in `packages/application/src/jobs/queue-operation.js`;
- Worker routing and continuation enqueue support under `apps/sync-worker/src/`;
- bounded runtime examples in `.dev.vars.example` and `wrangler.sync.example.jsonc`;
- focused application and routing tests.

Verification on 2026-08-23:

- `npm run check` — PASS, 792 source files / 2,358 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,132 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105 tests;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `npm run deploy:dry-run` — PASS for both example Workers;
- `git diff --check` — PASS.

Remaining external work is the reviewed merge and the controlled customer cutover/first-schedule/AI-group
proof sequence above. These are execution gates, not missing customer ownership or Base-sharing blockers.
