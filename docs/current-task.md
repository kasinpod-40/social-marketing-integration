# Current Task — Pre-Meta Full Codebase Hardening v0.11.1

## Status

- **Task status:** `implementation_in_progress`
- **Batch C status:** `approved_for_implementation`
- **Accepted code baseline:** `2306509`
- **Merged review:** `PR #3`
- **Working branch:** `codex/pre-meta-hardening-batch-c`
- **Working release:** `v0.11.1-pre-meta-hardening`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Last updated:** `2026-07-20`

Atomic batches A and B are implemented, reviewed, CI-verified and squash-merged to `main`. Batch C is now approved for implementation on the dedicated feature branch above. Batch D remains blocked until Batch C is independently reviewed and merged. No deployment or external-system mutation is authorized.

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

Codex must update this section before handoff for independent review.

- **Implementation status:** `not_started`
- **Files changed:** pending
- **Migrations added:** pending
- **Commands run:** pending
- **Focused tests:** pending
- **Full gate:** pending
- **External/Live UAT:** not authorized for Batch C
- **Remaining risks:** pending
- **Suggested commit:** `refactor: harden runtime reliability structure`

## Remaining — Atomic batch D

- [ ] Add unused, duplicate-code and complexity gates.
- [ ] Produce legacy file/table usage report and deprecation plan.
- [ ] Update Project Brain and CHANGELOG.
- [ ] Verify clean release package and guarded DEV rollout plan.

## Safety state

Migration `0007` has not been applied to Remote D1. No Meta connector, Lark Apply, external Meta/YouTube/TikTok call, Remote D1 migration, Queue message, Worker deployment, schedule change or Production mutation is authorized or has been performed as part of Batch C planning.