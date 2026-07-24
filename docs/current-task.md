# Current Task — Multi-Connector Customer Connection Foundation

## Authoritative status

```text
TASK_STATUS                         = CUSTOMER_LINKS_ACTIVE_AWAITING_CALLBACK
CURRENT_PROGRAM                     = MULTI_CONNECTOR_CUSTOMER_CONNECTION_FOUNDATION
FIRST_PRIORITY                      = GOOGLE_ADS_AND_YOUTUBE_CUSTOMER_OAUTH
OTHER_CONNECTORS                    = PLANNED_NOT_STARTED
INTEGRATION_WORKSPACE               = development / integration_workspace
GOOGLE_ADS_PR_17                    = DRAFT_HOLD
SCHEDULES                           = DISABLED
PRODUCTION                          = BLOCKED
REMOTE_D1_MIGRATION                 = 0011_0012_COMPLETE
WORKER_DEPLOYMENT                   = V2_DEPLOYED
GOOGLE_REDIRECT_URI_LIVE_CHANGE     = COMPLETE
CONNECT_LINK_GENERATION             = V2_CUSTOMER_LINKS_2_ACTIVE_7D
CONNECTOR_IMPLEMENTATION            = COMPLETE_MERGED
RETRY_SAFE_IMPLEMENTATION           = MERGED_PR_45
MERGED_PR_SEQUENCE                  = #42 -> #43 -> #44 -> #45 -> #46 -> #47
MOCK_CONTRACT_TEST                  = PASS
INTEGRATION_WORKSPACE_DEPLOYMENT    = PASS
CUSTOMER_OAUTH                      = AWAITING_CUSTOMER_ACTION
LIVE_ACCESS                         = NOT_RUN
LIVE_DATA_UAT                       = NOT_RUN
LARK_WRITE_UAT                      = NOT_APPLICABLE_THIS_PHASE
RELIABILITY_UAT                     = PREVIEW_GET_REPEAT_PASS
SCHEDULE                            = DISABLED
```

งานนี้สร้าง Customer OAuth Connection สำหรับ Google Ads และ YouTube บน Shared Google OAuth Core โดยคงเป็นคนละ Connector, คนละ Consent scope และคนละ Connection record. Callback ต้องเก็บ Refresh Token แบบ encrypted server-side, ตรวจ Provider identity และไม่ส่ง Queue/เริ่ม Sync/เขียน Lark.

## Objective

เตรียม Source code, additive D1 migration, Worker routes, guarded invitation operator และ Tests ให้พร้อมสำหรับลำดับ:

```text
PR A — Shared Customer Connection/OAuth Foundation
PR B — Google Ads Customer OAuth Connection
PR C — YouTube Customer OAuth Connection
```

PR #17 ห้าม merge, cherry-pick หรือใช้เป็น implementation baseline. Diff กับ `main` ปัจจุบันต้องเก็บเป็น review evidence เท่านั้น.

## Approved architecture

```text
Operator creates signed bounded-retry invitation
→ Customer opens connector-specific URL with side-effect-free GET
→ Customer explicitly confirms with POST
→ Worker atomically reserves one bounded attempt
→ Worker creates signed one-time OAuth state
→ Google authorization-code consent
→ Callback validates and consumes state
→ Code exchange
→ AES-GCM encrypted Refresh Token persistence
→ Access Token refresh/lifecycle proof
→ Provider identity validation
→ Connection metadata update
→ success permanently closes invitation / failure releases bounded retry
→ Connected / Action required page
```

Permanent rules:

- Invitation TTL default 24 hours and configurable.
- OAuth state TTL default 10 minutes and configurable.
- Invitation is signed, expiring, nonce-bound, preview-safe and bounded to 1–5
  OAuth starts; the default is 3.
