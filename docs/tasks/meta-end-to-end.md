# All Meta End-to-End Integration Workstream

## Authority and baseline

- Repository: `kasinpod-40/social-marketing-integration`
- Workstream branch: `agent/meta-end-to-end`
- Original Workstream base SHA: `e9275b6fbd4c28cf0290434cc4a449373e2e2bf9`
- Final Integration base SHA: `ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4`
- Final reviewed head: `60871dca73c948c703d03a0bb9646b4577ac7504`
- Authority read before implementation and Integration review: `AGENTS.md`, `docs/current-task.md`, `PROJECT_BRAIN.md`, relevant Project Brain modules and current source/tests.
- Open parallel PRs were reviewed before Integration closeout; no shared protected file from this Workstream overlaps their implementation files.
- Latest Integration migration baseline reviewed: `0016_tiktok_post_lark_pipeline.sql`; this Workstream adds no migration and reserves no migration number.

## Scope

All Meta End-to-End Integration covers:

1. Facebook Organic
2. Instagram Organic
3. Meta Ads

The implementation reuses the existing Meta Graph client, source adapters, pure normalizers, Storage v1 contracts, D1 repositories, Organic History Writer, TableSyncEngine, resumable-work contracts, shared lock/retry/DLQ ownership and existing Facebook/Instagram Job Catalog entries.

It does **not** create a second Graph client, Queue framework, reliability runner, D1 writer, Lark sync engine, scheduler or customer-profile registry.

## Phase delivery

### Phase A — Shared Meta Graph Core

Reused without parallel implementation:

- `packages/connectors/src/meta/meta-graph.client.js`
- `packages/connectors/src/meta/meta-business-source.helpers.js`
- `packages/connectors/src/meta/meta-business-normalization.helpers.js`
- `packages/config/src/meta-token-connection-config.js`

Added orchestration:

- `collectMetaEndToEndSourceUnit()` fetches exactly one bounded provider page/node per durable source unit.
- Cursor replay, missing-cursor rejection, injected page cap, source watermark and source-status normalization are explicit.
- Source collection is GET-only and performs no D1/Lark/Queue mutation.

### Phase B — Facebook Organic

- Reuses `FacebookOrganicSourceAdapter`.
- Builds Shared RAW account/content/metric rows through existing normalizers.
- Generates `MKT_Accounts`, `MKT_Account_Daily`, `MKT_Content`, `MKT_Content_Daily` rows.
- Preserves observed zero and omits unsupported/missing latest metrics rather than overwriting existing values with null.
- Keeps Meta `reach` in Shared RAW and does not mislabel it as Canonical `unique_viewers`.
- Feeds Canonical Content/Daily pairs to the existing `createOrganicHistoryWriter()` for state, observations and Coverage.

### Phase C — Instagram Organic

- Reuses `InstagramOrganicSourceAdapter` and exact `/me` identity authority.
- Uses the same Organic D1/Lark path as Facebook with a separate connector/domain adapter.
- Keeps scoped Graph ID as audit data only; canonical account identity remains verified `user_id`.

### Phase D — Meta Ads

- Reuses `MetaAdsSourceAdapter` and existing Ads normalizers.
- Writes Shared RAW entity/daily rows.
- Generates D1 `ads_entity_state`, `ads_daily_facts`, Coverage rows and Canonical Ads tables.
- Preserves publisher-platform breakdown in RAW/D1 keys.
- Canonical Lark daily rows aggregate one Ad×date across publisher-platform breakdowns. `ad_channel` and `reach` are omitted when a mixed Facebook/Instagram aggregate cannot be represented safely at the current Canonical grain.
- Empty Campaign/Ad Set/Ad/Creative/Insights datasets produce `no_data_confirmed` Coverage and are not failures.
- Action arrays remain in `actions_json`; conversions and conversion value remain null until an approved mapping exists.

### Phase E — Canonical/Lark/report parity

- Every active Lark table is planned before its first business write.
- Duplicate stable keys fail closed.
- D1 writes precede Lark writes.
- D1-only rollout is supported: D1 can complete while Lark stays disabled, returning `lark_gate_disabled` without Lark preflight or mutation.
- Lark writes run through the existing TableSyncEngine and reconcile `created + updated + skipped == expected`.
- D1 report loaders read Organic observations and Meta Ads daily facts from existing D1 repositories only.
- Saturated bounded report reads return `partial` with explicit truncation metadata rather than silent completeness.
- Final work completion requires D1 and Lark reconciliation with zero failed rows.

## Files changed

