# Current Task — Pre-Meta Full Codebase Hardening v0.11.1

## Task metadata

- **Status:** `implementation_in_progress`
- **Source baseline:** `68907e2`
- **Working branch:** `codex/tiktok-staged-business`
- **Draft review:** `PR #3`
- **Working release:** `v0.11.1-pre-meta-hardening`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Implementation gate:** `approved_by_user_2026-07-20`
- **Last updated:** `2026-07-20`

## Previous task closeout

- TikTok DEV durable resume, guarded deployment, scheduled smoke and final D1 health passed on `d7b28c9`.
- YouTube remains `dev_ready`; customer-owned 837-video Live UAT remains a Production blocker.
- Meta Blueprint draft exists but is not approved; canonical Ads key parity has been corrected in the review artifacts and repository contract.
- Production remains disabled.

## Security prerequisite

YouTube API/OAuth credentials visible in a previous screenshot must be rotated before the next external UAT or deployment. Offline implementation and tests may continue, but old credentials must not be used for external calls.

## Objective

Harden the existing codebase before Facebook, Instagram and Meta Ads implementation. Remove contradictory contracts, reduce duplicated runtime orchestration, make pagination and processing bounded and resumable, correct timezone/date semantics, strengthen operational redaction, prevent stale alert reopening, and add automated architecture/performance regression gates without breaking existing TikTok or YouTube behavior.

## In scope

1. Correct Meta Blueprint and canonical Ads field-name parity.
2. Replace Bangkok-hardcoded canonical date conversion with explicit source-timezone/date contract.
3. Add a shared single-page source contract suitable for durable staging and bounded processing.
4. Harden `MetaGraphClient` with single-page cursor reads, repeated-cursor protection, timeout covering body reads, bounded retry/backoff and rate-limit metadata.
5. Remove end-to-end unbounded TikTok source aggregation; process staged units in bounded batches.
6. Standardize duplicate resolution semantics.
7. Expand operational redaction for customer/platform/Lark identifiers while preserving safe counters.
8. Prevent a resolved alert from reopening under the same incident identity.
9. Decouple Lark reliability mirror latency from D1-primary business completion through a durable/bounded delivery contract.
10. Split Worker routing/orchestration into focused modules while preserving Queue schemas and job behavior.
11. Add date-range-aware report source reads or a bounded fallback contract.
12. Add unused/duplicate/complexity/large-account/contract-parity gates.
13. Verify legacy files/tables before deprecation or removal; no destructive D1 migration without evidence.
14. Update documentation and release handoff from verified evidence only.

## Out of scope

- Facebook, Instagram or Meta Ads connector business implementation
- Meta token creation, App Review or external API UAT
- Lark Meta schema Apply or record writes
- Production deployment or customer-resource mutation
- Destructive deletion of legacy D1 tables in this release
- Rotating credentials on behalf of the user

## Required contracts

### Backward compatibility

- Existing TikTok and YouTube Queue schema/version remain accepted.
- Existing stable keys remain unchanged unless a migration and compatibility path are explicitly provided.
- Schedules remain disabled/enabled exactly as configured; this release must not silently change activation.
- D1 migrations are additive and replay-safe.
- Script/validation callers without a Durable work store retain the legacy compatibility path.

### Memory and pagination

- Provider clients expose single-page reads.
- Durable work stores source pages/units with generation fencing.
- Live Queue-backed TikTok normalization/planning/writing consumes one staged unit at a time.
- RAW payloads are not rebuilt into one account-sized array in the Queue-backed business path.
- Incremental planning retains compact source state required for checkpoint reconciliation, not full RAW payloads.
- Repeated or missing cursors fail closed.
- Completeness is checked against persisted source/page/selected-row counts.

### Date and timezone

- Canonical domain factories never assume `Asia/Bangkok` for cross-platform facts.
- Organic snapshots receive an explicit source timezone or already-resolved epoch.
- Ads daily facts use the advertising account timezone.
- Existing TikTok behavior remains Asia/Bangkok through its platform adapter/default, not a generic-domain hardcode.

### Duplicate policy

- Duplicate identity resolution uses one deterministic rule.
- Prefer the latest explicit source update timestamp when available.
- Equal or unavailable timestamps use later page/sequence while surfacing duplicate counts for readiness handling.
- Queue-backed TikTok detects duplicate source-record IDs and duplicate content IDs across different staged pages before the first business write.

### Security

- Secrets never enter logs, D1 operational payloads, Lark mirrors or release artifacts.
- Customer profile, account/page/IG/ad IDs, Lark table IDs, handles and generic identity values are redacted or replaced with safe references in operational output.
- Numeric identifiers are not exempt merely because they are numbers.
- Safe numeric counters with ID-like names are preserved only through an explicit allowlist.

### Reliability

- D1 remains primary source of truth.
- Each staged unit is marked complete only after both Content and Daily plans succeed.
- Retry begins from the first uncompleted business unit and re-plans that unit idempotently.
- Incremental checkpoint commits only after every business unit completes.
- A failure after checkpoint/business completion replays durable completion without a second business write.
- Sync Log write counters represent the current invocation; cumulative durable-work totals are exposed separately under `stagedBusiness.workTotals`.
- A slow/unavailable Lark mirror must not invalidate an already committed D1 primary result.
- Mirror failures remain observable and retryable through a bounded durable contract.
- Resolved alerts do not reopen under the same incident generation unless an explicit new generation/reopen operation is used.