- OAuth state remains signed, expiring, redirect-bound and one-time.
- Google Ads and YouTube never share a Connection record or combined Consent.
- Dynamic customer Refresh Tokens never use `.dev.vars`, Lark, Queue payload or plaintext D1.
- Existing YouTube environment credential adapter remains for compatibility.
- Callback never emits Queue messages and never writes Lark or Marketing business facts.
- Unknown HTTP routes return 404; unsupported methods on known routes return 405.
- Every Business schedule remains false.

## Data model authority

Exact contract:

`docs/customer-connection-oauth-contract-v2.md`

The v1 provider/encryption rules remain in
`docs/customer-connection-oauth-contract-v1.md`. The existing `connections`
table remains the metadata authority. Migration `0012` extends
`connection_invitations` additively with bounded attempt and active-lock fields;
legacy consumed rows stay closed. Distinct-grain tables remain:

- `connection_invitations`
- `oauth_state_attempts`
- `encrypted_credentials`
- `connection_identity_selections`

## PR A — Shared foundation scope

- Worker `fetch`, `scheduled` and `queue` handlers coexist without regression.
- Explicit HTTP route/method allowlist.
- Signed one-time invitation and signed one-time OAuth state.
- D1-backed atomic nonce consumption.
- AES-256-GCM credential repository with random IV, authenticated context and key version.
- Refresh/access lifecycle interfaces and bounded in-memory access-token cache.
- Connection metadata/status contract.
- Reconnect, token replacement and disconnect/revoke state transitions.
- Environment credential adapter remains available for legacy YouTube DEV.
- Central operational redaction covers connection/OAuth fields.
- Operator route returns only connector, customer key, connect URL, expiry and environment.

## PR B — Google Ads scope

- `GET /connect/google-ads` — read-only confirmation preview
- `POST /connect/google-ads` — exact user confirmation and OAuth begin
- `GET /oauth/google-ads/callback`
- Exact `adwords` scope and offline access.
- Google Ads identity validation against the approved advertiser and manager mapping.
- OAuth success remains `connected` when Developer Token access is pending.
- Success output contains only Connection ID, masked/approved identity and statuses.
- No Google Ads business ingestion and no PR #17 signed-delivery merge.

## PR C — YouTube scope

- `GET /connect/youtube` — read-only confirmation preview
- `POST /connect/youtube` — exact user confirmation and OAuth begin
- `GET /oauth/youtube/callback`
- Exact `youtube.readonly` and `yt-analytics.readonly` scopes.
- Reuse existing YouTube Data/Analytics clients and refresh-token provider.
- `channels.list mine=true` identity validation.
- Zero channels fails identity validation; one binds; multiple require explicit signed selection.
- No automatic first-channel choice and no Queue/Lark write.

## Acceptance criteria

- [x] PR A invitation signature/expiry/one-time/replay/mismatch tests pass.
- [x] PR A state signature/expiry/replay/mismatch/callback error tests pass.
- [x] PR A encryption/decryption/tamper/key-version/redaction tests pass.
- [x] PR A HTTP allowlist plus scheduled/queue regressions pass.
- [x] PR B authorization URL/code exchange/reconnect/access-pending tests pass.
- [x] PR B exact Customer/Manager/account-not-visible tests pass.
- [x] PR B proves zero Queue/Lark writes.
- [x] PR C authorization URL/code exchange/channel 0/1/many/selection tests pass.
- [x] PR C environment-adapter and existing YouTube connector regressions pass.
- [x] PR C proves zero Queue/Lark writes.
- [x] `npm ci`, `npm run check`, `npm test`, report reliability, audit and deploy dry-run pass.
- [x] `Implementation result` records files, commands, tests, security review and remaining blockers.

### Retry-safe v2 acceptance

- [x] Repeated `GET /connect/*` renders confirmation without reserving an attempt.
- [x] `HEAD` and invalid confirmation POST cause zero OAuth side effects.
- [x] D1 atomically permits one active attempt and rejects concurrent starts.
- [x] Failed/expired attempts permit bounded retry; success closes permanently.
- [x] Legacy consumed invitations remain closed after additive migration `0012`.
- [x] Focused service, D1, HTTP and provider-flow suites pass.
- [x] Full default gates pass on the final v2 diff.
- [x] Reviewed Remote D1 migration `0012`, deployment and test-link rollout.

