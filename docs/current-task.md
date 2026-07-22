# Current Task — Google Ads Manager Script Signed Delivery Connector

## Status

- **Task status:** `implemented_ready_for_integration_workspace_validation`
- **Approval source:** explicit user instruction on `2026-07-22`
- **Repository branch:** `agent/google-ads-signed-delivery`
- **Draft PR:** `#17`
- **Runtime resources mutated:** none
- **Lark Formula/View/schema mutation:** none; complete and must not be reopened
- **Google Ads mutation:** none; Manager Script is read-only
- **Worker/D1 migration deployment:** none
- **Queue/DLQ live message:** none
- **Schedule:** disabled; no Google Ads schedule contract exists
- **Production mutation:** none
- **Last updated:** `2026-07-23`

## Objective

Implement a fail-closed signed delivery path from Google Ads Manager Script to the existing Worker/Queue/reliability/Lark architecture for exact advertiser Chemistry K `566-233-2033` under manager `946-357-0541`, without enabling a schedule or changing Google Ads/Lark configuration.

## Locked contracts

- Transport/runtime: `docs/google-ads-signed-delivery-contract-v1.md`
- Manual validation/rollback: `docs/google-ads-signed-delivery-integration-validation.md`
- Workspace model: `docs/project-brain/integration-workspace.md`

Header names, HMAC algorithm/signing input, envelope fields, limits, timestamp/replay window, idempotency rule and exact allowlist remain locked.

## Integration Workspace topology lock

- There is one pre-Production Integration Workspace, not separate DEV/UAT operating modes.
- Keep `MKT_ENV=development` as the technical runtime label and `MKT_CUSTOMER_PROFILE=integration_workspace` throughout assembly and validation.
- Reuse the existing Worker, D1, Queue, DLQ, secret store, Lark Base and table IDs.
- Source ownership is per Connector. TikTok (`@chemistry_k`) and Google Ads already use Chemistry K customer data; Facebook, Instagram and YouTube may still use temporary developer-owned sources.
- TikTok Organic was already Chemistry K before this task; it is not a newly switched source and does not require a source-replacement cleanup step.
- Do not switch profiles for Google Ads validation. Change only Google Ads connector flag, signing configuration and Script execution mode.
- After manual validation, restore Google Ads to connector-disabled and Script `DRY_RUN`; the Workspace profile stays unchanged.

## In scope

- exact-account, read-only Manager Script;
- `DRY_RUN`, signed `PREVIEW`, manual one-shot `LIVE`;
- HMAC-SHA-256 over exact raw UTF-8 JSON body;
- timestamp, nonce, replay, key rotation and idempotency rules;
- strict six-dataset schema, counts, ordering, relation and null validation;
- API Worker ingress and sanitized HTTP errors;
- D1 nonce/delivery/payload state;
- reference-only Queue job;
- shared retry/backoff, distributed lock, reliability, DLQ/redrive and reconciliation;
- six Google RAW plus six already-applied Canonical destination tables;
- exact Chemistry K allowlist;
- integration validation using existing Workspace resources;
- feature flag disabled by default and Production blocked.

## Out of scope

- Lark Formula, View or schema Apply/change;
- Google Ads Campaign, Ad Group, Ad, budget, billing or account mutation;
- schedule activation;
- direct Google Ads API OAuth/reporting path;
- TikTok Ads scope;
- Production deployment/cutover;
- unapproved conversion-action aggregation;
- new Asset Group/Conversion Action/Conversion Daily delivery datasets;
- inferred changes to preserved legacy Lark Views;
- deletion or relabeling of TikTok records based only on old runtime/profile labels.

## Implementation result

### Added

- `scripts/google-ads-manager-script-signed-delivery.js`
- `apps/api-worker/src/google-ads-delivery-handler.js`
- strict validator/normalizer and HMAC verifier with key rotation;
- D1 delivery store and migration `0009_google_ads_signed_delivery.sql`;
- reference-only Queue job and active runtime route;
- 12-table plan-before-write/reconciliation use case;
- disabled-by-default connector/config bindings;
- focused security, schema, idempotency, retry, lock, DLQ, retention and Script-safety tests;
- locked Contract and validation/rollback documentation.

### Reused instead of duplicated

