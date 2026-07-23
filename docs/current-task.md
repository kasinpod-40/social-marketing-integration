# Current Task — Storage Foundation Phase 1

## Status

- **Task status:** `phase_1_complete`
- **Approved by user:** `2026-07-23`
- **Main baseline:** `0c3a6ba838ad8bb2a1783d203b62a70527a08ec4`
- **Task-open baseline:** `5d75f7e967e03999ea36a088b7867f7aa4a60be4`
- **Contract:** `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- **Integration Workspace:** one pre-Production workspace
- **Schedules:** disabled
- **Production:** blocked

## Objective

Implement the non-live foundation required before any TikTok Chemistry K Canonical write:

```text
Storage Foundation Phase 1
= Runtime/Profile identity alignment
+ Chemistry K TikTok Canonical identity
+ MKT_Content Field ownership protection
+ additive D1 historical-storage schema/repositories/tests
+ all new Feature flags false
+ no Live business-data write
```

The work was delivered as two separate Pull Requests:

1. **Phase 1A — Runtime identity and Field ownership**
2. **Phase 1B — D1 schema and repositories**

## Authoritative operating model

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

For TikTok Organic in the Integration Workspace:

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
```

Historical names such as `dev_ft_pumkin`, `uat_chemistry_k` and `ft_pumkin` are compatibility/history labels only. They must not create a second operating mode, change current record ownership or authorize deletion/relabeling.

## Phase 1A — Delivered scope

### Runtime/Profile alignment

- Added authoritative `integration_workspace` customer profile.
- Kept `MKT_ENV=development` as the technical runtime label.
- Mapped TikTok Organic Canonical identity to Chemistry K.
- Preserved Production profile isolation and customer-owned Production rules.
- Treated legacy profile names as explicit compatibility aliases.
- Aligned report-setting seeds/examples with `integration_workspace` and `chemistry_k` without writing Live Lark records.
- Kept every business schedule disabled.

### `MKT_Content` Field ownership

Implemented reusable Field ownership policy in the planning/diff path rather than connector-specific filtering.

Protected business fields:

```text
course_name
course_level
course_type
content_theme
funnel_stage
cta_type
cta_destination
promotion_type
urgency_level
manual_tag_note
```

Delivered behavior:

- On Create, incoming approved classification values may be written.
- On Update, system-managed fields may update normally.
- When existing `classification_source=manual`, all protected classification fields are preserved.
- `manual_tag_note` is never overwritten after record creation.
- Incoming `null`, empty or missing values never clear protected existing values.
- For non-manual existing records, protected classification fields may be filled only when the existing value is blank.
- Formula, Lookup, Relation and fields outside the incoming ownership mask remain untouched.
- TikTok and YouTube use the same reusable policy.

## Phase 1B — Delivered scope

Added local additive D1 migration and repository modules for:

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
ads_entity_state
ads_daily_facts
ads_conversion_daily_facts
data_coverage_runs
data_coverage_entities
report_materializations
report_requests
```

Delivered requirements:

- Exact Grain, fields, Stable keys, constraints and indexes match the approved Storage contract and review note.
- Existing operational D1 tables and migrations remain compatible.
- Repositories support typed validation, idempotent UPSERT/no-op behavior and bounded queries for later phases.
- Partial coverage never deletes unseen facts.
- JSON payloads enforce approved byte limits.
- All new runtime Feature flags default to `false`.
- No Remote migration or business writer was activated.

## Explicitly not authorized by Phase 1

- Reading or writing Live TikTok/YouTube/Meta/Ads business data;
- TikTok RAW → `MKT_Content`/`MKT_Content_Daily` Sync;
- applying Remote D1 migration `0009`;
- deploying Worker code;
- sending Queue messages;
- opening any schedule;
- changing Lark Tables, Fields, Views, Formulas or Records;
- changing `MKT_Content_Daily` or `MKT_Ads_Daily` Retention;
- Report D1 reader/shadow parity/cutover;
- Dashboard UI changes;
- Notification implementation;
- Google Ads PR `#17` merge/reuse;
- Production cutover.

## Required tests — Phase 1A

- [x] `integration_workspace` resolves only with `MKT_ENV=development`.
- [x] TikTok identity resolves to Chemistry K and produces `tiktok:chemistry_k:*` Stable keys.
- [x] Legacy aliases do not become separate customer/account identities.
- [x] Production isolation and disabled schedules remain unchanged.
- [x] Manual classification and `manual_tag_note` survive reruns.
- [x] Blank protected fields can be filled under the approved rules.
- [x] System-managed fields still update.
- [x] TikTok, YouTube and Core regression tests pass.

## Required tests — Phase 1B

- [x] Migration replay on empty and existing schema is safe and idempotent.
- [x] Every required Table, constraint and index exists.
- [x] Stable-key duplicate attempts do not create extra rows.
- [x] Organic observation retry is idempotent.
- [x] Ads old-day revision updates the same fact row.
- [x] Different breakdown/segment/conversion identities remain separate.
- [x] Partial coverage does not delete or zero unseen facts.
- [x] Coverage controlled values fail closed.
- [x] Bounded JSON guards fail closed.
- [x] Existing D1 reliability, lock, checkpoint, DLQ/redrive and resumable-work regressions pass.

