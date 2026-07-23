# Current Task — Storage Foundation Phase 1

## Status

- **Task status:** `phase_1a_ready_for_merge`
- **Approved by user:** `2026-07-23`
- **Main baseline:** `a0c4f36ec2b6421e5dc7f800300c622fac9896d7`
- **Task-open baseline:** `5d75f7e967e03999ea36a088b7867f7aa4a60be4`
- **Contract:** `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- **Integration Workspace:** one pre-Production workspace
- **Schedules:** must remain disabled
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

The work must be delivered as two separate Pull Requests:

1. **Phase 1A — Runtime identity and Field ownership**
2. **Phase 1B — D1 schema and repositories**

Do not combine both implementations into one PR.

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

## Phase 1A — In scope

### Runtime/Profile alignment

- Add an authoritative `integration_workspace` customer profile.
- Keep `MKT_ENV=development` as the technical runtime label.
- Map TikTok Organic Canonical identity to Chemistry K.
- Preserve Production profile isolation and customer-owned Production rules.
- Treat legacy profile names as explicit compatibility aliases where required by existing tests or stored operational history.
- Align report-setting seeds/examples with `integration_workspace` and `chemistry_k` without writing Live Lark records.
- Keep every business schedule disabled.

### `MKT_Content` Field ownership

Implement a reusable Field ownership policy in the planning/diff path rather than connector-specific ad hoc filtering.

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

Required behavior:

- On Create, incoming approved classification values may be written.
- On Update, system-managed fields may update normally.
- When existing `classification_source=manual`, preserve all protected classification fields.
- `manual_tag_note` is never overwritten after record creation.
- Incoming `null`, empty or missing values never clear protected existing values.
- For non-manual existing records, protected classification fields may be filled only when the existing value is blank.
- Formula, Lookup, Relation and fields outside the incoming ownership mask must remain untouched.
- The policy must work with TikTok and YouTube planning paths and remain reusable for future Organic connectors.

## Phase 1B — In scope

Create additive local D1 migration and repository modules for the exact Contract tables:

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

Requirements:

- Exact Grain, fields, Stable keys, constraints and indexes must match the approved Storage contract and review note.
- Existing operational D1 tables and migrations must remain compatible.
- Repositories must support typed validation, idempotent UPSERT/no-op behavior and bounded queries needed by later dual-write/report phases.
- Partial coverage must never delete unseen facts.
- JSON payloads must enforce approved byte/shape limits.
- All new runtime Feature flags default to `false`.
- Creating the migration and repositories does not authorize Remote migration apply or business writes.

## Out of scope

- Reading or writing Live TikTok/YouTube/Meta/Ads business data;
- TikTok RAW → `MKT_Content`/`MKT_Content_Daily` Sync;
- applying a Remote D1 migration;
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

- [ ] Migration replay on empty and existing schema is safe and idempotent.
- [ ] Every required Table, constraint and index exists.
- [ ] Stable-key duplicate attempts do not create extra rows.
- [ ] Organic observation retry is idempotent.
- [ ] Ads old-day revision updates the same fact row.
- [ ] Different breakdown/segment/conversion identities remain separate.
- [ ] Partial coverage does not delete or zero unseen facts.
- [ ] Coverage controlled values fail closed.
- [ ] Bounded JSON guards fail closed.
- [ ] Existing D1 reliability, lock, checkpoint, DLQ/redrive and resumable-work regressions pass.

## Gates for each implementation PR

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run
```

Add focused tests for the files changed. `npm audit --audit-level=high` must report no unacceptable vulnerability.

## Implementation result — Phase 1A

### Pull request

- PR: `#22` — `feat: align runtime identity and protect content fields`
- Branch head verified: `9779b76da834daf45948ca74df4060004ceebbbc`
- Branch Verification: run `#251`, run ID `29985912721`, `success`

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

### Safety result

```text
LIVE_BUSINESS_DATA_READ_WRITE = NONE
LARK_MUTATION                = NONE
REMOTE_D1_MIGRATION          = NONE
QUEUE_MESSAGE                = NONE
SCHEDULE_CHANGE              = NONE
DEPLOYMENT                   = NONE
PRODUCTION_CHANGE            = NONE
```

### Remaining

- Phase 1A must be merged before Phase 1B branches from the new `main`.
- Phase 1B D1 schema/repositories is not implemented yet.
- TikTok Canonical Sync remains blocked.

## Completion boundary

Phase 1 is complete only when both implementation PRs are merged and verified. Completion still does **not** authorize:

- Remote D1 migration apply;
- Live Dual-write;
- TikTok Canonical Sync;
- Report Reader cutover;
- Lark Retention;
- Schedule enablement;
- Production.

The next separately approved task after Phase 1 is manual, Feature-flagged Organic D1 dual-write/bootstrap with schedules disabled.

## Handoff

```text
STORAGE_CONTRACT = V1_DOCUMENTED
CURRENT_TASK = STORAGE_FOUNDATION_PHASE_1
PHASE_1A = READY_FOR_MERGE
PHASE_1B = NOT_STARTED
LIVE_BUSINESS_WRITE = FORBIDDEN
REMOTE_D1_MIGRATION = FORBIDDEN
TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_CUTOVER = BLOCKED
LARK_RETENTION = BLOCKED
GOOGLE_ADS_PR_17 = HOLD
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```
