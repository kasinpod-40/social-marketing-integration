# Current Task — Customer Multichannel Production Cutover v1

## Status

```text
TASK_STATUS                              = YOUTUBE_EXISTING_CREDENTIAL_REWRAP_IN_PROGRESS
CURRENT_PROGRAM                          = MULTICHANNEL_CUSTOMER_PRODUCTION_RUNTIME_V1
BASE_MAIN_SHA                            = 400a17795f3a2fee0175504c20f3758f377675f8
CURRENT_BRANCH                           = codex/youtube-customer-credential-rewrap-20260823
CUSTOMER_WORKERS_PLAN                    = FREE_UPGRADE_NOT_CURRENTLY_AVAILABLE
PRODUCTION_MUTATION_AUTHORIZED_THIS_BRANCH = REVIEW_MERGE_DARK_DEPLOY_THEN_ONE_CONNECTOR_AT_A_TIME
CUSTOMER_BASE_RUNTIME_READY              = TRUE
CUSTOMER_BASE_MANUAL_UI_REMAINDER        = NON_BLOCKING
PRODUCTION_D1_PROVISIONED                = TRUE
PRODUCTION_D1_MIGRATIONS                 = 21_OF_21
PRODUCTION_D1_QUICK_CHECK                = OK
PRODUCTION_MAIN_QUEUE_PROVISIONED        = TRUE
PRODUCTION_DLQ_PROVISIONED               = TRUE
PRODUCTION_WORKER_DEPLOYED               = TRUE_REVIEWED_ACTIVE
PRODUCTION_WORKER_HEAD                   = d93072cb-a179-4158-944c-0eb08cf0e759
PRODUCTION_QUEUE_CONSUMERS               = MAIN_1_DLQ_1
PRODUCTION_SCHEDULE_ENABLED              = INSTAGRAM_META_ADS_CHATWOOT
PRODUCTION_BUSINESS_TRAFFIC              = THREE_SOURCE_SCHEDULES_ACTIVE_FIRST_RUN_PENDING
PRODUCTION_QUEUE_LARK_BOOTSTRAP_SMOKE    = PASS_IDEMPOTENT
PRODUCTION_CONNECTOR_UAT_ADMISSION       = MERGED_PR_677
LARK_TRANSPORT_REPAIR                    = MERGED_PR_678
LARK_TRANSPORT_REPAIR_MAIN_SHA           = 62bf0aa388ffc27c91242fd29f623fdf2fca518f
TIKTOK_PRODUCTION_UAT                    = PASS_COMPLETED_IDEMPOTENT
TIKTOK_PRODUCTION_UAT_OPERATION          = tiktok-prod-cutover-20260823-r1
TIKTOK_PRODUCTION_UAT_SOURCE_RECORDS     = 2046_READ_ONLY
TIKTOK_PRODUCTION_UAT_TARGET_WRITE       = CONTENT_5_CREATE_2041_UPDATE_DAILY_2046_CREATE_ACCOUNT_1_UPDATE
TIKTOK_PRODUCTION_UAT_DLQ                = terminal:eafd8e43f1ae5113d12905301496fd4e_OPEN_FORENSIC
TIKTOK_DLQ_REDRIVE_SUPPORT               = DO_NOT_BLIND_REDRIVE
PRODUCTION_DARK_STATE_RESTORED           = TRUE_VERSION_1dc1ae9c
PRODUCTION_MAIN_QUEUE_BATCH_SIZE         = 1_FREE_PLAN_SAFE
PRODUCTION_CRON                          = EVERY_5_MINUTES_PRIMARY_SCHEDULER
PRODUCTION_FIRST_RUN_WINDOW              = 2026-08-24_0735_TO_0745_ASIA_BANGKOK
PRODUCTION_MONITOR_AUTOMATION            = customer-production-cutover-monitor_ACTIVE_0650_DAILY
CURRENT_REPAIR_BRANCH                    = MERGED_PR_695
REVIEWED_SOURCE_UAT_READY                = TIKTOK_FACEBOOK_INSTAGRAM_META_ADS_GOOGLE_ADS_CHATWOOT
PRODUCTION_SECRET_BLOCKED                = WOOCOMMERCE_GOOGLE_ADS_SIGNED_INGRESS
YOUTUBE_CUSTOMER_RECONNECT               = NOT_REQUIRED_EXISTING_VALIDATED_GRANT
YOUTUBE_CREDENTIAL_CUTOVER               = REWRAP_V1_TO_CUSTOMER_KEY_PENDING
CUSTOMER_BASE_PR_661                     = ISOLATED_NO_MUTATION
TIKTOK_ADS_PR_220                        = DEFERRED_NO_MUTATION
```