- `.github/workflows/meta-end-to-end-verification.yml`
- `apps/sync-worker/src/meta-end-to-end-job-router.js`
- `docs/tasks/meta-end-to-end.md`
- `packages/config/src/meta-end-to-end-runtime-config.js`
- `packages/application/src/use-cases/collect-meta-end-to-end-source.js`
- `packages/application/src/use-cases/build-meta-organic-write-set.js`
- `packages/application/src/use-cases/build-meta-ads-write-set.js`
- `packages/application/src/use-cases/process-meta-end-to-end-generation.js`
- `packages/application/src/use-cases/load-meta-d1-report-source.js`
- Five focused test files under `tests/application/`

No protected shared file is modified.

## Existing shared helpers reused

- `MetaGraphClient`
- `FacebookOrganicSourceAdapter`
- `InstagramOrganicSourceAdapter`
- `MetaAdsSourceAdapter`
- `normalizeMetaOrganic*Fixture`
- `normalizeMetaAds*Fixture`
- `createOrganicContentRows`
- `createOrganicHistoryWriter`
- Storage v1 stable-key builders and row validators
- `D1MarketingHistoryStore`
- `D1OrganicHistoryGateway`
- TableSyncEngine `planByKey` / `executePlan`
- Existing `JOB_TYPES.FACEBOOK_ORGANIC_SYNC`
- Existing `JOB_TYPES.INSTAGRAM_ORGANIC_SYNC`
- Connector Catalog entries and shared error taxonomy

## Data contracts

### Shared RAW targets

- `RAW_Meta_Organic_Accounts`
- `RAW_Meta_Organic_Content`
- `RAW_Meta_Organic_Metrics`
- `RAW_Ads_Entities`
- `RAW_Ads_Daily`

### Canonical targets

- `MKT_Accounts`
- `MKT_Account_Daily`
- `MKT_Content`
- `MKT_Content_Daily`
- `MKT_Ads_Accounts`
- `MKT_Ads_Campaigns`
- `MKT_Ads_AdGroups`
- `MKT_Ads_Ads`
- `MKT_Ads_Creatives`
- `MKT_Ads_Daily`

### D1 targets

- `organic_content_state`
- `organic_content_observations`
- `organic_account_daily_facts`
- `ads_entity_state`
- `ads_daily_facts`
- `data_coverage_runs`
- `data_coverage_entities`

No new D1 table is required.

## Stable and idempotency keys

- Raw Organic account: `{platform}:{source_account_id}`
- Raw Organic content: `{platform}:{source_account_id}:{source_content_id}`
- Raw Organic metric: `{platform}:{entity_type}:{source_entity_id}:{metric_name}:{period}:{source_time_key}`
- Canonical Organic content: `{platform}:{account_id}:{external_content_id}`
- Canonical Organic daily: `{platform}:{account_id}:{external_content_id}:{metric_date}`
- D1 Organic content: `{platform}:{account_key}:{external_content_id}`
- D1 Organic observation: `{content_key}:{observed_at}:{observation_kind}:v1`
- Organic account daily: `{platform}:{account_key}:{metric_date}`
- Raw Ads entity: `{platform}:{account_id}:{entity_type}:{external_entity_id}`
- Raw Ads daily: `{platform}:{account_id}:{entity_type}:{external_entity_id}:{metric_date}:{breakdown_key}`
- D1 Ads entity: `{platform}:{account_key}:{entity_type}:{external_entity_id}`
- D1 Ads daily: `{platform}:{account_key}:{report_level}:{external_entity_id}:{metric_date}:{breakdown_key}:{segment_key}`
- Durable source unit: `{connector}:{dataset}:{account}:{entity-or-account}:page_{n}:{cursor-or-start}`
- Coverage IDs are operation-scoped and deterministic.

## Pagination and incremental strategy

- One node/page per durable source unit.
- Default/max page size remains 100 through existing adapter/client contracts.
- Maximum pages per dataset is injected from bounded Runtime config and cannot exceed 100.
- `hasMore` without a next cursor fails permanently.
- Repeated current/visited cursor fails permanently before continuation.
- Source watermark is the maximum available `updated_time`, `timestamp`, `created_time`, `date_start` or `date_stop` observed by the unit.
- Caller persists `nextState` and `createMetaSourceCheckpoint()` in existing resumable/cursor stores.
- Meta Ads date ranges remain bounded to the existing 31-day adapter contract.
- A periodic full-reconciliation schedule remains blocked and is not added by this Workstream.

## Retry, lock and DLQ behavior

- Source/Graph retry classification remains owned by `MetaGraphClient` and the shared runtime error taxonomy.
- Business processing calls injected shared `assertLockActive` before D1 writes, Lark plans/writes, phase saves and work completion.
- Durable phase state records D1 row index, Organic History completion and Lark table index.
- Repeating a partially completed phase is safe through existing UPSERT/observation identity/TableSyncEngine idempotency.
- The Workstream returns `continuationRequired=true`; it does not send a Queue message.
- Queue retry, continuation scheduling and DLQ admission remain exclusively owned by the existing shared reliability path.

