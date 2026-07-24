# Current Task — Multi-Connector Customer Connection Foundation

## Authoritative status

```text
TASK_STATUS                         = STACKED_DRAFT_REVIEW_REMOTE_ROLLOUT_PENDING
CURRENT_PROGRAM                     = MULTI_CONNECTOR_CUSTOMER_CONNECTION_FOUNDATION
FIRST_PRIORITY                      = GOOGLE_ADS_AND_YOUTUBE_CUSTOMER_OAUTH
OTHER_CONNECTORS                    = PLANNED_NOT_STARTED
INTEGRATION_WORKSPACE               = development / integration_workspace
GOOGLE_ADS_PR_17                    = DRAFT_HOLD
SCHEDULES                           = DISABLED
PRODUCTION                          = BLOCKED
REMOTE_D1_MIGRATION                 = NOT_AUTHORIZED
WORKER_DEPLOYMENT                   = NOT_AUTHORIZED
GOOGLE_REDIRECT_URI_LIVE_CHANGE     = NOT_AUTHORIZED
CONNECT_LINK_GENERATION             = NOT_AUTHORIZED
CONNECTOR_IMPLEMENTATION            = COMPLETE_DRAFT_PRS
STACKED_DRAFT_PRS                   = #42 -> #43 -> #44
MOCK_CONTRACT_TEST                  = PASS
INTEGRATION_WORKSPACE_DEPLOYMENT    = NOT_RUN
CUSTOMER_OAUTH                      = NOT_RUN
LIVE_ACCESS                         = NOT_RUN
LIVE_DATA_UAT                       = NOT_RUN
LARK_WRITE_UAT                      = NOT_APPLICABLE_THIS_PHASE
RELIABILITY_UAT                     = NOT_RUN
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
Operator creates signed one-time invitation
→ Customer opens connector-specific URL
→ Worker validates and consumes invitation
→ Worker creates signed one-time OAuth state
→ Google authorization-code consent
→ Callback validates and consumes state
→ Code exchange
→ AES-GCM encrypted Refresh Token persistence
→ Access Token refresh/lifecycle proof
→ Provider identity validation
→ Connection metadata update
→ Connected / Action required page
```

Permanent rules:

- Invitation TTL default 24 hours and configurable.
- OAuth state TTL default 10 minutes and configurable.
- Invitation and OAuth state are signed, expiring, nonce-bound and one-time.
- Google Ads and YouTube never share a Connection record or combined Consent.
- Dynamic customer Refresh Tokens never use `.dev.vars`, Lark, Queue payload or plaintext D1.
- Existing YouTube environment credential adapter remains for compatibility.
- Callback never emits Queue messages and never writes Lark or Marketing business facts.
- Unknown HTTP routes return 404; unsupported methods on known routes return 405.
- Every Business schedule remains false.

## Data model authority

Exact contract:

`docs/customer-connection-oauth-contract-v1.md`

The existing `connections` table remains the metadata authority. Migration extends it additively and leaves legacy encrypted-token columns unused. Distinct-grain tables are added only for:

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

- `GET /connect/google-ads`
- `GET /oauth/google-ads/callback`
- Exact `adwords` scope and offline access.
- Google Ads identity validation against the approved advertiser and manager mapping.
- OAuth success remains `connected` when Developer Token access is pending.
- Success output contains only Connection ID, masked/approved identity and statuses.
- No Google Ads business ingestion and no PR #17 signed-delivery merge.

## PR C — YouTube scope

- `GET /connect/youtube`
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

## Implementation result

Source implementation is complete and published as three stacked Draft PRs. No merge, Remote D1 migration, deployment, Google Cloud configuration, invitation generation, Queue message or Lark write was performed.

### Published stacked PRs

The reviewed change is split as:

1. PR A `#42` / `codex/customer-oauth-foundation`: migration/shared crypto, D1 repositories, runtime config, invitation/state/operator HTTP boundary and shared tests.
2. PR B `#43` / `codex/google-ads-customer-oauth`: Google Ads v24 read-only identity/access validation, OAuth flow/routes and tests.
3. PR C `#44` / `codex/youtube-customer-oauth`: reuse/extension of YouTube client, 0/1/N identity selection flow/routes, tests and release documentation.

All three PRs are Draft. Review/merge order remains `#42` → `#43` → `#44`. Draft PR #17 remains untouched and must not be merged/cherry-picked.

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
```

`npm test` completed its first Unit phase 673/673; after the final provider isolation, reconnect and PKCE lifecycle regressions were added, `npm run test:unit` passed 677/677. Its first Worker phase was blocked by the local sandbox (`EPERM` on Wrangler log/loopback), then the exact Worker gate passed 9/9 with its log redirected to `/tmp` and local runtime permission granted.

### Security review

- No real Secret/Token is present in source, examples, test outputs, URL query other than signed invitation/state/selection bearer artifacts, or operational logs.
- Signing/operator/encryption/client/developer keys are named only and must be Worker Secrets.
- Dynamic Refresh Tokens never use `.dev.vars`, legacy `connections.encrypted_*` columns, Queue payload or Lark.
- Central redaction now covers connection/customer/invitation/state/nonce/redirect identifiers.
- Operator authorization compares fixed-length SHA-256 digests with timing-safe comparison where the runtime supports it.
- Unknown route and unsupported method handling are explicit; browser responses use no-store/no-referrer/security headers.
- Encrypted credential replacement is transactional and tamper/key-version failures fail closed.

### Remaining blockers

- Draft PR review and merge remain pending in order `#42` → `#43` → `#44`.
- Migration `0011_customer_connection_oauth.sql` is not applied remotely.
- Worker Secrets and non-secret runtime mappings are not configured.
- Exact Redirect URIs are not registered in Google Cloud.
- Worker is not deployed; HTTP smoke, customer OAuth and Live access remain untested.
- Connect links cannot exist until the guarded rollout receives explicit approval.

Exact rollout and rollback commands: `docs/customer-connection-oauth-rollout.md`.

## Remote rollout approval boundary

Implementation must stop before all remote actions. After local/CI review passes, report:

- additive migration and backup requirement;
- routes and Redirect URIs;
- Secret names only;
- exact deploy/rollback commands;
- schedules false, Queue messages zero, Lark writes zero;
- guarded link-generation command.

User approval is required before Remote D1 backup/migration, Worker deployment, Google Cloud Redirect URI change or Connect-link generation.

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
