# Current Task — Pre-Meta Full Codebase Hardening v0.11.1

## Status

- **Task status:** `review_pending`
- **Batch C status:** `implemented_local_gates_passed`
- **Accepted code baseline:** `2306509`
- **Merged review:** `PR #3`
- **Working branch:** `codex/pre-meta-hardening-batch-c`
- **Working release:** `v0.11.1-pre-meta-hardening`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Last updated:** `2026-07-20`

Atomic batches A and B are implemented, reviewed, CI-verified and squash-merged to `main`. Batch C implementation and local gates are complete on the dedicated feature branch above and now await GitHub CI plus independent review. Batch D remains blocked until Batch C is independently reviewed and merged. No deployment or external-system mutation is authorized.

## Security prerequisite

Previously exposed YouTube API/OAuth credentials must be rotated before the next external UAT or deployment. Old credentials must not be used for external calls.

## Locked scope and contracts

- Facebook, Instagram and Meta Ads connector implementation remains blocked until this hardening release and Meta Blueprint approval are complete.
- Existing TikTok/YouTube Queue schemas and stable keys remain compatible.
- Queue-backed TikTok uses Durable source units; it must not rebuild the full RAW account payload into one Array.
- Every source unit is preflighted before the first write.
- A unit is complete only after both Content and Daily writes succeed.
- Retry resumes at the first uncompleted unit and re-plans it idempotently.
- Incremental checkpoint commits only after all units complete.
- Generation fencing is required before reads, writes and checkpoint commits.
- Persisted staged phase names, plan-fingerprint contract and completion replay semantics must remain compatible with work already stored in D1.
- Sync Log counters represent the current invocation; cumulative work totals live under `stagedBusiness.workTotals`.
- Generic Organic/Ads facts use explicit source timezone; Ads uses the advertising-account timezone.
- Duplicate source/content identities fail closed before business writes.
- Operational outputs redact customer/platform/Lark identifiers, including numeric IDs, while explicit safe counters remain visible.
- D1 remains the primary reliability source of truth.
- Lark reliability tables are a human-facing mirror and must never become the condition for acknowledging a successful D1 primary write.
- Resolved alerts cannot reopen under the same incident identity.
- Production remains customer-owned and disabled.

## Completed — Atomic batch A

- [x] Meta Graph single-page transport with cursor guards, body timeout, bounded retry/backoff and usage metadata.
- [x] Explicit IANA timezone contract with UTC, Bangkok and DST tests.
- [x] Deterministic duplicate handling and readiness counters.
- [x] Expanded identifier redaction with numeric-ID coverage.
- [x] Additive migration `0007_preserve_resolved_system_alerts.sql` created locally.
- [x] Meta Blueprint canonical Ads key parity corrected.

## Completed — Atomic batch B

- [x] Shared bounded page contract and 10,000-record source fixtures.
- [x] Queue-backed TikTok switched to staged-unit business processing.
- [x] Full-source identity and cross-page duplicate preflight before writes.
- [x] Content + Daily written per unit with persisted completion.
- [x] Retry after Daily failure resumes without RAW source-page refetch.
- [x] Per-attempt counters separated from durable cumulative totals.
- [x] Legacy non-durable script/validation path preserved with the exact prior Git blob.
- [x] PR #3 squash-merged to `main` as `2306509`.

## Verification evidence for merged baseline

GitHub Actions `Branch Verification` run `29735468178` passed on the final PR merge ref for head `1274fe1`:

- `npm ci` — passed
- `npm run check` — passed
- focused staged TikTok tests — 2 passed, 0 failed
- `npm test` — Node 462 passed; Workers runtime 8 passed
- `npm run test:report-reliability` — 64 passed, 0 failed
- `npm audit --audit-level=high` — passed
- `npm run deploy:dry-run` — passed

The workflow uses locked dependency installation, has no `continue-on-error` or `|| true`, and enables Bash `pipefail` for piped test commands.

The interruption regression uses 1,000 source records across 10 units, fails Daily after Content succeeds in unit 4, resumes from that unit, does not refetch RAW pages, creates no duplicate stable key, keeps write batches at 100 rows, finishes with 1,000 Content and 1,000 Daily rows, and commits one checkpoint.