## Implementation result

The v1 source implementation is merged through three stacked PRs. The approved
Integration Workspace rollout and two rounds of v1 Connect-link generation are
complete. All four v1 invitations were consumed at OAuth begin without callback
completion. The local branch now implements the v2 preview-safe/bounded-retry
contract and additive migration `0012`; PR `#45` is merged to `main` at
`9ca8375`. Migration `0012`, v2 deployment and preview-safe test-link smoke are
complete.

### Retry-safe v2 local implementation — 2026-07-24

- `GET /connect/google-ads` and `GET /connect/youtube` verify and render a
  confirmation page without invitation, PKCE or OAuth-state mutation.
- Exact form POST `confirm=connect` reserves a D1 attempt and redirects with
  `303`; the confirmation body is bounded to 1 KiB.
- New invitations default to three starts and may explicitly allow 1–5.
- D1 conditionally increments `attempt_count`, allows only one unexpired active
  attempt and verifies exact attempt/connection binding on attach/release/finish.
- Callback success completes the invitation permanently; callback/provider
  failure releases the active lock while retaining the consumed attempt count.
- Migration `0012_retry_safe_customer_connection.sql` is additive and keeps
  legacy invitations at `max_attempts=1`.
- Focused application/connector/storage suites pass `43/43`.
- Full verification passes: Unit `686/686`, Workers runtime `9/9`, report
  reliability `70/70`, Architecture `191/460/0`, audit `0` and deploy dry-run.
- No Remote D1 command, Secret change, link generation, deploy, Queue message,
  Lark write, schedule change or Production action occurred.

### Retry-safe v2 Remote rollout — 2026-07-24

- Exported Remote D1 before migration to a local mode-`600` file
  (`503,740,298` bytes; SHA-256
  `f1d211d0a333b78906a756cfd8e7b0d9dffce3525ec281175ae1267d061b5e52`).
- Applied additive migration `0012_retry_safe_customer_connection.sql`; D1
  reports no pending migration and all four retry fields exist.
- Verified all four legacy invitations remain consumed with
  `max_attempts=1`, `attempt_count=0` and no active attempt.
- Real-config dry-run passed with every Business connector/schedule/write flag
  false.
- Deployed v2 code as Worker version
  `8826189b-a2d7-4da8-aadd-3523e4252a8e`; final Secret-change deployment is
  `be07d411-5d36-415c-9fc0-874a45952bf8` at 100%.
- Post-deploy smoke passed: unknown `404`, operator GET `405`, and both Connect
  HEAD routes `405`; OAuth table counts did not change.
- Rotated the operator Secret without persisting plaintext and created one
  15-minute, three-attempt v2 test invitation per connector.
- Opened each signed GET URL twice: all four requests returned `200` confirmation
  HTML, both invitations remained at attempt count `0`, active attempt count `0`,
  and OAuth state count remained `4`.
- Signed test URLs are handed to the user only and are intentionally not stored
  in Repository documentation.
- On `2026-07-25`, the unused test links were confirmed expired. The operator
  Secret was rotated without persisting plaintext and one seven-day,
  three-attempt customer invitation per connector was created. Current Worker
  version is `79ef3710-2ed2-4373-b0d0-42ec76896fa6`.
- Branch Verification later detected `GHSA-r28c-9q8g-f849` in transitive
  `postcss@8.5.16`; the lockfile now resolves `postcss@8.5.23` within Vite's
  existing dependency range.
- No Queue message, Lark write, connector/schedule activation or Production
  mutation occurred.

### Merged PR sequence

The reviewed change is split as:

1. PR A `#42` / `codex/customer-oauth-foundation`: migration/shared crypto, D1 repositories, runtime config, invitation/state/operator HTTP boundary and shared tests.
2. PR B `#43` / `codex/google-ads-customer-oauth`: Google Ads v24 read-only identity/access validation, OAuth flow/routes and tests.
3. PR C `#44` / `codex/youtube-customer-oauth`: reuse/extension of YouTube client, 0/1/N identity selection flow/routes, tests and release documentation.

The PRs were reviewed and merged in order `#42` → `#43` → `#44` with Branch Verification passing. Draft PR #17 remains untouched and must not be merged/cherry-picked.

### Implemented behavior

- Sync Worker exports `fetch`, `scheduled` and `queue`.
- Operator invitation is connector/customer/environment-bound, signed, expiring and one-time.
- OAuth state is signed, PKCE-S256, nonce-bound, redirect-bound and one-time.
- Refresh Token is AES-256-GCM encrypted with random IV, key version and authenticated context.
- Callback reads the persisted credential back and refreshes an Access Token before provider validation.
- Google Ads uses v24 read-only Customer search with exact advertiser target and manager login header.
- Google Ads Developer Token pending retains the credential with `connection_status=connected` and `access_status=google_ads_api_access_pending`.
- YouTube reuses `YouTubeApiClient`; `listMyChannels()` preserves zero/one/many results and multiple channels require a signed one-time explicit selection.
- Browser results contain Connection ID, masked identity, statuses, scopes, validation time and next action only.
- Callback paths contain no Queue or Lark dependency and return `queued=false`, `larkWrite=false`.

### Verification

```text
npm ci                                      PASS / 80 packages / 0 vulnerabilities
npm run check                               PASS / 191 source files / 460 deps / 0 cycles
npm run test:unit                           PASS / 677 tests
npm run test:worker                         PASS / 9 tests
npm run test:report-reliability             PASS / 70 tests
npm audit --audit-level=high                PASS / 0 vulnerabilities
npm run deploy:dry-run                      PASS
focused customer OAuth suites               PASS
Remote D1 backup/export                     PASS / 503,727,528 bytes
Remote migration 0011                       PASS / no pending migrations
Google OAuth redirects/scopes/APIs          PASS
Worker Secrets                              PASS / required names 7/7
Real-config Wrangler dry-run                PASS / all business flags false
Integration Workspace Worker deploy         PASS / version 827b1f67-9a00-49c8-98f9-76f92d597c5d
HTTP smoke unknown/operator GET             PASS / 404 / 405
Post-smoke OAuth table counts                PASS / 0 / 0 / 0 / 0
Approved customer Connect-link generation    PASS / 2 created
Approved test Connect-link generation        PASS / 2 created / both later consumed
Current invitation counts                     4 consumed / 0 active
Current OAuth state counts                    4 expired / 0 consumed callbacks
Current encrypted credential counts           2 active PKCE / 2 replaced PKCE / 0 Refresh Token
```

`npm test` completed its first Unit phase 673/673; after the final provider isolation, reconnect and PKCE lifecycle regressions were added, `npm run test:unit` passed 677/677. Its first Worker phase was blocked by the local sandbox (`EPERM` on Wrangler log/loopback), then the exact Worker gate passed 9/9 with its log redirected to `/tmp` and local runtime permission granted.

### Integration Workspace rollout result — 2026-07-24

