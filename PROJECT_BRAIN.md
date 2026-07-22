# Project Brain — Social Marketing Data Integration

## Current baseline

This project connects organic social, paid ads, commerce and conversation data into Lark Base for daily snapshots, reporting, monitoring, AI summaries and alerts. Runtime foundations use JavaScript ES Modules, Cloudflare Workers, D1, Queues and Lark Open API.

Authoritative task state: `docs/current-task.md`.

## Current repository baseline

- Main commit before this correction: `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- Main commit message: `feat: close Google Ads view and script UAT`
- Active correction branch: `work/repository-closeout-corrections`
- Application package version remains `0.11.0`; v0.13.x labels are schema/contract/tool revisions, not the deployed application release version.
- Production remains disabled.
- New connectors and schedules remain disabled by default until their own access, identity, source-contract and reliability gates pass.

## Lark Base state

Latest verified developer-owned DEV Base:

- Physical tables: `42`
- Fields: `737`
- Views: `133`
- Duplicate table names: `0`
- Table emoji/folder placement: `42/42`
- View emoji names: `133/133`
- Formula expressions/type/formatter: `4/4`
- Shared-table managed filters: `17/17`
- Report managed Views: `6/6`
- Google Ads managed filters: `19/19`
- Filtered Views total: `42`
- Sorted Views: `6`
- Views with hidden fields: `7`
- Google RAW tables/fields: `13/13`, `208/208`
- Canonical Ads v2 core: `63/63`
- Google Ads Relations/View shells: `12/12`, `19/19`
- New Google tables containing Records: `0`

`Google Ads Daily 30D` is `platform=google_ads AND metric_date=TheLastMonth`.

### View contract classes

The full 133-View inventory is classified as:

- 17 shared-table managed Views;
- 6 report managed Views;
- 19 Google Ads managed Views;
- 36 All/default Views intentionally unfiltered;
- 55 legacy specialized Views preserved without inferred business filters.

The managed and preservation contracts pass. The 55 legacy specialized Views do not yet have approved business-owner contracts; names such as Active, Failed, Latest or High Spend Low ROAS must not be treated as executable logic without a separate approved task.

## Google Ads status

### Access

- Chemistry K advertiser link/selectability: `PASS`
- Advertiser is enabled under the intended manager and opens read-only.
- Basic Access application was submitted on `2026-07-21`.
- Case ID: `1-686800040839`
- Cloud project number: `788131774873`
- Application review: `pending`
- Current developer-token level: `Test Account Access`
- Direct API approval is optional for the Manager Script MVP but remains relevant for Phase 2 scale and centralized OAuth.

Any older statement that no Basic Access application was submitted is superseded.

### Manager Script read-only UAT

- Exact advertiser allowlist and selectability passed.
- Script uses read-only `AdsManagerApp` and `AdsApp.search()` GAQL.
- Runtime-incompatible `campaign.start_date` and `campaign.end_date` request fields were removed while nullable output mapping remains.
- Final Preview: `data_available`.
- Six bounded datasets: `6/6` successful and non-empty.
- Dataset errors/truncation: `0/0`.
- Google Ads changes: `No changes`.
- Frequency: `—`; schedule disabled.
- No external delivery, Worker ingestion, Queue/D1 path, Lark destination writes or deployment exists yet.

The repository contains the verified outcome and query/output manifest, but not the full sanitized 598-line Script source. Add a sanitized immutable snapshot or exact source hash before a future delivery connector release when independent source review is required.

### Google Ads channel progress

- Lark schema and managed presentation: complete.
- Link/selectability and read-only extraction UAT: complete.
- Signed delivery connector and end-to-end destination flow: not implemented.
- Channel end-to-end estimate: approximately `45%`.

## Runtime and connector status

### Active in DEV

- TikTok Organic: native protected source, Canonical Content/Daily, reliability, reports and DEV schedules.
- YouTube Organic: Data API/Owner Analytics, Canonical writes, checkpoint/reconciliation, resumable large-account foundation and DEV schedules.

### Access/schema foundation complete but connector planned

- Facebook Organic
- Instagram Organic
- Meta Ads
- Google Ads delivery

### Early planning only

- TikTok Ads
- WooCommerce
- Chatwoot
- Multi-channel AI summary/notification completion

The current connector catalog intentionally contains only the existing runtime connector keys. Google Ads requires a separate catalog entry, feature flag, job type and route as part of the signed-delivery task.

## Permanent architecture rules

- Data model and source contract must be approved before connector coding.
- Every write path requires stable keys, idempotency, retry classification, partial-write semantics and reconciliation.
- Missing metrics use `null`, not fabricated zero.
- DEV, customer-real UAT and Production resources must remain isolated.
- Customer-real UAT uses customer-owned source data with temporary isolated developer-owned UAT infrastructure.
- Production Lark, Cloudflare, credentials and source assets must be customer-owned.
- Secrets never belong in Source, documentation, logs or release archives.
- New connectors and schedules are disabled by default.
- Unknown jobs and unsupported schema versions fail permanently.
- Lark View mutations must send request-only fields and hydrate Get View state before idempotency comparison.

## Google Ads View safety correction

The Google Ads Filter tool is update-only:

- Missing managed Views must block.
- Any `create_view` or other non-`update_view` action is forbidden.
- No View creation/deletion/rename, Field/Table mutation or Business Record operation is allowed.
- The correction branch adds `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN` and focused tests.

## RAW error coverage

Current Google RAW error Views check the table-specific primary raw stable key with `isEmpty`. This is the approved minimum identity-key QA contract, not comprehensive validation of every supporting field. Broader customer/entity/status/report/policy validation requires a separate data-quality contract.

## Current progress estimate

Milestone estimates, not code coverage:

- Core runtime/reliability: `95%`
- Lark data model and managed presentation: `100%`
- TikTok Organic: `95%`
- YouTube Organic: `90%`
- Facebook Organic: `30%`
- Instagram Organic: `30%`
- Meta Ads: `25%`
- Google Ads end-to-end: `45%`
- TikTok Ads: `10%`
- WooCommerce: `10%`
- Chatwoot: `10%`
- MKT DEV MVP overall: approximately `59%`
- Chemistry K Production readiness: approximately `25%`

Detailed weighting: `docs/project-brain/mkt-progress-v0.13.0.md`.

## Next workstream

Before connector implementation, merge the repository correction after full gates pass. Then open a separate task:

`Google Ads Manager Script signed delivery connector`

Lock before coding:

1. six-dataset payload schema and schema version;
2. stable keys and idempotency keys;
3. HMAC signature, timestamp, nonce and replay window;
4. bounded batch and payload limits;
5. null semantics;
6. partial-write and retry behavior;
7. Queue, DLQ, checkpoint, lock and reconciliation;
8. retention, audit and redaction;
9. DEV/UAT/Production ownership;
10. schedule disabled by default.

Run isolated manual UAT and idempotent rerun before enabling any schedule. Production remains disabled until customer-owned rollout gates pass.

## References

- `AGENTS.md`
- `docs/current-task.md`
- `docs/project-brain/00-current-state.md`
- `docs/project-brain/03-platform-decisions.md`
- `docs/project-brain/04-api-discoveries.md`
- `docs/project-brain/10-next-actions.md`
- `docs/project-brain/mkt-progress-v0.13.0.md`
- `docs/lark-full-view-contract-v0.13.5.md`
- `docs/Lark_Full_View_Audit_v0.13.5.md`
- `docs/repository-closeout-corrections-v0.13.7.md`
