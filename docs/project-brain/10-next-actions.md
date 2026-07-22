# 10 — Next Actions

## Immediate repository correction gate

Before starting a new connector:

1. Review branch `work/repository-closeout-corrections`.
2. Confirm the Google Ads View Filter command blocks all `create_view` and non-`update_view` actions.
3. Confirm Basic Access application history is corrected:
   - submitted `2026-07-21`;
   - case `1-686800040839`;
   - project `788131774873`;
   - pending review;
   - current access remains Test Account Access.
4. Confirm the 55 legacy specialized Views remain preservation-only and are not described as business-filter complete.
5. Run full gates:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
```

6. Merge only after clean diff and gate review.

## Next implementation workstream

Open a separate approved task:

`Google Ads Manager Script signed delivery connector`

Do not expand the closed Lark schema/View/Formula task.

## Contract decisions required before coding

### Payload

- schema name and version;
- six dataset envelopes;
- bounded batch size and payload byte limit;
- source-generated timestamp;
- nullable field semantics;
- unknown field/version behavior;
- partial batch acceptance policy.

### Identity and idempotency

- customer key and Google Ads account key;
- stable key per dataset;
- delivery ID and idempotency key;
- deterministic record fingerprints;
- duplicate and replay behavior;
- reconciliation scope.

### Security

- HMAC algorithm and canonical signing string;
- timestamp tolerance;
- nonce format and D1 reservation;
- replay rejection;
- secret rotation;
- safe error responses;
- log and payload redaction;
- retention and deletion policy.

### Reliability

- ingress validation before Queue enqueue;
- Queue job type and schema version;
- retryable versus permanent errors;
- DLQ behavior;
- distributed lock scope;
- D1 checkpoint and partial progress;
- bounded write chunks;
- partial-write semantics;
- reconciliation and idempotent rerun;
- System Alert and Sync Log evidence.

### Ownership and rollout

- DEV connector disabled by default;
- isolated `uat_chemistry_k` Worker, D1, Queue, DLQ, Secrets and Lark Base;
- customer-owned source account;
- customer-owned Production infrastructure;
- schedule disabled until manual UAT and reliability gates pass.

## Implementation sequence

1. Add Google Ads connector catalog entry and disabled feature flag.
2. Add signed ingress contract and verifier without enabling delivery.
3. Add nonce/replay D1 migration and repository.
4. Add Queue job catalog entry and Worker route.
5. Add six-dataset source DTO validation.
6. Add normalization and stable-key destination plans.
7. Add RAW/Canonical/Daily Lark writers using existing sync engine.
8. Add checkpoint, lock, retry, DLQ, reconciliation and redaction.
9. Add bounded fixtures and failure tests.
10. Run local gates and deploy dry-run.
11. Deploy isolated UAT with schedule off.
12. Run one manual signed delivery.
13. Run idempotent resend and reconciliation.
14. Test controlled retry/DLQ paths without changing Ads.
15. Observe clean operational state.
16. Consider schedule only after explicit approval.

## Direct Google Ads API track

Basic Access review remains pending. Direct API is not an MVP blocker for Manager Script delivery.

Use direct API later when needed for:

- centralized OAuth;
- higher scale;
- fields unavailable in Manager Scripts;
- cross-client SaaS onboarding;
- API-native scheduling and reporting.

Do not mix direct API implementation into the first signed-delivery task unless the user approves a scope change.

## Other channel order after Google Ads delivery

1. Facebook Organic connector.
2. Instagram Organic connector and token lifecycle monitoring.
3. Meta Ads connector.
4. TikTok Ads access and connector track.
5. WooCommerce.
6. Chatwoot.
7. Multi-channel AI summary, insight and notification.
8. Channel-by-channel customer-real UAT.
9. Customer-owned Production cutover.

## Permanent restrictions

- Do not rerun Lark schema, Formula or managed Google View Apply unless a verified drift is found.
- Do not infer Filter/Sort/Hidden behavior for the 55 legacy specialized Views from names.
- Do not enable Google Ads delivery or schedule before signed-delivery UAT.
- Do not store secrets or customer identifiers in Source or documentation.
- Do not deploy Production resources under the developer's ownership.