- Recorded rollback target Worker version `56956a78-cd67-42da-9956-fa9ad10deeb7`.
- Exported Remote D1 before migration to a mode-`600` temporary file; SHA-256 `c91fd9233331de877bdbdc30ae4d12e3bad4b7af9f868b3f096997a8e020c811`.
- Applied additive migration `0011_customer_connection_oauth.sql`; Remote D1 reports no pending migrations and all four OAuth tables exist.
- Configured the customer-owned Google Cloud project with the exact Google Ads and YouTube callback URIs.
- Enabled Google Ads API; YouTube Data API v3 and YouTube Analytics API were already enabled.
- Preserved OAuth Audience as `External / Testing`; the two approved customer test users were already present.
- Registered exact `adwords`, `youtube.readonly` and `yt-analytics.readonly` scopes.
- Configured the required seven Worker Secret names without logging or committing values.
- Deployed `social-mkt-sync-worker` to `https://social-mkt-sync-worker.kasinpod40.workers.dev`.
- Unknown route returned `404`; unsupported `GET /operator/connection-invitations` returned `405`.
- `connection_invitations`, `oauth_state_attempts`, `encrypted_credentials` and `connection_identity_selections` remained at zero rows after smoke.
- Temporary Secret files were removed after deployment and the Developer Token was re-masked in Google Ads UI.
- After separate approval, rotated the operator token and deployed Worker version `afaf61e8-95e2-4387-ae2d-8e6abe008b1c` at 100%.
- Generated one Google Ads invitation and one YouTube invitation. Both were later consumed at OAuth begin without callback completion; each connection remains `authorization_pending` / `not_validated`.
- After separate test-link approval, rotated the operator token and deployed Worker version `e80e46f0-5f81-4ce9-ae06-678cafab6efe` at 100%, then generated one 15-minute test invitation per connector. Both test invitations were also consumed at OAuth begin without callback completion.
- Final read-only D1 verification found two expired/unconsumed OAuth states per connector, one active plus one replaced encrypted `pkce_verifier` per connector, zero Refresh Tokens and zero identity selections.
- Signed Connect URLs are handed to the user only and are intentionally not stored in Repository documentation.

### Security review

- No real Secret/Token is present in source, examples, test outputs, URL query other than signed invitation/state/selection bearer artifacts, or operational logs.
- Signing/operator/encryption/client/developer keys are named only and must be Worker Secrets.
- Dynamic Refresh Tokens never use `.dev.vars`, legacy `connections.encrypted_*` columns, Queue payload or Lark.
- Central redaction now covers connection/customer/invitation/state/nonce/redirect identifiers.
- Operator authorization compares fixed-length SHA-256 digests with timing-safe comparison where the runtime supports it.
- Unknown route and unsupported method handling are explicit; browser responses use no-store/no-referrer/security headers.
- Encrypted credential replacement is transactional and tamper/key-version failures fail closed.

### Remaining blockers

- All four historical v1 invitations remain consumed and cannot be replayed.
- The two short-lived v2 test invitations expired unused with zero OAuth starts.
- One seven-day v2 customer invitation per connector is active and preview-safe;
  both provider callbacks require customer action before expiry.
- Expired OAuth attempts leave active/replaced PKCE verifier audit rows; cleanup behavior requires review and explicit authorization before any data mutation.
- OAuth callback, encrypted Refresh Token persistence and provider identity validation remain untested.
- Google Ads Developer Token remains `Test Account Access`; OAuth can retain the credential with `google_ads_api_access_pending`, but Production advertiser API access must not be claimed.
- Google Ads Direct API Live access, customer-visible connection results and reliability UAT remain pending.
- Business Queue work, Lark writes, connector flags and all schedules remain disabled.

### Meta customer connection preflight — 2026-07-25

A read-only inspection was repeated in the customer-owned Safari session after
discarding an earlier inspection of the developer-owned Meta app. No dashboard
setting was changed and no customer App/Business ID is stored in Source.

Verified customer-app state:

- the customer Meta app is in Development / not published;
- `ads_read`, `business_management`, `pages_read_engagement` and
  `pages_show_list` are available for testing;
- Meta currently reports that API access is restricted until every app
  administrator completes Developer Portal account verification;
- the user confirms that the customer supplied separate Facebook and Instagram
  access tokens, so Meta onboarding does not require a new customer OAuth link
  before token validation;
- the locally stored Instagram credential passed a read-only
  `graph.instagram.com/me` identity request with HTTP `200`; no raw token,
  username or full external ID was logged;
- no Facebook credential is currently available under the repository's
  expected local `META_ACCESS_TOKEN` name, so Facebook identity/scope validation
  remains pending.

