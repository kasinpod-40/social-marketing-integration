# Customer-real UAT Contract

## Purpose

Customer-real UAT uses real Chemistry K source accounts and customer data to validate production behavior before customer-owned Production infrastructure is ready. It is not sample, sandbox or demo data.

**Locked owner decision:** Customer-real UAT is performed on the existing developer DEV infrastructure. It is a logical data/profile switch, not a third deployment environment.

## Ownership matrix

| Layer | Developer-test DEV | Customer-real UAT on DEV | Production |
| --- | --- | --- | --- |
| Source accounts and data | Developer | Customer | Customer |
| Lark Base | Existing developer DEV Base | Same existing developer DEV Base | Customer |
| Cloudflare Worker/D1/Queue/DLQ | Existing developer DEV resources | Same existing developer DEV resources | Customer |
| `MKT_ENV` | `development` | `development` | `production` |
| Runtime profile | `dev_ft_pumkin` | `uat_chemistry_k` | `chemistry_k` |
| Canonical customer/account identity | DEV-specific | `chemistry_k` | `chemistry_k` |

No UAT Worker, D1, Queue, DLQ, Lark Base or secret store is created or renamed merely for UAT. The only intended operational change is the authorized source account/data and the logical runtime profile used to preserve customer identity.

## Identity and stable-key contract

- `MKT_ENV=development` for both developer-test DEV and Customer-real UAT.
- `profileKey=uat_chemistry_k` identifies customer-real execution on the existing DEV resources.
- `customerKey` and connector `accountKey` remain `chemistry_k` across UAT and Production.
- Never prefix Canonical business identity with `uat_`.
- Live identities must come from approved Environment configuration or the locked connector contract after customer authorization and exact identity verification.
- Switching back to developer-test data requires restoring `MKT_CUSTOMER_PROFILE=dev_ft_pumkin` and the corresponding source authorization/config; do not mix source identities in one run.

## Shared-DEV safety boundary

Because UAT reuses the existing DEV resources:

- do not run developer-test and customer-real source executions for the same connector concurrently;
- record the active profile, source account, checkpoint boundary and operator before each manual UAT run;
- take the existing DEV D1 backup before applying a new approved migration;
- preserve stable-key and customer/account identity so customer rows cannot collide with developer-test rows;
- keep connector and business schedule flags disabled by default;
- use manual Preview/one-shot execution until UAT acceptance;
- do not rerun Lark Formula, View or schema Apply when the existing DEV Base is already complete;
- secrets remain in the existing DEV secret store and must not be copied into Git, Lark, logs or documents.

## Authorization and access

- The customer or an authorized customer administrator authorizes the intended source account.
- The customer completes authentication on the customer's device/session when required.
- The developer does not collect customer login credentials.
- Access is least-privilege and limited to people involved in delivery and acceptance.
- Customer data is not reused for another customer or public demo without explicit authorization.

## Default safety state

- Every customer-real connector is disabled by default until its identity/source-contract gate passes.
- Every business schedule remains disabled during UAT unless the user separately approves activation after manual idempotency/reconciliation evidence.
- Redrive remains disabled by default except during an approved controlled incident/UAT step.
- Production remains disabled.
- Migration, deployment and write actions require the approved Current Task and guarded runbook.

## Customer-real UAT gate

1. Confirm customer authorization and exact source account identity.
2. Confirm the existing DEV Base/schema is the approved target and no schema work is reopened.
3. Switch only the logical runtime profile/source configuration required for customer data.
4. Apply only the approved migration to the existing DEV D1 after backup.
5. Deploy the approved code to the existing DEV Worker(s) with the connector flag still disabled by default.
6. Run read-only `DRY_RUN`/preflight.
7. Run signed `PREVIEW` with zero Queue/Lark business writes.
8. Run manual one-shot `LIVE`, then return to `DRY_RUN`/disabled state immediately.
9. Verify idempotency, reconciliation, retry, lock, DLQ/redrive, alerts and zero duplicate stable keys.
10. Keep Production blocked until customer-owned Production resources and cutover gates are approved.

## Data retention and Production cutover

Before the first customer-data destination write, record customer authorization, access scope, retention/export/deletion procedure and the existing DEV data cleanup boundary.

Production cutover must use customer-owned Lark and Cloudflare resources. Code and Data Model remain the same; environment bindings, non-secret mappings and secrets change. A later cutover task decides whether Production backfills from source or migrates approved UAT data based on historical API limits and reconciliation evidence.

## Current authorization boundary

This contract permits Customer-real UAT to use the existing DEV resources. It does not itself authorize Production rollout, schedule activation, unreviewed migration, Lark schema mutation or Google Ads campaign/ad mutation.
