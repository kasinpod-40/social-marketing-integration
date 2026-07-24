# Social Marketing Data Integration

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base สำหรับ Dashboard, Reporting, AI Summary, Insight, Alert และ Notification โดยใช้ JavaScript ES Modules, Cloudflare Workers, D1, Queues และ Lark Open API

## Read first

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/storage-architecture-and-migration-contract-v1.md
→ docs/project-brain/* relevant files
→ README.md / CHANGELOG.md
→ Source and Tests
```

- `docs/current-task.md` เป็น Current authority สำหรับ Scope และ Acceptance criteria
- Credential, Live write, Remote migration, Deployment, Schedule, Retention และ Production ต้องผ่าน Gate แยก
- ห้ามใช้แชทเป็นอำนาจเหนือ Repository `main`

## Current repository state

```text
Application package line           0.11.0
Storage Architecture               V1 documented
Storage Foundation Phase 1A        merged
Storage Foundation Phase 1B        merged
Organic D1 bootstrap PR #27        merged
Organic D1 bootstrap merge         d182bf9efc8c6ea51f275ea725cdb0eaeae3d5e0
Customer OAuth remote rollout      complete
TikTok Canonical Lark sync         blocked
Report D1 reader                   not implemented
Schedules                          disabled
Production                         blocked
```

Customer OAuth source status (2026-07-24):

```text
Shared Connection/OAuth            merged via PR #42
Google Ads Customer OAuth          merged via PR #43
YouTube Customer OAuth             merged via PR #44
Migration 0011                     applied remotely
Worker deployment                  pass / HTTP smoke 404 + 405
Google OAuth config                redirects/APIs/scopes ready
Worker Secrets                     required names 7/7
Customer Connect links             all 4 consumed / no reusable link
Customer OAuth                     authorization pending / states expired
Queue/Lark callback side effects   0 / 0 by contract
```

See `docs/customer-connection-oauth-contract-v1.md` and `docs/customer-connection-oauth-rollout.md`. Source merged in order `#42` → `#43` → `#44`; the approved Integration Workspace rollout is complete. Signed URLs are not stored in the Repository. Both customer and test invitations reached OAuth begin without callback completion and are unusable; a retry-safe, preview-safe Connect flow is the next unimplemented task.

PR #27 added source code and a guarded runbook. It did not apply Migration `0009` remotely, deploy a Worker, send a Queue message or write Live D1/Lark business data.

## Integration Workspace

ก่อน Production ใช้ **Integration Workspace เพียงชุดเดียว** ไม่แยก DEV/UAT ในการปฏิบัติงาน

```env
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

`MKT_ENV=development` เป็น Technical runtime label เท่านั้น

TikTok Organic identity is locked to:

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
```

Integration Workspace rejects a TikTok handle override that would store another source under the Chemistry K Stable key.

Current Workspace resources are developer-owned. Production remains separate and must use customer-owned Lark, Cloudflare, D1, Queue, secrets and Platform assets.

## Current Lark state

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Google Ads Formula fields    4/4 PASS
Google Ads managed filters  19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
```

Relevant TikTok inventory:

```text
RAW_TikTok_Creator_Videos   approximately 2,021 records
MKT_Content                 22 records at last verified audit
MKT_Content_Daily           208 records at last verified audit
```

`RAW_TikTok_Creator_Videos` is a protected Lark Native source. The Worker may read it but must not mutate its Table, Fields or Records.

Do not rerun Lark Formula/View/Filter Apply from the Organic bootstrap task.

## Storage Architecture v1

```text
Platform / Lark Native Sources
→ validated ingestion
→ D1 current state + historical facts + coverage
→ deterministic calculation
→ Lark current state + bounded cache + aggregate + report result
→ Dashboard / AI / Notification
```

Foundation tables:

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

Names, Grain, Stable keys, Fields, Indexes and UPSERT rules are defined in `docs/project-brain/storage-architecture-and-migration-contract-v1.md`.

## Organic D1 bootstrap

Manual Job:

```text
tiktok.creator.native.history.bootstrap
```

Required flags:

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_TIME_SERIES_D1_WRITE_ENABLED=true
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=true
```

Rules:

- manual Queue trigger only;
- never emitted by schedules;
- Integration Workspace only;
- Dry-run writes zero Marketing-history/Lark business rows;
- live bootstrap writes D1 only;
- source pages are bounded and durably staged;
- no synthetic historical Daily rows;
- first trusted metrics are `initial`;
- changed metrics are `changed`;
- cumulative decreases are `correction`;
- unchanged metrics create no Observation;
- missing metric remains `null`; observed zero remains `0`;
- Coverage and source watermark are persisted for reconciliation.

Payload helper:

```bash
npm run job:tiktok-history-bootstrap
```

The helper prints a body only and never sends it.

Guarded rollout instructions:

```text
docs/runbooks/tiktok-organic-d1-bootstrap.md
```

## D1-first TikTok path

When D1 history writing is enabled in a later separately approved Canonical run, each staged unit executes:

```text
validate complete unit
→ D1 Current state / Observation / Coverage
→ Lark MKT_Content
→ Lark MKT_Content_Daily
→ persist unit completion
```

D1 failure prevents Lark writes. Lark failure after D1 success is retryable; D1 replays idempotently and Lark is repaired.

The full Chemistry K TikTok RAW → Lark Canonical run remains blocked because the current Report reader caps `MKT_Content` at 800 rows and still reads `MKT_Content_Daily` for cumulative baselines.

## Dashboard range contract

Customer Dashboard must eventually support:

```text
3D / 7D / 9D / 15D / 30D / 90D / CUSTOM_RANGE
```

- presets are rolling completed days ending yesterday by Reporting timezone;
- Organic cumulative metrics use end observation minus pre-period baseline;
- Ads use additive Daily facts and old-day Attribution revisions;
- old Content without a baseline is `partial`;
- Dashboard must show Coverage/Data status;
- Report D1 shadow read and customer-visible cutover are not part of the bootstrap implementation.

## `MKT_Content` ownership

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

- write approved values on Create or into blank non-manual fields;
- preserve protected classification when `classification_source=manual`;
- never overwrite `manual_tag_note` after Create;
- incoming `null` cannot clear a protected existing value;
- Formula, Lookup, Relation and fields outside the ownership mask remain untouched.

## Migration feature flags

All release examples default to `false`:

```env
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
MKT_NOTIFICATION_RUNTIME_ENABLED=false
```

Backfill requires D1 write. Retention requires the D1 Report reader. Enabling Storage flags does not enable a schedule.

## Connector status

| Connector | Current state | Direction |
| --- | --- | --- |
| TikTok Organic | Chemistry K protected Native RAW populated | Guarded D1-only rollout, then Report shadow reader before Canonical scale |
| YouTube Organic | Runtime foundation exists on developer source | Later map cumulative/period facts into Storage contract |
| Facebook Organic | Access/schema ready | Shared Meta connector after Organic storage rollout |
| Instagram Organic | Access/schema ready | Shared Meta connector after Organic storage rollout |
| Meta Ads | Access valid/no data | Ads facts/revision contract first |
| Google Ads | Read-only source passed; Draft PR #17 | HOLD; rebuild/rebase against Storage/RAW lineage |
| TikTok Ads | Access/design preflight | Controlled API/Worker connector later |
| WooCommerce | Planned | Connector pending |
| Chatwoot | Planned | Connector pending |

Draft PR #11 is obsolete/superseded and must not be merged.

## Verification gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

PR #27 merged after Branch Verification run #327 passed all gates.

## Safety

```text
REMOTE_D1_MIGRATION       not applied by PR #27
WORKER_DEPLOYMENT         none
QUEUE_MESSAGE             none
LIVE_D1_BOOTSTRAP         none
LARK_SCHEMA_MUTATION      none
LARK_RECORD_MUTATION      none
TIKTOK_CANONICAL_SYNC     blocked
REPORT_CUTOVER            blocked
LARK_RETENTION            blocked
SCHEDULE                  disabled
PRODUCTION                blocked
```

No fake history, no missing-to-zero conversion, no protected RAW mutation, no cleanup based on legacy Profile names and no secrets in Source or Lark.