The API-restricted dashboard banner remains an App Review/administration risk;
it is not proof that the supplied tokens are invalid. The next safe actions are
to store the supplied Facebook token in an approved ignored/Secret boundary,
run read-only Facebook identity/scope validation, and complete administrator
Developer Portal verification in parallel. This evidence does not authorize an
App Review submission, permission mutation or Production rollout.

Exact rollout and rollback commands: `docs/customer-connection-oauth-rollout.md`.

## Next boundary — Await customer callbacks

Remote migration `0012`, v2 deployment and repeat-GET smoke are complete. The
customer links expire around `2026-08-01 00:15 Asia/Bangkok` and support at most
three OAuth starts each.

Current operating rules:

- Signed links are not stored in Source, docs or logs.
- No polling/monitoring is required while waiting.
- Customer opens each link, reviews the confirmation page and presses the Google
  button only when ready to complete consent.
- After each callback, verify encrypted Refresh Token, exact provider identity,
  invitation completion and zero Queue/Lark side effects.
- Regenerate customer links only if they expire or exhaust their attempt budget.
- Review orphaned PKCE cleanup separately; do not delete D1 audit rows or credentials without exact approval.

## Account handoff — 2026-07-25

Another account can resume by reading `AGENTS.md`, this file, `docs/project-brain/00-current-state.md` and `docs/project-brain/10-next-actions.md`.

```text
SOURCE_MAIN                         7164a92 / PR #45 + #46 + #47
MERGED_PR                           #45 / retry-safe Connect v2
FEATURE_COMMIT                      f7b17ed
LIVE_WORKER_VERSION                 79ef3710-2ed2-4373-b0d0-42ec76896fa6
REMOTE_D1_MIGRATION                 0011 + 0012 applied / none pending
INVITATIONS                         legacy 4 consumed; v2 test 2 expired; customer 2 active
OAUTH_STATES                        google_ads 2 expired; youtube 2 expired; callbacks 0
PKCE_CREDENTIALS                    per connector: 1 active + 1 replaced
REFRESH_TOKENS                      0
IDENTITY_SELECTIONS                 0
CONNECTIONS                         authorization_pending / not_validated
QUEUE_LARK_SCHEDULES                disabled / no business side effects
SIGNED_URLS                         v2 customer URLs handed to user, not stored
```

The live operator token was rotated during customer-link generation and its
plaintext existed only in the creating process. Cloudflare Secrets are not
readable; any future invitation generation therefore requires a separately
approved operator-token rotation. The real non-secret runtime mapping remains
only in ignored local `wrangler.sync.jsonc`; never commit it or replace it with
the example config for remote commands.

Business Queue jobs, Lark writes, connector activation and schedules are outside this approval and remain prohibited.

## Preserved Prior Task Record — TikTok Organic Bootstrap Durable Recovery Rollout Closeout

## Status

```text
TASK_STATUS                         = ROLLOUT_COMPLETE
CLOSED_AT                           = 2026-07-24
INTEGRATION_WORKSPACE               = development / integration_workspace
TIKTOK_ORGANIC_D1_BOOTSTRAP         = PASS
DURABLE_RECOVERY                    = PASS
COMPLETION_CLOSURE                  = PASS
SAME_GENERATION_REPLAY              = PASS
BUSINESS_FACT_DRIFT                 = FALSE
LARK_BUSINESS_WRITE                 = 0
SCHEDULES                           = DISABLED
PRODUCTION                          = BLOCKED
GOOGLE_ADS_PR_17                    = DRAFT_HOLD
RUNTIME_ACTION_REQUIRED             = NONE
```

This file records the completed Integration Workspace rollout. It does not authorize another recovery, replay, cleanup, schedule change, Lark Canonical write or Production action.

## Authoritative runtime identity