## Approved implementation — Atomic batch C

### Objective

Reduce runtime/orchestrator complexity and remove two remaining unbounded or non-durable reliability paths without changing verified TikTok, YouTube, reporting or Queue business contracts.

### C1 — Split Worker routing and runtime composition

- Refactor `apps/sync-worker/src/index.js` into focused modules for Worker entry composition, scheduler production, Queue role routing/terminal handling, active job routing and infrastructure/runtime construction.
- Keep `apps/sync-worker/src/index.js` as the stable public composition root and preserve all existing exports used by tests/scripts, including `createSyncWorker`, `processJob`, `createInfrastructure`, `createOperationalStore`, `classifyQueueBatch`, `buildScheduledJobs`, `PRIMARY_SCHEDULE_CRON`, `YOUTUBE_SCHEDULE_CRON` and `QUEUE_ROLES`.
- Preserve lazy initialization: Runtime config, Lark client/repository, D1 stores and YouTube clients must not be created before the selected route requires them.
- Preserve Main/DLQ/Unknown fail-closed behavior, retry/ack semantics, terminal persistence, redaction and scheduler ordering.
- Do not change Queue message schemas, Job Catalog identifiers, Cron values or feature-flag meaning.

### C2 — Split the staged TikTok orchestrator

- Split the current staged TikTok business orchestrator into focused phase, state/result and validation helpers while keeping `syncTikTokStagedBusinessToLark` at its current import path.
- The public orchestrator should express the sequence only: load/replay → source analysis → all-unit preflight → unit writes → checkpoint → completion.
- Preserve the exact persisted phase identifiers, work-generation fencing points, plan fingerprint input, current-attempt counters, cumulative `stagedBusiness.workTotals`, partial-result semantics and completion replay behavior.
- Keep unit preflight before the first business write and keep a unit incomplete until both Content and Daily writes succeed.
- Do not modify the legacy non-durable compatibility file or alter its Git-blob-equivalent behavior.
- Do not rebuild staged RAW pages into one full-source Array.

### C3 — Non-blocking durable Lark reliability mirror

- Replace the current request-blocking best-effort Lark reliability mirror path with a D1-backed durable delivery mechanism.
- D1 Sync Run/System Alert/Dead-letter persistence remains the blocking primary operation and source of truth.
- Successful primary persistence must return without waiting for a Lark network call.
- Mirror work must be persisted before it is considered scheduled for delivery, use deterministic idempotency identity and survive Worker termination/retry.
- Delivery must be bounded, retryable and safe to run more than once. A Lark failure must leave work pending/retryable and must not roll back or relabel the already successful D1 primary write.
- A successful Lark delivery must mark the durable mirror item complete idempotently. Duplicate queue delivery or drain replay must not create duplicate Sync Log/System Alert rows.
- Add an additive local migration after `0007`; do not apply any migration remotely in this task.
- Add the delivery/drain route to the central Job Catalog if Queue delivery is used. Unknown schema/job versions remain permanent errors.
- Operational logs may expose only safe delivery status/counters; no payload identity, token, Table ID or customer ID leakage.

### C4 — Report date-range reads or bounded fallback

- Stop loading every `MKT_Content_Daily` row for an account when the active repository/client supports server-side filtered reads.
- Read only the current period, comparison period and the baseline snapshot dates required by the cumulative-delta formula. Preserve existing Daily/Weekly metric semantics and partial-baseline behavior exactly.
- Content metadata may be read by the external content IDs selected from the bounded snapshot set. If a compatibility adapter lacks the new filtered-read method, use an explicit bounded fallback rather than an unbounded account scan.
- The fallback must have a finite configurable/default cap, report its strategy/counters, and fail closed with a permanent safe error when the cap is exceeded.
- Lark search pagination must retain missing/repeated cursor and maximum-page guards. Filter request bodies must use only request fields supported by the existing Lark contract.
- Report output stable keys, formula version, report period identity, stale-rank cleanup and write ordering remain unchanged.

## Required tests and gates for Batch C

### Focused regressions