## Objective

Cut over every reviewed customer-owned connector from the Integration Workspace runtime to the exact
customer Production ownership tuple. Reuse the migrated D1 state and customer Base mappings, preserve the
Integration Workspace path, reject foreign Production profiles/ownership, deploy dark after review, then
enable and verify one connector schedule at a time before Report/AI/Notification activation.

Latest user authority on 2026-08-23 confirms that the source accounts, source data, and connector
credentials used in the Integration Workspace are already customer assets. Customer Production is
therefore a runtime cutover to the customer-owned Cloudflare resources and customer Lark Base, not
a new per-channel ownership onboarding. A secret that cannot be exported/read back remains a
technical secret-setting step in Customer Cloudflare, not an ownership blocker.

## Current authorized scope — YouTube credential cutover without reconnect

The customer Channel owner already completed the required YouTube consent. Integration Live evidence proves
that the exact encrypted Customer Connection credential passed Owner authorization and a completed Analytics
catch-up. The migrated Customer D1 therefore retains the correct grant; the cutover must not ask the customer
to sign in again and must not use the unrelated legacy `YOUTUBE_OAUTH_*` token.

This branch must:

1. admit the exact reviewed `production/chemistry_k/customer` credential runtime while preserving the existing
   `development/integration_workspace/developer` tuple and rejecting every mixed/foreign tuple;
2. support an explicit current key plus bounded previous read-key versions, with all key material remaining in
   Worker Secrets;
3. add a disabled-by-default, operator-authenticated Integration-only rewrap boundary for the exact active
   YouTube Refresh Token; plaintext may exist only in Worker memory and must never enter response, log, D1
   evidence, Git or a local artifact;
4. create a new Customer-owned AES-256-GCM key, rewrap the same grant, migrate only the resulting encrypted
   envelope/reference into Customer D1, and validate Customer Owner refresh before enabling its schedule;
5. keep Google Ads, WooCommerce, Report, AI, Notification and DLQ-redrive state unchanged.

Acceptance requires focused repository/Worker tests, the standard gates, reviewed merge, exact Customer secret
readback by name, read-only Owner identity/refresh proof, one controlled YouTube run with D1/Lark reconciliation,
and only then normal YouTube schedule activation. A new OAuth consent is explicitly out of scope unless Google
independently rejects the already proven grant after rewrap.

## Historical completed scope — Workers Free continuation repair

1. Make controlled Production TikTok UAT a stable Queue operation so all continuation deliveries preserve exact `operationId`, `workKey`, `generation`, `originalRequestedAt`, trigger, metric date, and admission scope.
2. Bound RAW source staging to a configured number of pages per invocation and persist the page checkpoint before returning continuation-required.
3. Persist the computed business plan once per work generation so later preflight/write continuations do not rescan and rehash the entire RAW source.
4. Bound business preflight and write to a configured number of staged units per invocation.
5. Enqueue a fresh Queue continuation only after the durable phase checkpoint succeeds; ACK the current delivery through the normal success path.
6. Keep transient failures on the existing Queue retry path and permanent failures on the existing terminal path.
7. Complete work, checkpoint incremental state, and publish final reconciliation only after every source/preflight/write unit passes.
8. Keep the protected `RAW_TikTok_Creator_Videos` table read-only and D1-before-Lark write order unchanged.

