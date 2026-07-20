# Current Task — Pre-Meta Full Codebase Hardening v0.11.1

## Status

- **Task status:** `implementation_in_progress`
- **Accepted code baseline:** `2306509`
- **Merged review:** `PR #3`
- **Working release:** `v0.11.1-pre-meta-hardening`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Last updated:** `2026-07-20`

Atomic batches A and B are implemented, reviewed, CI-verified and squash-merged to `main`. Batches C and D remain. No deployment or external-system mutation has occurred.

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
- Sync Log counters represent the current invocation; cumulative work totals live under `stagedBusiness.workTotals`.
- Generic Organic/Ads facts use explicit source timezone; Ads uses the advertising-account timezone.
- Duplicate source/content identities fail closed before business writes.
- Operational outputs redact customer/platform/Lark identifiers, including numeric IDs, while explicit safe counters remain visible.
- D1 remains the primary reliability source of truth.
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

## Verification evidence

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

## Remaining — Atomic batch C

- [ ] Split Worker routing and runtime composition.
- [ ] Split the 958-line staged TikTok orchestrator into focused helpers without changing its verified contract.
- [ ] Add non-blocking durable Lark mirror delivery.
- [ ] Add report date-range reads or bounded fallback.

## Remaining — Atomic batch D

- [ ] Add unused, duplicate-code and complexity gates.
- [ ] Produce legacy file/table usage report and deprecation plan.
- [ ] Update Project Brain and CHANGELOG.
- [ ] Verify clean release package and guarded DEV rollout plan.

## Safety state

Migration `0007` has not been applied to Remote D1. No Meta connector, Lark Apply, external Meta/YouTube/TikTok call, Remote D1 migration, Queue message, Worker deployment, schedule change or Production mutation has been performed.