- Worker-runtime tests prove all existing Main/DLQ/Unknown/Scheduled routes still behave identically after module extraction and that dependency factories remain lazy.
- Staged TikTok tests prove persisted phase replay, failure after Content, failure after checkpoint, completion replay and 1,000-record bounded-unit behavior are unchanged after the split.
- Durable mirror tests cover primary success with Lark unavailable, restart/replay, duplicate delivery, bounded drain, retryable failure, permanent malformed payload and successful completion marking.
- Report tests prove server-side date-range selection includes both required baseline dates, current/comparison windows produce the same metrics as the previous full-account read, compatibility fallback is bounded and cap overflow fails closed before output writes.
- Architecture tests show no circular dependency and no duplicate routing/result logic introduced by the split.

### Full gate

```bash
npm ci
npm run check
node --test tests/application/tiktok-staged-business-sync.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Add focused commands for every new test file. Do not weaken, skip or hide any existing gate.

## Out of scope for Batch C

- Remote D1 migration or data mutation
- Worker deployment
- Queue message to live Cloudflare Queues
- Lark write against DEV or Production
- TikTok, YouTube or Meta external API call
- Schedule/feature-flag change
- Credential rotation execution
- Meta/Facebook/Instagram connector implementation
- Batch D cleanup gates, release archive and DEV rollout execution
- Production mutation of any kind

## Implementation result

- **Implementation status:** `complete_pending_independent_review`
- **Branch:** `codex/pre-meta-hardening-batch-c`
- **External/Live UAT:** not run and not authorized for Batch C

### Delivered scope

- [x] C1 split Worker composition, scheduling, Queue routing, terminal handling, active-job routing and infrastructure into focused modules while preserving the public `index.js` exports and lazy dependency construction.
- [x] C2 split the staged TikTok orchestrator into contract, phase and state/result modules while preserving persisted phase names, generation fences, plan fingerprint, checkpoint and replay contracts.
- [x] C3 added a D1-backed durable Lark reliability-mirror outbox and generic Queue drain route. D1 remains the blocking primary; Lark delivery is bounded, idempotent and retryable without relabelling a successful primary write.
- [x] C4 added bounded report-source loading with server-side Lark filters when available and a finite page/record-capped compatibility fallback.
- [x] Removed the temporary source-export workflow and trigger files used only to obtain a local review copy in this tool environment.

### Files changed

- Worker/runtime split:
  - `apps/sync-worker/src/index.js`
  - `apps/sync-worker/src/active-job-router.js`
  - `apps/sync-worker/src/queue-batch-router.js`
  - `apps/sync-worker/src/runtime-infrastructure.js`
  - `apps/sync-worker/src/scheduled-jobs.js`
  - `apps/sync-worker/src/scheduled-producer.js`
  - `apps/sync-worker/src/sync-worker.js`
  - `apps/sync-worker/src/worker-runtime-support.js`
- Durable TikTok orchestration split:
  - `packages/application/src/use-cases/sync-tiktok-staged-business-to-lark.js`
  - `packages/application/src/use-cases/tiktok-staged-business-contract.js`
  - `packages/application/src/use-cases/tiktok-staged-business-phases.js`
  - `packages/application/src/use-cases/tiktok-staged-business-state.js`
- Durable Lark mirror:
  - `migrations/0008_reliability_mirror_outbox.sql`
  - `packages/application/src/jobs/job-catalog.js`
  - `packages/application/src/use-cases/deliver-reliability-mirror.js`
  - `packages/reliability/src/d1-reliability-mirror-outbox.js`
  - `packages/reliability/src/durable-mirror-reliability-store.js`
  - `packages/reliability/src/runtime-factory.js`
- Bounded report reads:
  - `packages/application/src/reports/load-tiktok-organic-report-source.js`
  - `packages/application/src/use-cases/generate-tiktok-organic-report.js`
  - `packages/connectors/src/lark/lark-bitable.client.js`
  - `packages/connectors/src/lark/lark-record-repository.js`
- Runtime config/tooling:
  - `package.json`
  - `wrangler.sync.example.jsonc`
- Tests:
  - `tests/application/deliver-reliability-mirror.test.js`
  - `tests/application/generate-tiktok-organic-report.test.js`
  - `tests/application/load-tiktok-organic-report-source.test.js`
  - `tests/application/sync-worker-job-routing.test.js`
  - `tests/application/tiktok-staged-business-sync.test.js`
  - `tests/connectors/lark-bitable-client.test.js`
  - `tests/connectors/lark-record-repository.test.js`
  - `tests/reliability/d1-reliability-mirror-outbox.test.js`
  - `tests/reliability/durable-mirror-reliability-store.test.js`
  - `tests/reliability/reliability-mirror-outbox-migration.test.js`
  - `tests/reliability/runtime-factory.test.js`

The legacy compatibility file `packages/application/src/use-cases/sync-tiktok-creator-native-to-lark-legacy.js` was not modified.

### Migration added

- `0008_reliability_mirror_outbox.sql` — additive D1 durable outbox with deterministic identity, pending/delivered/permanent terminal states, delivery attempts and a monotonic `revision` fence.
- Local empty-database migration replay passed for migrations `0001` through `0008`.
- No Remote D1 migration was applied.

### Commands and verification

```bash
npm ci
npm run check
node --test \
  tests/application/deliver-reliability-mirror.test.js \
  tests/application/load-tiktok-organic-report-source.test.js \
  tests/application/sync-worker-job-routing.test.js \
  tests/application/tiktok-staged-business-sync.test.js \
  tests/connectors/lark-bitable-client.test.js \
  tests/connectors/lark-record-repository.test.js \
  tests/reliability/d1-reliability-mirror-outbox.test.js \
  tests/reliability/durable-mirror-reliability-store.test.js \
  tests/reliability/reliability-mirror-outbox-migration.test.js \
  tests/reliability/runtime-factory.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Results:

- Focused Batch C regression: **107 passed, 0 failed**
- Node Unit/Integration: **488 passed, 0 failed**
- Workers runtime: **8 passed, 0 failed**
- Report reliability: **69 passed, 0 failed**
- Architecture: **133 source files / 303 local dependencies / 0 cycles**
- Repository hygiene: passed
- Dependency audit: **0 vulnerabilities**
- Wrangler dry-run: passed at **651.07 KiB / gzip 128.90 KiB**
- SQLite migration replay `0001–0008`: passed
- `git diff --check`: passed

### Verified failure and replay behavior

- Queue wake-up failure does not change an already successful D1 Sync Run into `failed`; pending outbox work can be signalled again by a later operation.
- The outbox `revision` fence prevents an older in-flight delivery from marking a newer payload revision as delivered.
- Retryable Lark mirror failure remains pending; malformed/permanent payload becomes terminal without changing the D1 primary business result.
- Duplicate/replayed mirror delivery uses Lark stable-key upsert and idempotent outbox completion.
- TikTok failure after Content, failure after checkpoint, completion replay and 1,000-record bounded-unit resume do not repeat completed business writes or refetch staged RAW pages.
- Report fallback cap and repeated/missing pagination cursor guards fail closed before output planning or writes.

### Remaining risks and review gates

- Migration `0008` and the mirror delivery path have automated/local evidence only; DEV migration, Queue delivery and Lark write remain deliberately unexecuted.
- Server-side Lark report filters are covered by request-contract tests but still require guarded DEV live verification before rollout.
- Runtime throughput, Queue wake-up frequency and outbox backlog need DEV observation after an approved rollout.
- GitHub Actions must pass on the pushed branch and PR merge ref before a merge decision.
- Batch D cleanup gates, Project Brain/CHANGELOG closeout and guarded DEV rollout plan remain pending.

- **Suggested commit:** `refactor: harden runtime reliability structure`

## Remaining — Atomic batch D

- [ ] Add unused, duplicate-code and complexity gates.
- [ ] Produce legacy file/table usage report and deprecation plan.
- [ ] Update Project Brain and CHANGELOG.
- [ ] Verify clean release package and guarded DEV rollout plan.

## Safety state

Migrations `0007` and `0008` have not been applied to Remote D1. No Meta connector, Lark Apply, external Meta/YouTube/TikTok call, Remote D1 migration, live Queue message, Worker deployment, schedule change or Production mutation is authorized or has been performed as part of Batch C implementation.