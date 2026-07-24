# 10 — Next Actions

## Immediate next action — Retry-safe Connect flow

PR A/B/C source and tests are merged in order `#42` → `#43` → `#44`. Remote D1 migration, Google OAuth configuration, Worker Secrets/runtime mappings, deployment and HTTP smoke are complete. Both customer and test invitations were consumed at OAuth begin without callbacks; all states expired and all prior links are unusable. Next:

1. Keep PR #17 Draft/HOLD.
2. Do not generate more links against the current one-shot-on-GET flow.
3. Make `GET /connect/*` side-effect free and require an explicit confirmation action before OAuth begins.
4. Add bounded retries until successful callback, with expiry, rate limiting, audit and permanent closure after success.
5. Review the additive data-model change and orphaned PKCE cleanup semantics; do not mutate Remote D1 without exact approval.
6. Add prefetch/scanner, abort, retry, replay, expiry and concurrent-submit tests, then run all default gates.
7. Deploy only after reviewed rollout approval; rotate the unreadable operator Secret, then generate fresh test links before customer links.

Do not enqueue business jobs, write Lark, enable schedules or rerun TikTok recovery. Exact commands are in `docs/customer-connection-oauth-rollout.md`.

## Completed source correction

Repository audit/safety correction PR `#13` was squash-merged to main commit:

`d4a531fbb4e05dad7ce2296859c97f571e23acf3`

Verification passed:

```text
npm ci                         PASS
npm run check                  PASS
Focused staged TikTok           4/4 PASS
Node Unit/Integration         540/540 PASS
Workers runtime                 9/9 PASS
Report reliability             70/70 PASS
npm audit --audit-level=high    0 vulnerabilities
npm run deploy:dry-run          PASS
```

No Live Lark Apply, Google Ads mutation, Queue message, D1 migration, schedule change or deployment occurred.

## Immediate next approval gate

Open a separate task only after user approval:

`Google Ads Manager Script signed delivery connector`

Do not begin implementation until the contract below is approved.

## Contract to lock before coding

### Payload

1. Envelope schema and version.
2. Exact six dataset schemas:
   - account;
   - campaigns;
   - ad groups;
   - ads;
   - YouTube assets;
   - campaign daily metrics.
3. Null semantics and unsupported-field handling.
4. Bounded batch and payload size.
5. Stable ordering where required for deterministic signatures/tests.

### Security

1. HMAC algorithm and canonical serialization.
2. Timestamp format and allowed clock skew.
3. Nonce format and replay window.
4. Key rotation and environment separation.
5. Constant-time signature comparison.
6. Redacted diagnostics that never expose key, token, customer ID or raw payload.

### Identity and idempotency

1. Canonical `customerKey` and `accountKey`.
2. Stable key per dataset grain.
3. Request-level idempotency key.
4. Row-level fingerprint/checkpoint rules.
5. Rerun behavior with zero duplicate records.

### Reliability

1. Worker ingress validation order.
2. Queue job type in the central catalog.
3. Retryable versus Permanent classification.
4. D1 nonce/replay state.
5. D1 checkpoint and distributed lock.
6. DLQ and controlled redrive.
7. Partial-write semantics.
8. Reconciliation and data-quality counters.
9. Retention and expiry.

### Destination

1. RAW Google table mapping.
2. Canonical Ads Accounts/Campaigns/AdGroups/Ads/Creatives/AssetGroups/Daily mapping.
3. Relation/stable-key resolution.
4. Money micros conversion and Formula ownership.
5. Lark write batching and rate-limit handling.
6. Sync Log and System Alert evidence.

### Environment and rollout

1. DEV, `uat_chemistry_k` and Production isolation.
2. Separate secrets and signing keys per environment.
3. Connector feature flag disabled by default.
4. Schedule disabled by default.
5. Customer-real UAT retention/cleanup.
6. Customer-owned Production resources.

## Implementation order after approval

1. Add Google Ads connector/catalog/job contracts in disabled state.
2. Add signed ingress parser and security tests without destination writes.
3. Add Queue/D1 replay/idempotency state.
4. Add six-dataset normalization and destination planning.
5. Add bounded Lark writes behind explicit UAT flags.
6. Add partial-failure, retry, DLQ and reconciliation tests.
7. Run isolated manual signed-delivery UAT with schedule off.
8. Repeat the same payload and verify zero duplicates.
9. Run controlled partial-failure/recovery tests.
10. Observe a clean manual cycle before considering schedule.

## Direct Google Ads API track

Current state:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current level Test Account Access
```

Direct API is optional Phase 2. Do not delay the Manager Script MVP solely for approval, but do not claim production direct-API readiness until approval and OAuth UAT pass.

## View work

### Closed

- Table names/icons/folders
- View names/icons
- Shared-table managed filters 17/17
- Report Views 6/6
- Google Ads managed filters 19/19
- Google Formula fields 4/4
- Google View update-only maintenance guard

Do not rerun these applies.

### Separate future decision

55 legacy specialized Views are intentionally preserved without inferred business filters. Create a new business-owner contract only when there is a real use case. Each new contract must specify:

- Table and exact View name
- intended audience/purpose
- Filter conjunction and conditions
- Sort
- Hidden fields
- source/evidence
- acceptance test

Do not infer semantics from names such as Active, Failed, Latest or High Spend Low ROAS.

## RAW data-quality work

Current Google RAW error Views use stable-key-only minimum QA.

A separate Data Quality workstream may add checks for:

- customer/account IDs
- campaign/ad group/ad/asset IDs
- status/primary status/serving status
- report level and segment key
- conversion action identity
- policy state
- date and metric grain

Do not overload the current stable-key Views without approval.

## Other channel priority after Google Ads connector

1. Facebook Organic connector using shared Meta transport and reliability.
2. Instagram Organic connector and token-refresh operations.
3. Meta Ads connector and customer-real data UAT.
4. TikTok Ads access/Business Center/API preflight and connector.
5. WooCommerce.
6. Chatwoot.
7. Multi-channel AI summary/insight/notification.
8. Channel-by-channel `uat_chemistry_k`.
9. Customer-owned Production cutover.

## Permanent release blockers

- Production resources not customer-owned.
- Connector/source identity not verified.
- Missing stable key or idempotency contract.
- Missing bounded pagination/batch limits.
- Missing replay/signature validation for inbound delivery.
- Reliability, reconciliation or partial-write gate failing.
- Schedule enabled before manual UAT.
- Secret/customer identity present in Source or logs.
- Customer-scale Live UAT not completed where required.
