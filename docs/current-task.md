# Current Task — Pre-Meta Full Codebase Hardening v0.11.1

## Task metadata

- **Status:** `implementation_in_progress`
- **Source baseline:** `fc796a4`
- **Working release:** `v0.11.1-pre-meta-hardening`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Implementation gate:** `approved_by_user_2026-07-20`
- **Last updated:** `2026-07-20`

## Previous task closeout

- TikTok DEV durable resume, guarded deployment, scheduled smoke and final D1 health passed on `d7b28c9`.
- YouTube remains `dev_ready`; customer-owned 837-video Live UAT remains a Production blocker.
- Meta Blueprint draft exists but is not approved; canonical Ads key parity has now been corrected in the review artifacts and repository contract.
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

### Memory and pagination

- Provider clients expose single-page reads.
- Durable work stores source pages/units with generation fencing.
- Normalization/planning/writing consumes bounded units and releases memory between chunks.
- Repeated or missing cursors fail closed.
- Completeness is checked from persisted counts, not inferred from final in-memory array length.

### Date and timezone

- Canonical domain factories never assume `Asia/Bangkok` for cross-platform facts.
- Organic snapshots receive an explicit source timezone or already-resolved epoch.
- Ads daily facts use the advertising account timezone.
- Existing TikTok behavior remains Asia/Bangkok through its platform adapter/default, not a generic-domain hardcode.

### Duplicate policy

- Duplicate identity resolution uses one deterministic rule.
- Prefer the latest explicit source update timestamp when available.
- Equal or unavailable timestamps use later page/sequence while surfacing duplicate counts for readiness handling.
- TikTok duplicate RAW identities remain a write-blocking readiness issue until cleaned.

### Security

- Secrets never enter logs, D1 operational payloads, Lark mirrors or release artifacts.
- Customer profile, account/page/IG/ad IDs, Lark table IDs, handles and generic identity values are redacted or replaced with safe references in operational output.
- Numeric identifiers are not exempt merely because they are numbers.
- Safe counters remain visible through an explicit allowlist.

### Reliability

- D1 remains primary source of truth.
- A slow/unavailable Lark mirror must not invalidate an already committed D1 primary result.
- Mirror failures remain observable and retryable through a bounded durable contract.
- Resolved alerts do not reopen under the same incident generation unless an explicit new generation/reopen operation is used.

## Acceptance criteria

1. Meta Blueprint field/key names match source canonical contracts.
2. Generic Organic and Ads date tests cover at least two timezones and a DST timezone.
3. Meta page client tests cover two-page reads, repeated cursor, missing cursor, body timeout, 429 retry, 5xx retry and max-attempt exhaustion.
4. TikTok interruption/resume processes a large fixture without rebuilding all source records in one array.
5. Duplicate resolution has deterministic tests across Organic normalization and Sync Engine behavior.
6. Redaction tests cover token/secret plus customer profile, account key, Page ID, IG ID, Ad Account ID and Lark Table ID in string and numeric forms.
7. Alert persistence tests prove resolved incidents remain resolved under duplicate writes.
8. Lark mirror outage/timeout does not fail or indefinitely delay D1-primary completion.
9. Worker runtime regression passes for TikTok, YouTube, reporting, DLQ and redrive.
10. Large-account fixtures pass for at least 10,000 source entities with bounded page/chunk size.
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
- [ ] Run focused and full verification gates.

### Atomic batch B — bounded source processing

- [x] Shared bounded paged-source contract added with missing/repeated/max-page guards.
- [x] Meta Graph transport hardened for single-page reads, bounded retry, body timeout and usage metadata.
- [x] TikTok staged-unit async reader and persisted-count completeness check added.
- [x] 10,000-record bounded page/unit fixtures added.
- [ ] Switch the live TikTok normalization/plan/write path from compatibility aggregation to the staged-unit consumer.
- [ ] Add interruption/resume regression through the complete business write path.

### Atomic batch C — runtime and reliability structure

- [ ] Split Worker handlers/composition.
- [ ] Add non-blocking durable Lark mirror delivery contract.
- [ ] Add report date-range reads or bounded fallback.
- [ ] Run TikTok/YouTube/report/DLQ/redrive regression tests.

### Atomic batch D — cleanup and release gates

- [ ] Add unused/duplicate/complexity audits.
- [ ] Produce legacy usage report and deprecation markers.
- [ ] Run full gates, update Project Brain/CHANGELOG and verify clean release package.

## Verification status

The GitHub connector has written source, tests, documentation and an additive local migration. No local command or CI status has verified the changes yet. Required commands remain:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

The new migration has not been applied to Remote D1. No test-pass, deployment or UAT claim may be made before the commands and guarded DEV rollout are completed.

## Implementation result

`in_progress — Atomic batch A source changes complete; Batch B contracts/readers complete but the live TikTok write path still uses the compatibility aggregation flow. Batch C/D remain.`

No Meta connector, Lark Apply, external Meta call, Remote D1 migration, Queue mutation, Worker deployment, schedule change or Production mutation has been performed.