## Out of scope — multichannel runtime branch

- blind replay of `terminal:eafd8e43f1ae5113d12905301496fd4e` or mutation of retained forensic evidence;
- bypassing missing customer secrets for YouTube, Google Ads, WooCommerce, or connection encryption;
- report/AI/notification enablement or Production COMPLETE declaration before their own live proofs.

## Acceptance criteria — multichannel runtime branch

- retained customer-source UAT promotes Facebook, Instagram, Meta Ads, Google Ads and Chatwoot to
  `verified`; YouTube and WooCommerce remain `dev_ready` until their missing Customer Production secret
  paths can be exercised;
- each active connector router admits only the reviewed Integration Workspace or exact customer Production
  ownership tuple and rejects foreign profile/customer/ownership;
- normal Production admission continues to pass through `assertConnectorRunnable()` without a generic bypass;
- the controlled UAT lane remains restricted to a `dev_ready` connector missing only `liveAccountUat`;
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

## TikTok Production recovery UAT — PASS on 2026-08-23

Fresh stable operation `tiktok-prod-cutover-20260823-r1` ran in the exact customer Production account
against the customer Base. The retained 2026-08-22 failure was not redriven or altered.

- Workers Free-safe runtime used one source page and one business unit per invocation;
- the main Queue was reduced to `max_batch_size=1` after live error-tail evidence showed that batching a
  TikTok unit with reliability-mirror messages could exceed the CPU ceiling;
- source staging, plan scan, preflight and write each completed 82/82 pages for 2,046 source records;
- final lifecycle is `completed`; checkpoint date advanced from `2026-08-22` to `2026-08-23`;
- all 2,046 checkpoint source IDs and external content IDs are distinct;
- customer Lark totals are Content 5 created / 2,041 updated, Content Daily 2,046 created, Account 1 updated;
- final reconciliation is `recovered`, with zero warnings and zero exact-scope open alert, DLQ or lock;
- protected Native TikTok source remained read-only;
- one intentional same-identity replay increased only the delivery-attempt counter from 334 to 335;
  completion, cursor, checkpoint count and Lark work totals remained unchanged;
- UAT/connector flags were restored false in customer Production version `1dc1ae9c-7c98-4e23-974b-3e43050c9aa1`;
  all schedules, reports, AI and notifications remain disabled.

This retained evidence satisfies TikTok `liveAccountUat`. It does not promote any other connector.

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

### 2026-08-23 — Stable YouTube Production-UAT recovery identity

- added a stable Queue-operation contract for `youtube.channel.organic.sync` only when the canonical
  `production_connector_uat` trigger is used with `dryRun=false`;
- the controlled Production-UAT route now consumes the reviewed `operation.workKey`, allowing a recovery
  delivery to resume the exact existing YouTube page/chunk checkpoint even when Cloudflare assigns a new
  message ID;
- scheduled and ordinary YouTube jobs retain their existing delivery-scoped work key; no generic Production
  bypass or scheduled readiness exception was added;
- malformed, unstable, drifted work keys/generations fail closed before Provider or business writes;
- focused Queue-operation, Production-UAT admission and Worker-routing tests pass `53/53`;
- `npm run check` passes with 800 source files, 2,393 local dependencies and zero cycles;
- full tests pass `3,188` unit plus `18` Workers-runtime tests; Report reliability passes `105/105`;
- `npm audit --audit-level=high` reports zero vulnerabilities and `npm run deploy:dry-run` passes;
- Customer Production schedule remains disabled while live UAT resumes the retained exact checkpoint.

Files changed:

- `packages/application/src/jobs/queue-operation.js`
- `apps/sync-worker/src/active-job-router.js`
- `tests/application/queue-operation.test.js`
- `tests/application/production-connector-uat-admission.test.js`
- `docs/current-task.md`
- `CHANGELOG.md`

YouTube no-reconnect credential cutover implementation on
`codex/youtube-customer-credential-rewrap-20260823`:

- reused the canonical reviewed runtime ownership predicate and admitted only exact
  `development/integration_workspace/developer/chemistry_k` or
  `production/chemistry_k/customer/chemistry_k`; historical aliases and mixed tuples fail closed;
- extended the Customer credential runtime with one current write key and at most four explicit previous read
  key versions, all loaded only from Worker Secrets;
- added repository-level rewrap that decrypts the exact active source envelope and atomically replaces it with
  a new encrypted envelope/reference without returning plaintext;
- added disabled-by-default `POST /operator/youtube/credential-rewrap`, exact confirmation/reference/version
  checks, a dedicated `MKT_YOUTUBE_CREDENTIAL_REWRAP_TOKEN` constant-work bearer boundary and an
  Integration-only environment guard; the existing general Connection operator token is not rotated;
- preserved YouTube public API-key reads and the rule that Analytics never falls back to legacy
  `YOUTUBE_OAUTH_*` credentials; no schedule, Report, AI, Notification, Lark or DLQ state changed;
- focused credential/runtime/HTTP tests — PASS 26/26;
- `npm run check` — PASS, 797 source files / 2,381 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,172 unit tests and 18 Workers-runtime tests after the final canonical ownership reuse;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/youtube-customer-credential-rewrap-dry-run.log npm run deploy:dry-run` — PASS;
- `git diff --check` — PASS;
- no secret was read, printed, persisted or committed and no Remote mutation occurred on this branch.

Remaining execution gate: reviewed merge, temporary Integration-only rewrap window, encrypted envelope migration,
Customer Owner refresh/identity proof, controlled D1/Lark run/reconciliation, route/previous-key removal and only
then YouTube schedule activation. Customer reconnect is not required.

Customer Production schedule activation on 2026-08-23:

- PR #702 merged the reviewed multichannel Production runtime at exact main
  `400a17795f3a2fee0175504c20f3758f377675f8`; the customer Worker was first deployed dark, then the exact
  merged source was deployed as version `d93072cb-a179-4158-944c-0eb08cf0e759` with deployment message
  `main@400a1779 activate instagram meta-ads chatwoot schedules`;
- Cloudflare readback shows `dev.datahub.2026@gmail.com` as author and the new version receiving 100% traffic;
- the primary Cron is exactly `*/5 * * * *`, `workers_dev=false`, and the main Queue remains Free-plan safe
  at batch size/timeout/concurrency `1/1/1` with the existing DLQ; no route or DLQ redrive was added;
- enabled only Instagram, Meta Ads and Chatwoot source/D1/Lark/schedule paths. TikTok, Facebook, Google Ads,
  YouTube, WooCommerce, Daily/Weekly reports, AI, notification, retention, webhook and redrive paths remain
  disabled. `CHATWOOT_INCLUDE_UPDATED_OLDER_CONVERSATIONS=true` is the retained reviewed Daily behavior;
- first automatic source windows remain time-gated to Monday 2026-08-24 at 07:35 Instagram, 07:40 Meta Ads
  and 07:45 Chatwoot in `Asia/Bangkok`; no scheduled success is claimed before those runs occur;
- pre-run D1 baseline records Instagram 50 current-content keys / 50 observation keys / 14 account-day keys,
  Meta Ads 9,503 daily-fact keys through 2026-08-21, and Chatwoot cursor `2026-08-22` with 665 conversation
  state rows. Distinct stable-key counts equal row counts in the measured tables and active locks are zero;
- the retained TikTok forensic baseline remains five open alerts and one open DLQ row; neither was changed,
  replayed or redriven;
- Codex heartbeat `customer-production-cutover-monitor` is active for 06:50 `Asia/Bangkok` to continue the
  reviewed TikTok enablement and first-run reconciliation sequence. It must stop after completion or when an
  unrecoverable secret blocker requires user action.

Remaining live gates:

- enable TikTok at/after 06:55 Monday, when the reviewed scheduler targets 2026-08-23 and cannot move the
  migrated cursor backward, then verify its exact scheduled operation;
- verify Instagram, Meta Ads and Chatwoot first automatic runs one connector at a time against the retained
  baseline, including D1/Lark parity, expected interval, stable keys, checkpoint, and exact new alert/DLQ/lock;
- keep Facebook disabled until `META_FACEBOOK_PAGE_ACCESS_TOKEN` is set; keep Google Ads, YouTube and
  WooCommerce disabled until their documented missing encryption/Provider secrets are available;
- keep Report/AI/Notification disabled until all intended source and materialization gates pass. Automatic
  Lark group exactly-once delivery remains pending and must not be inferred from deployment alone.

Multichannel Production runtime update on `codex/multichannel-production-runtime-20260823`:

- centralized the exact reviewed runtime ownership predicate so connector routers accept only
  developer-owned `development/integration_workspace/chemistry_k` or customer-owned
  `production/chemistry_k/chemistry_k`;
- routed Meta, Google Ads, WooCommerce and Chatwoot through the central connector readiness gate before
  Provider/Infrastructure execution; disabled connectors still fail before any business activity;
- promoted Facebook, Instagram, Meta Ads, Google Ads and Chatwoot to `verified` from retained customer-source
  Live UAT, bounded/durable execution and D1/Lark reconciliation evidence already recorded in Project Brain;
- retained YouTube and WooCommerce as `dev_ready` because Customer Production cannot yet exercise their
  unreadable/missing encryption and Provider secrets;
- focused runtime/catalog/admission suites pass, including exact customer Production allow and foreign
  ownership/profile/customer rejection;
- `npm run check` — PASS, 796 source files / 2,372 local dependencies / 0 cycles; hygiene PASS;
- first full `npm test` correctly exposed two stale disabled-connector error-code expectations; both were
  updated to the stricter central `MKT_CONNECTOR_DISABLED` boundary and focused regression passes 31/31;
- final `npm test` — PASS, 3,166 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/multichannel-production-runtime-dry-run-r3.log npm run deploy:dry-run` — PASS;
- no Production deploy, Queue send, schedule enable, Lark/D1 business write, Secret change or DLQ mutation
  occurred before reviewed merge.

