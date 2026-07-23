# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified state** เท่านั้น ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

## Current repository baseline

- Main baseline reviewed for the Storage audit: `430b503cf074443776ac7fc5a011d2843192ec9c`
- Application package line: `0.11.0`
- Lark schema/View/Formula closeout: complete; do not rerun without a new approved contract
- Exact Storage contract: `docs/project-brain/storage-architecture-and-migration-contract-v1.md`
- Google Ads signed-delivery implementation: Draft PR `#17`, not merged, not deployed and held for rebuild/rebase
- Storage/Report/Dashboard implementation: not started

## Integration Workspace operating model

There is one pre-Production **Integration Workspace**, not separate DEV/UAT operating modes

```text
MKT_ENV=development                 # technical runtime label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

Current Workspace resources are developer-owned:

- Social MKT Data Hub Lark Base
- Cloudflare Worker
- D1
- Queue and DLQ
- Secret store
- checkpoints, locks, sync runs and alerts

Source ownership is tracked per Connector and can be mixed temporarily. Production remains separate and must be customer-owned

Full contract: `docs/project-brain/integration-workspace.md`

The old separate-UAT document is superseded and retained only as history

## Current source ownership

| Connector | Source currently used | Current gap |
| --- | --- | --- |
| TikTok Organic | Chemistry K `@chemistry_k` through Lark Native | RAW populated; Canonical write blocked by Storage foundation |
| Facebook Organic | Developer temporary source | Connector/normalization/reliability and later customer replacement |
| Instagram Organic | Developer temporary source | Connector/normalization/reliability and later customer replacement |
| YouTube Organic | Developer temporary source | Customer replacement and final customer-scale validation |
| Google Ads | Chemistry K advertiser linked/read-only data available | Draft PR `#17` must be rebuilt against Storage/RAW lineage contract |
| Meta Ads | Developer no-data account preflight | Connector and customer data validation |
| TikTok Ads | Access/design preflight only | Authorization, reporting contract and connector |
| WooCommerce | Chemistry K source/access-dependent | Connector pending |
| Chatwoot | Chemistry K source/access-dependent | Connector pending |

## Current Lark Base baseline

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Table emoji/folders       42/42
View emoji names         133/133
Google Ads formulas          4/4 PASS
Google Ads filters          19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
```

Do not rerun Lark View Apply or Formula UI work

Relevant TikTok inventory:

```text
RAW_TikTok_Creator_Videos   2,021 records / 18 fields
MKT_Content                    22 records / 29 fields
MKT_Content_Daily             208 records / 15 fields
```

These counts prove the RAW source is populated and Canonical tables exist. They do not prove the current Chemistry K RAW dataset was normalized correctly

## Completed dependency audit

The Repository/Base dependency audit is `COMPLETE_WITH_BLOCKERS`

Confirmed blockers:

1. TikTok Report source currently caps `MKT_Content` at `800` records and `MKT_Content_Daily` at `50,000` records.
2. `MKT_Content_Daily` is the current cumulative-snapshot source for Report baselines and period deltas.
3. `MKT_Content` lacks an approved Field-level ownership mask and may overwrite manual classification values.
4. Source code still does not fully implement the documented `integration_workspace` and Chemistry K identity contract.
5. D1 currently stores operational reliability/checkpoint/work state but not approved Marketing historical facts.
6. Provider-specific RAW versus Shared RAW lineage is not locked for every Connector.
7. Remote D1 capacity and Live row-lineage evidence remain missing.

Therefore:

```text
TIKTOK_CANONICAL_SYNC = BLOCKED
REPORT_READER_CUTOVER = BLOCKED
LARK_DAILY_RETENTION = BLOCKED
GOOGLE_ADS_PR_17 = HOLD
SCHEDULE = DISABLED
PRODUCTION = BLOCKED
```

## Approved exact Storage direction

Decision record:

`docs/project-brain/storage-architecture-and-migration-contract-v1.md`

Status:

```text
STORAGE_CONTRACT = V1_DOCUMENTED
IMPLEMENTATION = NOT_STARTED
D1_MIGRATIONS = NOT_STARTED
LARK_RETENTION = NOT_APPROVED
REPORT_CUTOVER = NOT_STARTED
NOTIFICATION = DEFERRED_UNTIL_REPORT_PARITY
```

Target flow:

```text
Platform/Lark Native Sources
→ validated ingestion
→ D1 current state + historical facts + coverage
→ deterministic report calculation
→ Lark current state + bounded cache + aggregate + report result
→ Dashboard / AI / Notification
```

Exact D1 tables approved for Implementation planning:

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

Names, Grain, Fields, Stable keys, Indexes and UPSERT rules are locked in the Contract. Changes require a Contract revision

## Dashboard contract

Customer-visible presets:

```text
3D
7D
9D
15D
30D
90D
CUSTOM_RANGE
```

Rules:

- Presets are rolling completed days ending yesterday by Reporting timezone;
- `30D` means one rolling month and `90D` means three rolling months;
- Organic cumulative metrics use end observation minus pre-period baseline;
- Ads use additive Daily facts with old-day UPSERT/Attribution revision;
- New Content may use zero baseline only when published inside the period;
- Old Content without a baseline is `partial`;
- missing metric is `null`, observed zero is `0`;
- Dashboard must expose Coverage/Data status and Source watermark.

## Lark table roles after cutover

- `MKT_Content`: one current-state row per Content with Field ownership protection;
- `MKT_Content_Daily`: bounded recent/diagnostic compatibility cache only after D1 parity and Reader cutover;
- `MKT_Account_Daily`: Account×Date aggregate for long-term Dashboard use;
- `MKT_Ads_Daily`: bounded recent customer-visible Ads detail after D1 parity;
- `MKT_Report_*`: deterministic materialized KPI, comparison and Top rows;
- Protected/Native RAW: unchanged and never deleted/mutated by our Worker.

No retention or deletion is authorized yet

## `MKT_Content` ownership rule

System-managed current-state fields may update after source validation

Classification and manual business fields are protected:

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

Rules:

- Fill on Create or when the Existing value is blank;
- preserve all manual classification fields when `classification_source=manual`;
- never overwrite `manual_tag_note` after Record creation;
- incoming `null` cannot clear a manual value;
- Formula/Lookup/Relation/Audit fields outside the ownership mask are untouched.

## TikTok Organic current state

Verified:

- Lark Native TikTok For Creator is connected to Chemistry K `@chemistry_k`;
- protected RAW table has 2,021 records;
- reliability, stable-key planning, lock, retry, DLQ and report foundations exist.

Not authorized yet:

- Canonical write into `MKT_Content`/`MKT_Content_Daily`;
- historical backfill pretending current cumulative values are daily history;
- Lark Daily retention;
- Schedule enablement.

The controlled bootstrap must write D1 Current state and first trusted observation only to the extent Source evidence supports

## D1 current state

Existing D1 is Operational source of truth for:

- sync runs and alerts;
- Queue/DLQ/redrive;
- distributed locks;
- incremental cursors and source fingerprints;
- resumable work and durable mirror outbox.

It does not yet contain the approved Marketing historical tables in the Storage contract

Phase 1 Auto-delete is forbidden. Capacity evidence must include database size, rows/table, row size, indexes/query plans, writes/day, 90D/1Y/3Y projection and backup duration before D1 retention/R2 thresholds are approved

## RAW lineage rule

A Connector must document one path:

```text
Provider-specific RAW → Shared RAW → Canonical
```

or

```text
Provider-specific RAW → Canonical
Shared RAW not used by that Connector
```

Do not Dual-write both RAW layers without stable-key parity and reconciliation

`RAW_TikTok_Creator_Videos` remains protected/read-only

YouTube cumulative RAW and Owner Analytics period RAW remain separate semantic sources

## Google Ads current state

Merged `main`:

- Chemistry K account link/selectability passed;
- Manager Script read-only Preview passed;
- six non-empty bounded datasets;
- errors/truncation `0/0`;
- Lark schema/relations/formulas/managed Views complete;
- direct API Basic Access application submitted `2026-07-21`, case `1-686800040839`, review pending.

Draft PR `#17`:

- not merged/deployed/external LIVE validated;
- writes Provider-specific RAW and Canonical directly;
- must be rebuilt/rebased after Storage/RAW lineage, segment keys, coverage and revision contracts are implemented;
- remains on HOLD.

Draft PR `#11` is obsolete/superseded and must not be merged

## Core runtime rules

Every active write path must reuse:

- central Connector and Job catalogs;
- deterministic stable keys;
- idempotent plan/diff/execute;
- D1 checkpoints and resumable work;
- distributed lease lock and renewal;
- bounded retry and Permanent classification;
- Queue/DLQ and controlled redrive;
- reconciliation and alerts;
- secret/identity redaction;
- explicit Coverage and metric semantics.

Do not create a parallel reliability stack

## Feature flags for Storage migration

All default `false`:

```text
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_TIME_SERIES_D1_BACKFILL_ENABLED
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
MKT_LARK_DAILY_RETENTION_ENABLED
MKT_NOTIFICATION_RUNTIME_ENABLED
```

Reader cutover and Retention are separate approvals

## Migration sequence

1. Documentation baseline;
2. Runtime/profile and Field-ownership alignment;
3. Additive D1 schema/repositories with all flags false;
4. Manual feature-flagged dual-write;
5. Controlled historical bootstrap without fake history;
6. D1 shadow Report read and 3D/7D/9D/15D/30D/90D/Custom parity;
7. Reader cutover with one-flag rollback;
8. Bounded Lark retention after backup/reconciliation approval;
9. Notification after deterministic Report parity;
10. Customer-owned Production cutover separately.

## Current task

Authoritative task: `docs/current-task.md`

Current work is documentation-only Storage Contract closeout

Proposed next Implementation task after merge:

```text
Storage Foundation Phase 1
= integration_workspace identity alignment
+ Chemistry K TikTok identity
+ MKT_Content Field ownership policy
+ additive D1 schema/repositories/tests
+ all new flags false
+ no Live business-data write
```

Implementation must use separate PR boundaries and may not combine Migration, Live dual-write, Reader cutover, Retention deletion, Notification and Google Ads connector work

## Permanent safety rules

- Data model before Connector;
- one Integration Workspace before customer-owned Production;
- no fake history or dummy Production data;
- no Canonical TikTok write before Runtime/ownership/Storage gates;
- missing metric is `null`, not zero, unless Source proves zero;
- no Retention/delete before D1 parity, backup, reconciliation and rollback;
- no Lark Schema/View/Formula reopening from this task;
- no merging Draft PR `#17` against the old Storage model;
- new Connector flags and schedules disabled by default;
- secrets remain in Environment/Secret Manager;
- Production resources must be customer-owned.