- central Connector and Job catalogs;
- `TableSyncEngine` stable-key planning/execution;
- D1-first reliability store, distributed lock and retry classification;
- Queue/DLQ/redrive infrastructure;
- Lark repository and reliability mirror;
- already-applied Google Ads RAW/Canonical tables, formulas and views.

### Security/failure behavior

- exact route/headers/signature/body digest;
- 300-second timestamp window and 600-second nonce retention;
- exact MCC/account/customer/account-key/timezone allowlist;
- unknown fields and unsupported relations fail closed;
- Queue never carries raw payload/signature/secret/nonce;
- PREVIEW and completed payloads are redacted immediately;
- failed payload has a seven-day redrive window;
- terminal audit cleanup eligibility after 30 days;
- Production remains blocked until full customer-data validation passes.

## Required tests

- [x] exact account selection and post-select identity check
- [x] signature valid/invalid
- [x] tampered body/digest
- [x] missing/duplicate headers
- [x] exact HTTPS route and query rejection
- [x] expired timestamp and replayed nonce
- [x] idempotency same body/conflicting body
- [x] strict schema/count/order/relation/null/currency validation
- [x] bounded payload/dataset limits
- [x] Script retry/backoff and fresh nonce
- [x] Queue reference-only payload
- [x] plan all destinations before first write
- [x] stable-key idempotency and reconciliation
- [x] shared distributed lock route
- [x] retryable/permanent failure persistence and DLQ ordering
- [x] bounded payload retention and expiry
- [x] Production gate and schedule-disabled config
- [x] Manager Script mutation/schedule safety scan
- [x] one Integration Workspace profile with mixed per-Connector source ownership
- [x] legacy DEV/UAT profile aliases normalize to the same Workspace
- [x] Lark TikTok For Creator account is `@chemistry_k`
- [x] latest inspected Base export shows `RAW_TikTok_Creator_Videos` already populated with `2,021` records
- [x] old `dev_ft_pumkin` / `ft_pumkin` names are treated as compatibility labels, not proof of different TikTok data ownership
- [ ] signed PREVIEW against the existing API Worker using Chemistry K Google Ads data
- [ ] one-shot LIVE and exact Google Ads UI reconciliation
- [ ] controlled retry/lock/DLQ/redrive validation
- [ ] zero-duplicate rerun

## Verification

Integration Workspace correction and compatibility verification:

- canonical pre-Production profile: `integration_workspace`;
- per-Connector source ownership and replacement metadata: PASS;
- established Chemistry K TikTok source status: PASS;
- Base inventory evidence: `RAW_TikTok_Creator_Videos = 2,021 records`;
- legacy profile/report-key compatibility: PASS;
- architecture/hygiene: `154 source files / 372 local dependencies / 0 cycles`;
- Node unit/integration: `589/589 PASS`;
- report reliability: `71/71 PASS`;
- `git diff --check`: PASS.

Final Branch Verification run `#235` completed successfully after the TikTok source metadata correction:

- `npm ci`: PASS;
- `npm run check`: PASS;
- staged TikTok regression: PASS;
- `npm test` including Workers runtime: PASS;
- `npm run test:report-reliability`: PASS;
- `npm audit --audit-level=high`: PASS;
- `npm run deploy:dry-run`: PASS.

## Remaining risks

- External signed PREVIEW/LIVE has not been executed against the existing Workspace with Chemistry K Google Ads data.
- Signing secrets must be configured through the existing secret store.
- Customer-scale retry/DLQ/idempotency evidence remains required before Production.
- Facebook, Instagram and YouTube still require customer-source replacement later in the same Workspace.

## Handoff state

- `LINKED_UI_PASS`
- `NEXT_TASK = GOOGLE_ADS_SIGNED_DELIVERY_INTEGRATION_VALIDATION`
- `INTEGRATION_WORKSPACE = SINGLE_PROFILE / MIXED_SOURCES`
- `TIKTOK_SOURCE = CHEMISTRY_K / ESTABLISHED`
- `TIKTOK_RECORD_DELETION = NOT_REQUIRED / NOT_AUTHORIZED`
- `LARK_SCHEMA_WORK = COMPLETE / DO_NOT_REOPEN`
- `SCHEDULE = DISABLED`
