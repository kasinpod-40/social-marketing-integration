# 10 — Next Actions

## Immediate next action — Await customer callbacks

PR A/B/C and retry-safe PR `#45` are merged. Migration `0012` and Worker v2 are
live. The test invitations expired unused; seven-day customer links are active.
Next:

1. Keep PR #17 Draft/HOLD.
2. Keep merged source `9ca8375` plus docs closeout `5e5b8ee` as rollout evidence.
3. Review the additive data model and guarded rollout; keep orphaned PKCE cleanup
   outside this rollout.
4. Do not poll while waiting; customer explicitly confirms Google Ads and
   YouTube links before `2026-08-01 00:15 Asia/Bangkok`.
5. Verify successful callback closure, encrypted Refresh Tokens, provider
   identity and zero Queue/Lark side effects.
6. Regenerate links only if they expire or exhaust the three-attempt budget.

Do not enqueue business jobs, write Lark, enable schedules or rerun TikTok recovery. Exact commands are in `docs/customer-connection-oauth-rollout.md`.

## Parallel Meta connection preflight

The customer-owned Meta app does not require a new customer Connect link before
token validation because the customer supplied separate Facebook and Instagram
tokens. A read-only Safari inspection on `2026-07-25` found Marketing/Page read
permissions available for testing, but the app is API-restricted until every
administrator completes Developer Portal account verification. The locally
stored Instagram token passed read-only `/me` identity validation with HTTP
`200`; Facebook validation is pending because `META_ACCESS_TOKEN` is not
currently present in the ignored local runtime config.

Safe order:

1. Store the supplied Facebook token under the approved ignored/Secret
   boundary; never paste it into Source, docs or logs.
2. Run read-only Facebook Page identity/scope validation.
3. Customer-app administrators complete Developer Portal verification in
   parallel and repeat the read-only app audit.
4. Lock token lifecycle, exact Facebook/Instagram identity and separate
   Facebook Organic / Instagram Organic / Meta Ads connection records.
5. Update `docs/current-task.md` to approve the exact token-based Meta
   connector scope before implementation.

Do not reuse the developer-owned Meta app as customer evidence. Do not add an
Instagram use case, change permissions, publish the app, submit App Review or
generate Meta customer links from this preflight. The dashboard restriction is
an operational blocker/risk, not evidence that the supplied tokens are invalid.

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
