# 10 — Next Actions

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

## Immediate next gate

The signed-delivery Source implementation is complete on Draft PR `#17`. Run Google Ads validation in the same Integration Workspace using `docs/google-ads-signed-delivery-integration-validation.md`.

Required order:

1. final branch CI and security scan;
2. existing Integration Workspace D1 migration and Worker deployment;
3. Manager Script `DRY_RUN`;
4. signed zero-write `PREVIEW`;
5. negative signature/tamper/header/timestamp/replay checks;
6. manual one-shot `LIVE`;
7. all 12 destination reconciliation;
8. exact-body and fresh-delivery idempotent reruns;
9. controlled retry/backoff, concurrent-lock and DLQ/redrive/expiry checks;
10. TikTok, Meta, YouTube and Core regression evidence.

Keep Schedule disabled and do not reopen Lark Formula/View/schema work. Production requires a separate approval and customer-owned resources.

## Direct Google Ads API track

Current state:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current level Test Account Access
```

Direct API is optional Phase 2. Do not delay the Manager Script MVP solely for approval, but do not claim production direct-API readiness until approval and OAuth validation passes.

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
3. Meta Ads connector and customer-data validation.
4. TikTok Ads access/Business Center/API preflight and connector.
5. WooCommerce.
6. Chatwoot.
7. Multi-channel AI summary/insight/notification.
8. Replace temporary developer sources channel by channel without changing profile `integration_workspace`.
9. Run full customer-data validation in the same Workspace.
10. Customer-owned Production cutover.

## Permanent release blockers

- Production resources not customer-owned.
- Connector/source identity not verified.
- Missing stable key or idempotency contract.
- Missing bounded pagination/batch limits.
- Missing replay/signature validation for inbound delivery.
- Reliability, reconciliation or partial-write gate failing.
- Schedule enabled before manual integration validation.
- Secret/customer identity present in Source or logs.
- Customer-scale live validation not completed where required.