```text
MKT_ENV                    = development
MKT_CUSTOMER_PROFILE       = integration_workspace
customerKey                = chemistry_k
accountKey                 = chemistry_k
sourceHandle               = chemistry_k
reportingTimezone          = Asia/Bangkok
Worker                     = social-mkt-sync-worker
D1                         = social-mkt-state-dev
Main Queue                 = social-mkt-sync-jobs
DLQ                        = social-mkt-sync-dlq
```

Production remains customer-owned and separate.

## Immutable incident identity

```text
original_requested_at      = 1784829780000 / 2026-07-23T18:03:00Z
operation_id               = f59b852f00634005c7ff4da51afee964
work_key                   = tiktok:f59b852f00634005c7ff4da51afee964
cursor_key                 = integration_workspace:tiktok:chemistry_k:organic_history_bootstrap
generation                 = 1784829780000
original_dlq_id            = dlq:8d1b9077657385a417cb32a0ed3114cb
failed_recovery_dlq_id     = dlq:06f7660b796808ebca3b8cd2e7780894
terminal_closure_dlq_id    = terminal:a90a4dbf2f281124d40601f2f7799a90
coverage_run_id            = coverage:tiktok:d398495edc3b070b815f99559ecce1a2f24f4c9ac4e0335810e287636fc2f2e0
```

## Final verified D1 result

```text
organic_content_state                     = 2021
organic_content_observations              = 2021
initial_observations                      = 2021
data_coverage_entities                    = 2021
state_duplicate_groups                    = 0
observation_duplicate_groups              = 0
work.lifecycle_status                     = completed
work.generation                           = 1784829780000
work.requested_at                         = 1784829780000
work.completed_at                         = 1784880407927
completion.nextSequence                   = 5
completion.rawRecords                     = 2021
completion.d1.contentRowsDurable          = 2021
completion.d1.observationRowsDurable      = 2021
completion.d1.coverageEntitiesWritten     = 2021
coverage.status                           = complete
coverage.expected_entities                = 2021
coverage.observed_entities                = 2021
coverage.expected_rows                    = 2021
coverage.observed_rows                    = 2021
coverage.failed_rows                      = 0
coverage.completed_at                     = 1784880407496
completion.lark.contentWrites             = 0
completion.lark.dailyWrites               = 0
completion.lark.blocked                   = true
main_queue_attempts_after_exact_replay     = 10
unexpected_terminal_failures              = 0
business_fact_drift_after_replay           = false
```

`sync_work_phases` and `sync_work_units` are zero after completed-work cleanup. Durable completion proof is retained in `sync_work_runs.completion_json` and the Coverage tables.

## DLQ and audit result

```text
original_dlq.status                = redriven
original_recovery.status           = completed
original_recovery.reference        = recovery:dlq:8d1b9077657385a417cb32a0ed3114cb:tiktok:f59b852f00634005c7ff4da51afee964
terminal_closure_dlq.status        = redriven
terminal_closure_recovery.status   = completed
terminal_closure.reference         = closure:terminal:a90a4dbf2f281124d40601f2f7799a90:tiktok:f59b852f00634005c7ff4da51afee964
failed_recovery_dlq.status         = open
```

The failed-recovery DLQ remains open as retained forensic evidence. It must not be deleted, redriven or normalized as routine cleanup.

## Completed rollout sequence

1. Read-only Remote D1 preflight passed.
2. Remote D1 export completed before Migration `0010`.
3. Backup file: `social-mkt-state-dev-before-0010-20260724T031853642Z.sql`.
4. Backup SHA-256: `6e6b7d8bb57e63da78b3888f39b95db4f50f4d5e0eb891699d598beb98b4e58b`.
5. Remote Migration `0010_tiktok_bootstrap_durable_recovery.sql` applied and verified.
6. Worker was deployed with TikTok/D1 write/backfill enabled and every schedule/report-reader/retention/notification/redrive flag disabled.
7. Exact recovery resumed the original generation without deleting partial business facts.
8. The 101-bind D1 observation-read defect was fixed and redeployed.
9. Cloudflare OAuth/API-token isolation was added for guarded operators.
10. Terminal Work was reactivated through an exact incident-specific guarded operator.
11. Exact recovery Queue resume was accepted once; it must never be sent again.
12. Business facts reached 2,021/2,021/2,021 with Coverage complete and zero duplicate groups.
13. Completion-closure defect was diagnosed: completed-work cleanup removed phase rows before the incident verifier read them.
14. Completion-closure hotfix was deployed.
15. Exact operational repair restored Work and DLQ metadata without changing business facts.
16. Read-only final verification passed.
17. Exact same-generation replay was accepted once.
18. Replay verification passed with `businessFactDrift=false`.

