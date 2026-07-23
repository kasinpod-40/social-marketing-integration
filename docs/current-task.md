# Current Task — Exact Storage Architecture and Migration Contract v1

## Status

- **Task status:** `storage_architecture_contract_documented`
- **User direction:** redesign historical storage before any TikTok Canonical write or additional Connector implementation
- **Documentation approval:** `2026-07-23`
- **Implementation status:** not started
- **Runtime mutation:** none
- **Lark Table/Field/View/Formula/Record mutation:** none
- **D1 migration:** none
- **Queue/Schedule/Deployment:** none
- **Production mutation:** none
- **Last updated:** `2026-07-23`

## Authoritative contract

Exact design and migration sequence:

`docs/project-brain/storage-architecture-and-migration-contract-v1.md`

Related direction record:

`docs/project-brain/time-series-retention-and-notification.md`

The exact contract has authority over older sequencing that proposed writing TikTok RAW directly into the existing unlimited Lark Daily model.

## Operating model

The project continues to use one pre-Production **Integration Workspace**:

```text
MKT_ENV=development                 # technical runtime label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

Current Workspace infrastructure remains developer-owned while Production remains separate and customer-owned.

## Verified source and Base state

- TikTok Organic source is the established Chemistry K connection `@chemistry_k` through Lark Native TikTok For Creator.
- `RAW_TikTok_Creator_Videos` contains `2,021` records and is protected/read-only to our Worker.
- Latest verified Base configuration contains `42` physical tables, `737` fields and `133` Views with no duplicate table names.
- Google Ads Formula/View/Filter and Shared-table View work is already complete; do not rerun Apply.

## Audit result that changes sequencing

The completed Repository/Base dependency audit found the following blockers:

1. TikTok Report source currently allows only `800` Content records and `50,000` Daily snapshots.
2. `MKT_Content_Daily` is the current cumulative snapshot source used by the TikTok Report Engine for period baselines and deltas.
3. `MKT_Content` has no approved Field-level ownership mask and may overwrite manual classification fields.
4. Runtime Source code still does not fully implement the documented `integration_workspace`/Chemistry K identity contract.
5. D1 currently stores operational reliability/checkpoint/work state but no approved Marketing historical facts.
6. RAW provider-specific versus Shared RAW lineage is not locked for every Connector.
7. D1 capacity, Live row lineage and retention evidence are still missing.

Therefore:

```text
TIKTOK_CANONICAL_SYNC = BLOCKED
LARK_DAILY_RETENTION = BLOCKED
REPORT_READER_CUTOVER = BLOCKED
GOOGLE_ADS_PR_17 = HOLD
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```

## Approved storage direction

```text
Platform/Lark Native Sources
→ validated ingestion
→ D1 current state + historical facts + coverage
→ deterministic report calculation
→ Lark current state + bounded cache + aggregate + report results
→ Dashboard / AI / Notification
```

Dashboard requirement:

```text
3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

- Organic cumulative metrics use end observation minus pre-period baseline.
- Ads use additive Daily facts with Attribution revision/UPSERT.
- Missing baseline remains `partial`; missing metric remains `null`.
- Dashboard must expose Coverage/Data status.

## Exact D1 tables approved for implementation planning

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

Names, Grain, Fields, Stable keys, Indexes and UPSERT rules are defined in the authoritative contract. Changing them requires a Contract revision before implementation.

## Lark role after migration

- `MKT_Content`: Current-state row per Content with explicit Field ownership.
- `MKT_Content_Daily`: compatibility/recent diagnostic cache only after D1 parity and Reader cutover.
- `MKT_Account_Daily`: long-term Account×Date Dashboard aggregate.
- `MKT_Ads_Daily`: bounded recent Ads detail after D1 parity.
- `MKT_Report_*`: materialized deterministic KPI/Top results.
- Protected/Native RAW: unchanged and not deleted by our system.

No Lark retention or deletion is authorized by this task.