## Verification gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run
```

`npm audit --audit-level=high` reported no unacceptable vulnerability.

## Implementation result — Phase 1A

### Pull request

- PR: `#22` — `feat: align runtime identity and protect content fields`
- Squash merge commit: `00c528279070cb0a67c9fc269abede58c3c4a0d8`
- Branch Verification: run `#252`, run ID `29986052678`, `success`

### Implemented

- Added canonical `integration_workspace` Runtime profile and removed separate UAT operating mode.
- Historical profile names resolve only as compatibility aliases to `integration_workspace`.
- TikTok Organic Canonical identity is `customerKey/accountKey/sourceHandle=chemistry_k`.
- All connectors and schedules remain disabled by default in release examples.
- Report setting seeds use `integration_workspace:tiktok:{daily|weekly}` and account `chemistry_k`.
- Added reusable Organic Content ownership policy at the Lark repository boundary.
- Worker and local Script runtimes apply the policy only to physical `MKT_Content`.
- TikTok and YouTube share the same ownership behavior without connector-specific duplicate logic.
- Manual classification and `manual_tag_note` are preserved; blank non-manual classification fields may be filled; system-managed metrics continue updating.
- Shared-table schema guard now targets the developer-owned Integration Workspace.

### Verification

```text
Syntax / architecture / hygiene    PASS
Focused staged TikTok tests        PASS
Node Unit + Workers runtime        PASS
Report reliability regression      PASS
Dependency audit                   PASS
Wrangler dry run                   PASS
```

## Implementation result — Phase 1B

### Pull request

- PR: `#24` — `feat: add D1 marketing storage foundation`
- Superseded closed PR `#23`; no implementation scope was lost.
- Squash merge commit: `0c3a6ba838ad8bb2a1783d203b62a70527a08ec4`
- Verified implementation head: `5ed23addaba8cfdf021c1191729812e74bbe6d19`
- Implementation verification: run `#265`, run ID `29996119555`, `success`
- Final status verification: run `#267`, run ID `29996289060`, `success`

### Implemented

- Added additive migration `migrations/0009_storage_foundation.sql` with all ten approved Storage tables and indexes.
- Added exact typed Storage contracts and deterministic Stable-key builders.
- Added D1 repository behavior for idempotent Current state, Organic observations, Ads revisions, Coverage and Report materializations.
- Preserved Breakdown, Segment, Conversion action and Attribution identity boundaries.
- Added Application-level JSON guards: Report payload `262144` bytes; Ads actions/breakdown `65536` bytes.
- Added bounded account/date and entity/date reads; no delete or Retention method exists in this phase.
- Added explicit `none` identity requirements; `null` is rejected instead of silently collapsed.
- Added strict calendar-date validation for Stable keys and report periods.
- Added Storage migration, contract, repository and Feature-flag tests.
- All new Storage, Reader, Retention and Notification flags default to `false`.
- Normalized SQLite test rows without Proxying SQLite internal properties.
- Corrected the migration replay test to build SQL placeholders with a Template literal.

### Verification

```text
Syntax / architecture / hygiene    PASS
Focused staged TikTok tests        PASS
Node Unit + Workers runtime        PASS (573/573)
Report reliability regression      PASS
Dependency audit                   PASS
Wrangler dry run                   PASS
```

### Safety result — Phase 1A and Phase 1B

```text
LIVE_BUSINESS_DATA_READ_WRITE = NONE
LARK_MUTATION                = NONE
REMOTE_D1_MIGRATION          = NONE
QUEUE_MESSAGE                = NONE
SCHEDULE_CHANGE              = NONE
DEPLOYMENT                   = NONE
PRODUCTION_CHANGE            = NONE
```

## Completion and next approval boundary

Storage Foundation Phase 1 is complete and merged.

The next possible task is **manual, Feature-flagged Organic D1 dual-write/bootstrap with schedules disabled**, but it is `NOT_APPROVED` by this closeout and must receive separate scope approval before implementation.

The following remain blocked:

- Remote D1 migration apply;
- Live Dual-write;
- TikTok Canonical Sync;
- Report Reader cutover;
- Lark Retention;
- Schedule enablement;
- Production.

## Handoff

```text
STORAGE_CONTRACT = V1_DOCUMENTED
CURRENT_TASK = STORAGE_FOUNDATION_PHASE_1_COMPLETE
PHASE_1A = MERGED
PHASE_1B = MERGED
NEXT_TASK = NOT_APPROVED
LIVE_BUSINESS_WRITE = FORBIDDEN
REMOTE_D1_MIGRATION = FORBIDDEN
TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_CUTOVER = BLOCKED
LARK_RETENTION = BLOCKED
GOOGLE_ADS_PR_17 = HOLD
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```