## Repository implementation chain

| PR | Purpose | Merge commit |
| --- | --- | --- |
| #29 | Durable TikTok bootstrap recovery implementation | `1fce94344100a6b1ed9dce471966f3596c00778a` |
| #37 | Guarded deploy/resume operator | `9c1f4e17a1addcd94422e4e840300856a3cff15c` |
| #38 | Cloudflare auth isolation | `7970b8d707650150af548684defac6ccb74c7c33` |
| #39 | Exact terminal Work reactivation/resume | `cfed6355b1db426c271235572522a6e751b4e808` |
| #40 | Completion-closure and replay safety | `870ac618c75e3d9efa1fd1e20ea3618b56f8aceb` |

Supporting PRs #30–#36 contain the rollout documentation, evidence contract, guarded CLI and intermediate corrections. Their exact commits remain available in Git/PR history. The final deployed source head for completion closure is `870ac618c75e3d9efa1fd1e20ea3618b56f8aceb`.

## Local rollout evidence set

```text
terminal-reactivate.json
terminal-resume.json
completion-closure-deploy.json
completion-closure-repair.json
completion-closure-verify.json
completion-closure-replay.json
completion-closure-replay-verify.json
```

Evidence root used by the guarded operators:

```text
outputs/tiktok-durable-recovery/exact-2026-07-23
```

The `outputs/` evidence is local operational material and must not be added to source releases unless a separate sanitized evidence policy approves it.

## Final acceptance

- [x] Original generation and Work identity preserved.
- [x] Existing partial State rows preserved.
- [x] Missing initial Observations repaired exactly once.
- [x] State, Observation, initial Observation and Coverage entity counts equal 2,021.
- [x] Duplicate State/Observation groups equal zero.
- [x] Coverage expected=observed=2,021 and failed=0.
- [x] Work lifecycle is `completed`.
- [x] Original DLQ is retained and marked `redriven` with completed recovery metadata.
- [x] Terminal completion-closure DLQ is retained and marked `redriven` with completed closure metadata.
- [x] Failed-recovery DLQ remains retained as forensic evidence.
- [x] Exact same-generation replay changes no durable business facts.
- [x] Lark business writes remain zero.
- [x] Schedules remain disabled.
- [x] Production remains blocked.

## Prohibited follow-up actions

Do not rerun any of the following for this incident:

```text
bootstrap send
recovery send
terminal resume
completion-closure repair
exact replay
manual SQL cleanup
DLQ deletion
business-fact deletion
Lark Canonical backfill
schedule enablement
```

A new incident requires a new immutable identity, new task, new evidence root and separate approval.

## Next task boundary

```text
CURRENT_TASK = TIKTOK_ORGANIC_DURABLE_RECOVERY_ROLLOUT_COMPLETE
NEXT_TASK = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_CONNECTOR_PLANNING
NEXT_TASK_STATUS = NOT_STARTED
GOOGLE_ADS_PR_17 = DRAFT_HOLD
SCHEDULES = DISABLED
PRODUCTION = BLOCKED
```

The next task must begin by reading `AGENTS.md`, this file, `PROJECT_BRAIN.md` and the relevant Google Ads/Storage contracts. It must not reuse or merge Draft PR #17 without a full current-codebase review and a new approved implementation scope.