## Current task — in scope

1. Record the exact Storage Architecture and Migration Contract in Repository `main`.
2. Synchronize `docs/current-task.md`, Project Brain, README and CHANGELOG.
3. Lock Dashboard periods, metric semantics, D1 grains/keys/indexes, Lark roles, migration flags, parity and rollback.
4. Keep TikTok Canonical write blocked until Storage Foundation phases are implemented and validated.
5. Keep Google Ads Draft PR `#17` unmerged until it is rebuilt/rebased against the new storage/RAW lineage contract.

## Out of scope

- Source/runtime code changes;
- D1 migration creation or Remote apply;
- TikTok/YouTube/Meta/Ads Live write;
- Lark Table/Field/View/Formula/Record mutation;
- Daily-row deletion or retention job;
- Report Reader cutover;
- Notification tables/runtime;
- Queue messages, schedules or deployment;
- merging PR `#17`;
- Production cutover.

## Acceptance criteria for this documentation task

- [x] Exact Dashboard period contract covers 3D/7D/9D/15D/30D/90D/Custom.
- [x] Organic cumulative, Organic period and Ads daily semantics are separated.
- [x] Exact D1 Table names, Grain, Stable keys, Fields, Indexes and UPSERT rules are documented.
- [x] Coverage state and Entity-scope proof are documented.
- [x] `MKT_Content` manual/system Field ownership is documented.
- [x] Lark current/cache/aggregate/report roles are documented.
- [x] Feature flags default false and migration phases are documented.
- [x] Parity, Live validation and rollback gates are documented.
- [x] Retention remains blocked until D1 capacity and rollback evidence exist.
- [x] No runtime, Lark, D1, Queue, Schedule or Production mutation occurs.

## Proposed next Implementation task after merge

```text
Storage Foundation Phase 1
= integration_workspace identity alignment
+ Chemistry K TikTok account identity
+ MKT_Content Field ownership policy
+ additive D1 schema/repositories/tests
+ all new Feature flags false
+ no Live business-data write
```

Implementation may start only after this documentation branch is merged, `main` is reread and a new Implementation Current Task is explicitly opened.

## Pull request boundaries

Do not combine these into one PR:

1. Runtime/profile and Field ownership alignment;
2. D1 schema/repositories;
3. Organic dual-write/bootstrap;
4. Ads dual-write;
5. Report shadow reader;
6. Report cutover/materialization;
7. Lark retention;
8. Notification runtime;
9. Google Ads signed-delivery rebuild/rebase.

## Handoff

```text
INTEGRATION_WORKSPACE = SINGLE_PRE_PRODUCTION_WORKSPACE
STORAGE_CONTRACT = V1_DOCUMENTED
REPOSITORY_AUDIT = COMPLETE_WITH_BLOCKERS
DASHBOARD_RANGE = 3D_7D_9D_15D_30D_90D_CUSTOM
TIKTOK_SOURCE = CHEMISTRY_K_EXISTING_CONNECTION
TIKTOK_RAW = POPULATED_2021_ROWS
TIKTOK_CANONICAL_SYNC = BLOCKED_BY_STORAGE_FOUNDATION
CONTENT_FIELD_OWNERSHIP = CONTRACT_DEFINED_IMPLEMENTATION_PENDING
D1_HISTORICAL_FACTS = CONTRACT_DEFINED_IMPLEMENTATION_PENDING
REPORT_D1_READER = NOT_IMPLEMENTED
LARK_RETENTION = NOT_APPROVED
NOTIFICATION = DEFERRED_UNTIL_REPORT_PARITY
GOOGLE_ADS_PR_17 = HOLD_REBUILD_REQUIRED
LARK_SCHEMA = COMPLETE_DO_NOT_REOPEN_FROM_THIS_TASK
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
NEXT_TASK = STORAGE_FOUNDATION_PHASE_1_AFTER_SEPARATE_APPROVAL
```