Readiness promotion update on `codex/tiktok-production-readiness-20260823`:

- changed only the TikTok large-account contract from `dev_ready` to `verified` and set
  `liveAccountUat=true` based on the exact live evidence above;
- updated catalog/admission tests so verified TikTok is admitted by normal Production execution while
  the controlled UAT exception remains tested against YouTube, which is still `dev_ready`;
- focused tests: `node --test tests/config/connector-catalog.test.js tests/application/production-connector-uat-admission.test.js`
  — PASS, 18/18;
- `npm run check` — PASS, 796 source files / 2,363 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,160 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/tiktok-production-readiness-dry-run.log npm run deploy:dry-run` — PASS;
- the normal TikTok schedule stays disabled until the reviewed promotion is merged and deployed.

Production schedule runtime update on `codex/tiktok-production-schedule-runtime-20260823`:

- pre-enable inspection found that the primary Cron correctly builds `tiktok.creator.native.probe`, but
  the post-Lark router still rejected every Production profile through a historical Integration-only guard;
- replaced that guard with an exact allowlist for either developer-owned `integration_workspace` or
  customer-owned Production `chemistry_k`; all foreign profile/customer/ownership tuples fail closed;
- focused source-watermark, schedule and runtime-admission tests pass 33/33;
- `npm run check` — PASS, 796 source files / 2,363 local dependencies / 0 cycles; hygiene PASS;
- `npm test` — PASS, 3,163 unit tests and 18 Workers-runtime tests;
- `npm run test:report-reliability` — PASS, 105/105;
- `npm audit --audit-level=high` — PASS, 0 vulnerabilities;
- `WRANGLER_LOG_PATH=/tmp/tiktok-production-schedule-runtime-dry-run.log npm run deploy:dry-run` — PASS;
- no customer Cron or TikTok schedule flag is enabled before reviewed merge.

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
