# Current Task — Google Ads Manager Script Signed Delivery Connector

## Status

- **Task status:** `implemented_ready_for_isolated_uat`
- **Approval source:** explicit user instruction on `2026-07-22` to proceed with `Google Ads Manager Script signed delivery connector`
- **Repository branch:** `agent/google-ads-signed-delivery`
- **Draft PR:** `#17`
- **Environment mutated:** none
- **Lark Formula/View/schema mutation:** none; complete and must not be reopened
- **Google Ads mutation:** none; Manager Script is read-only
- **Worker/D1 migration deployment:** none
- **Queue/DLQ live message:** none
- **Schedule:** disabled; no Google Ads schedule contract exists
- **Production mutation:** none
- **Last updated:** `2026-07-22`

## Objective

Implement a fail-closed signed delivery path from Google Ads Manager Script to the existing Worker/Queue/reliability/Lark architecture for exact advertiser Chemistry K `566-233-2033` under manager `946-357-0541`, without enabling a schedule or changing Google Ads/Lark configuration.

## Authority and locked contract

The exact transport and runtime contract is:

`docs/google-ads-signed-delivery-contract-v1.md`

The step-by-step isolated UAT and rollback procedure is:

`docs/google-ads-signed-delivery-uat.md`

Header names, HMAC algorithm/signing input, envelope fields, limits, timestamp/replay window, idempotency rule and exact allowlist are locked by that document and the implementation constants.

## In scope

- exact-account, read-only Manager Script;
- `DRY_RUN`, signed `PREVIEW`, manual one-shot `LIVE`;
- HMAC-SHA-256 over exact raw UTF-8 JSON body;
- exact timestamp, nonce, replay, key rotation and idempotency rules;
- strict six-dataset schema, counts, ordering, relation and null validation;
- API Worker ingress and sanitized HTTP errors;
- D1 nonce/delivery/payload state;
- reference-only Queue job;
- shared retry/backoff, distributed lock, reliability, DLQ/redrive and reconciliation;
- six Google RAW plus six already-applied Canonical destination tables;
- exact Chemistry K allowlist;
- tests and isolated UAT instructions;
- feature flag disabled by default and Production gate blocked.

## Out of scope

- Lark Formula, View or schema Apply/change;
- Google Ads Campaign, Ad Group, Ad, budget, billing or account mutation;
- any schedule activation;
- direct Google Ads API OAuth/reporting path;
- TikTok Ads scope;
- Production deployment/cutover;
- unapproved conversion-action aggregation;
- new Asset Group/Conversion Action/Conversion Daily delivery datasets;
- inferred changes to preserved legacy Lark Views.

## Implementation result

### Added

- `scripts/google-ads-manager-script-signed-delivery.js`
- `apps/api-worker/src/google-ads-delivery-handler.js`
- strict signed-delivery validator/normalizer;
- HMAC verifier and current/previous key rotation;
- D1 delivery store and migration `0009_google_ads_signed_delivery.sql`;
- Google Ads Queue job and active runtime route;
- 12-table plan-before-write/reconciliation use case;
- connector/profile/table configuration in disabled state;
- focused security, schema, idempotency, retry, lock, DLQ, retention, Script safety and regression tests;
- Contract and UAT/rollback documentation.

### Reused instead of duplicated

- central Connector catalog and Customer profiles;
- central Queue Job catalog;
- existing `TableSyncEngine` stable-key planning/execution;
- existing D1-first reliability store, distributed lock and retry classification;
- existing Queue/DLQ/redrive infrastructure;
- existing Lark record repository and reliability mirror;
- already-applied Google Ads RAW/Canonical tables, formulas and views.

### Security and failure behavior

- exact route/headers/signature/body digest;
- 300-second timestamp window and 600-second nonce retention;
- exact MCC/account/customer/account-key/timezone allowlist;
- unknown fields and unsupported relations fail closed;
- Queue never carries raw payload/signature/secret/nonce;
- PREVIEW and completed payloads are redacted immediately;
- failed payload has a 7-day application redrive window and is redacted on the first ingress/read after expiry;
- terminal audit is cleanup-eligible after 30 days during an ingress sweep;
- Production remains blocked until customer-real UAT gates pass.

## Required tests

- [x] exact account selection and post-select identity check
- [x] signature valid/invalid
- [x] tampered body/digest
- [x] missing/duplicate headers
- [x] exact HTTPS route and query rejection
- [x] expired timestamp
- [x] replayed nonce
- [x] idempotency same body/conflicting body
- [x] strict schema/count/order/relation/null/currency validation
- [x] bounded payload/dataset limits
- [x] Script retry/backoff and fresh nonce
- [x] Queue reference-only payload
- [x] plan all destinations before first write
- [x] stable-key idempotency and reconciliation
- [x] shared distributed lock route
- [x] retryable failure persistence
- [x] permanent failure before DLQ persistence
- [x] bounded payload retention and expiry
- [x] Production gate and schedule-disabled config
- [x] Manager Script mutation/schedule safety scan
- [ ] isolated signed PREVIEW against UAT Worker
- [ ] one-shot LIVE UAT and exact Google Ads UI reconciliation
- [ ] controlled live retry/lock/DLQ/redrive UAT
- [ ] customer-real zero-duplicate rerun

## Verification before final branch gate

Implementation commit: `31474c92cc48bbb6d45fd4aa1d2d3eb7b6354526`.

Local source-snapshot verification after the final code changes:

- focused Google Ads signed-delivery tests: `43/43 PASS`;
- architecture/hygiene: `154 source files / 371 local dependencies / 0 cycles`;
- Node unit/integration tests: `586/586 PASS`;
- report reliability: `70/70 PASS`;
- `git diff --check`: PASS;
- secret/build-artifact/repository hygiene scan: PASS.

The final Draft PR head must still pass the repository Branch Verification workflow (`npm ci`, `npm run check`, staged TikTok regression, `npm test` including Workers runtime, report reliability, dependency audit and Wrangler dry run) before handoff.

## Remaining risks

- External signed PREVIEW/LIVE has not been executed from Google Ads Scripts to an isolated UAT deployment.
- Exact live Lark Table IDs and UAT secrets must be configured through environment/secret stores.
- Customer-real dataset volume/retry/DLQ evidence is still required before Production.
- The Manager Script intentionally keeps unsupported Campaign dates `null`; a future Google runtime change needs a separately verified contract revision before querying them.

## Handoff state

- `LINKED_UI_PASS`
- `NEXT_TASK = GOOGLE_ADS_SIGNED_DELIVERY_CONNECTOR_UAT`
- `LARK_SCHEMA_WORK = COMPLETE / DO_NOT_REOPEN`
- `SCHEDULE = DISABLED`