## Acceptance criteria

1. Meta Blueprint field/key names match source canonical contracts.
2. Generic Organic and Ads date tests cover at least two timezones and a DST timezone.
3. Meta page client tests cover two-page reads, repeated cursor, missing cursor, body timeout, 429 retry, 5xx retry and max-attempt exhaustion.
4. TikTok interruption/resume processes staged source units without rebuilding all RAW source records into one array.
5. Duplicate resolution has deterministic tests across Organic normalization, Sync Engine behavior and cross-page TikTok identities.
6. Redaction tests cover token/secret plus customer profile, account key, Page ID, IG ID, Ad Account ID and Lark Table ID in string and numeric forms.
7. Alert persistence tests prove resolved incidents remain resolved under duplicate writes.
8. Lark mirror outage/timeout does not fail or indefinitely delay D1-primary completion.
9. Worker runtime regression passes for TikTok, YouTube, reporting, DLQ and redrive.
10. Large-account source fixtures pass for 10,000 entities with bounded page/unit size; business interruption/resume passes for 1,000 entities across 10 units.
11. `npm ci`, `npm run check`, `npm test`, focused reliability/large-account tests, `npm audit`, and `npm run deploy:dry-run` pass.
12. No Secret, local config, generated manifest, macOS metadata or unnecessary build artifact is committed.
13. No External API, Remote D1, Queue, Lark mutation, deployment, schedule or Production change is claimed without live evidence.

## Implementation plan

### Atomic batch A — contracts, dates and security

- [x] Canonical timezone/date contract implemented with explicit IANA timezone support and DST-focused tests.
- [x] Organic duplicate behavior aligned with deterministic later-sequence resolution and surfaced duplicate counts.
- [x] Operational redaction expanded to customer/platform/Lark identifiers, including numeric values, while preserving allowlisted counters.
- [x] Additive D1 migration added to preserve resolved alert status for the same alert identity.
- [x] Meta Blueprint and repository contract corrected to canonical Ads key names.
- [x] Focused and full verification gates passed in GitHub Actions.

### Atomic batch B — bounded source processing

- [x] Shared bounded paged-source contract added with missing/repeated/max-page guards.
- [x] Meta Graph transport hardened for single-page reads, bounded retry, body timeout and usage metadata.
- [x] TikTok staged-unit async reader and persisted-count completeness check added.
- [x] 10,000-record bounded page/unit fixtures added.
- [x] Queue-backed TikTok live application path switched from compatibility aggregation to staged-unit processing.
- [x] Full-source identity/duplicate preflight completes before the first business write.
- [x] Content + Daily are planned/written per unit with generation fencing and persisted unit completion.
- [x] Interruption/resume regression covers a 1,000-row source, 10 units, failed Daily write, no source refetch and no duplicate stable-key create.
- [x] Per-attempt Sync Log counters are separated from cumulative durable-work totals.

### Atomic batch C — runtime and reliability structure

- [ ] Split Worker handlers/composition.
- [ ] Split the staged TikTok orchestration module into focused state/result/checkpoint helpers without changing its verified contract.
- [ ] Add non-blocking durable Lark mirror delivery contract.
- [ ] Add report date-range reads or bounded fallback.
- [x] TikTok/YouTube/report/DLQ/redrive regression suite passed for the current branch.

### Atomic batch D — cleanup and release gates

- [ ] Add unused/duplicate/complexity audits.
- [ ] Produce legacy usage report and deprecation markers.
- [ ] Update Project Brain/CHANGELOG and verify clean release package after review approval.
- [ ] Merge only after draft PR review; no automatic merge.

## Verification status

GitHub Actions `Branch Verification` passed on branch head `5390b77` / draft PR #3:

- `npm ci` — passed
- `npm run check` — passed
- focused staged TikTok tests — 2 passed, 0 failed
- `npm test` — Node tests 462 passed, Workers runtime tests 8 passed
- `npm run test:report-reliability` — 64 passed, 0 failed
- `npm audit --audit-level=high` — passed
- `npm run deploy:dry-run` — passed

The verified regression includes interruption after Content succeeds but Daily fails, resume from the failed unit, no RAW source-page refetch, no duplicate create, bounded 100-row write batches, final 1,000/1,000 destination records and one checkpoint commit.

The GitHub review found and corrected one post-gate accounting issue: a resumed success originally returned cumulative writes from the prior attempt. The final verified contract now reports only current-attempt writes in the Sync Log result and keeps cumulative work totals separately.

## Implementation result

`review_ready_on_draft_pr — Atomic batch A and B source contracts are implemented and CI-verified on PR #3. The branch is not merged or deployed. Batch C/D remain.`

Migration `0007` has not been applied to Remote D1. No Meta connector, Lark Apply, external Meta call, Remote D1 migration, Queue mutation, Worker deployment, schedule change or Production mutation has been performed.