## Coverage and reconciliation

- Organic Content Coverage is written by the existing Organic History Writer.
- Account-daily and Ads Coverage use Storage v1 contracts.
- Empty Meta Ads datasets use `no_data_confirmed` with expected/observed/written rows equal to zero.
- `complete` Coverage requires expected and observed counts to match and failed rows to be zero.
- Lark preflight rejects duplicate input keys before any business write.
- D1-only rollout does not perform Lark preflight or mutation.
- Final completion requires every planned D1 operation and active Lark table to reconcile.

## Runtime flags — all default false

- `MKT_META_SOURCE_READ_ENABLED=false`
- `MKT_META_D1_WRITE_ENABLED=false`
- `MKT_META_LARK_WRITE_ENABLED=false`
- `MKT_META_REPORT_READ_ENABLED=false`

Central connector flags remain an additional gate:

- `MKT_CONNECTOR_FACEBOOK_ENABLED`
- `MKT_CONNECTOR_INSTAGRAM_ENABLED`
- `MKT_CONNECTOR_META_ADS_ENABLED`

No example environment, Wrangler or customer profile is changed in this PR because those files remain Integration-owned shared files.

## Protected-file patch proposals for a later separately approved Integration task

1. **Shared Job Catalog**
   - Change Facebook/Instagram implementation status only after Integration UAT.
   - Add `META_ADS_SYNC: 'meta.ads.sync'` mapped to `CONNECTOR_KEYS.META_ADS`.
   - Keep all three `UAT_PENDING` until Live gates are verified.
2. **Main Worker entrypoint/runtime infrastructure**
   - Construct existing source adapters from shared Meta Graph clients.
   - Register `createMetaEndToEndJobRouter()` in the existing route chain.
   - Use existing resumable work store, reliable runner, lock and continuation Queue.
3. **Customer profiles**
   - Add exact customer-owned Facebook Page, Instagram Account and Meta Ad Account mappings only after verified-administrator access and token rotation.
4. **Wrangler/example configuration**
   - Add four Workstream flags as false.
   - Do not store tokens or secrets in source.
5. **Shared Lark table registry**
   - Pass existing table IDs only; do not recreate tables.
6. **Root package**
   - Optional Integration-owned convenience command for the focused Meta test suite; not required by Runtime.

## Integration review corrections

- D1 business processing can complete under a D1-only gate and stops at `lark_gate_disabled`; Lark preflight/write remains blocked until its independent flag is enabled.
- Meta content `reach` remains in Shared RAW metrics and is not mislabeled as Canonical `unique_viewers`.
- Saturated bounded D1 report reads are marked `partial` with explicit truncation metadata.
- Source collection honors an injected maximum-page cap and rejects `hasMore` responses without a durable cursor.

## Remote and Live actions explicitly not performed

- No Worker deploy
- No Remote D1 migration or mutation
- No Remote Lark schema or record mutation
- No Queue message
- No Cron/Schedule activation
- No Production secret or Cloudflare configuration change
- No Production token usage or rotation
- No Meta App change
- No Developer verification
- No Customer LIVE UAT
- No PR merge

## Final verification result

Final clean head: `60871dca73c948c703d03a0bb9646b4577ac7504`

```text
Meta End-to-End Verification run 30209713813 / #13    PASS
npm ci                                                  PASS
git diff --check origin/main...HEAD                     PASS
npm run check                                           PASS
Focused Meta tests                                      14 / 14 PASS
Node Unit / Integration tests                           882 / 882 PASS
Workers runtime tests                                   9 / 9 PASS
Report reliability                                      91 / 91 PASS
npm audit --audit-level=high                            0 vulnerabilities
npm run deploy:dry-run                                  PASS / no deployment

Shared Branch Verification run 30209713814 / #550      PASS
Focused staged TikTok regression                        PASS
Full Unit / Workers runtime regression                  PASS
Report reliability                                      PASS
Dependency audit                                        PASS
Wrangler dry-run                                        PASS / no deployment
```

## Integration handoff sequence

1. Review this Draft PR against the final current `main` and other parallel Workstreams.
2. Keep all Meta and schedule flags false.
3. Complete verified-administrator access, Developer verification, token rotation and exact customer mappings in a separately authorized Integration task.
4. Apply protected shared-file routing/config proposals only in that separately approved task.
5. Run fixture and read-only DEV validation.
6. Enable source-read only for approved identities and verify bounded pagination/rate-limit behavior.
7. Enable D1 write and verify Coverage/reconciliation with Lark still disabled.
8. Enable Lark write and verify Existing TableSyncEngine parity.
9. Perform Integration-owned LIVE UAT only after explicit approval.
10. Use a separate activation PR for flags/schedule after UAT approval.
