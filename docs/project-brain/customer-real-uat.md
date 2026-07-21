# Customer-real UAT Contract

## Purpose

Customer-real UAT uses real customer-owned accounts and real customer data to validate production-scale behavior before customer-owned Production infrastructure is ready. It is not sample, sandbox or demo data.

## Ownership matrix

| Layer | DEV | Customer-real UAT | Production |
| --- | --- | --- | --- |
| Source accounts | Developer | Customer | Customer |
| Source data | Developer | Customer | Customer |
| Lark Base | Developer | Developer, temporary | Customer |
| Cloudflare Worker/D1/Queue/DLQ | Developer | Developer, isolated | Customer |
| Runtime profile | `dev_ft_pumkin` | `uat_chemistry_k` | `chemistry_k` |
| Canonical customer/account identity | DEV-specific | `chemistry_k` | `chemistry_k` |

The UAT Base and Cloudflare resources are temporary infrastructure owned by the developer. Ownership of the connected accounts and data does not transfer from the customer.

## Identity and stable-key contract

- `profileKey` identifies an environment configuration and may differ between UAT and Production.
- `customerKey` identifies the customer and must be `chemistry_k` in both UAT and Production.
- Every customer connector `accountKey` must remain `chemistry_k` unless the approved Data Model defines a distinct real account key.
- Never prefix Canonical business identity with `uat_`.
- Source-specific live identity such as TikTok handle must come from Environment/config after customer authorization and exact identity verification.
- A connector may omit live identity while disabled. Enabling it without every required live identity must fail closed.

## Isolation contract

DEV, UAT and Production must not share:

- Lark Base or destination tables
- Worker deployment/environment
- D1 database
- Queue or DLQ
- Secrets or OAuth tokens
- Checkpoints, resumable work, generation fences or locks
- Sync runs, alerts, dead letters or mirror outbox
- Schedule flags

Resources may live under the developer's Cloudflare account during UAT, but they must have customer-specific UAT names and bindings.

Recommended non-secret names:

```text
profile: uat_chemistry_k
worker: social-mkt-sync-worker-uat-chemistry-k
d1: social-mkt-state-uat-chemistry-k
queue: social-mkt-sync-jobs-uat-chemistry-k
dlq: social-mkt-sync-dlq-uat-chemistry-k
```

## Authorization and access

- The customer or an authorized customer administrator must sign in and authorize source accounts.
- The developer must not request or receive passwords, OTPs, session cookies or recovery codes.
- QR/login links must be opened or approved by the customer on the customer's device/session.
- UAT access must be least-privilege and limited to people involved in delivery and acceptance.
- Customer data must not be reused for another customer, public demo or model training without explicit authorization.

## Default safety state

- Every UAT connector is disabled by default.
- Every UAT schedule is disabled by default.
- Redrive is disabled by default.
- Production remains disabled.
- Live IDs, Table IDs and credentials stay out of Source.
- Migration/deploy/write actions require a separate approved task and guarded runbook.

## TikTok-first UAT gate

The first customer-real channel is TikTok through Lark Native Integration.

### Gate 1 — Customer authorization

The customer authorizes the correct TikTok account without sharing credentials.

### Gate 2 — Read-only identity preflight

Before destination writes, confirm:

- expected customer/account identity
- actual connected handle/account identity
- exact match or an explicitly approved identity mapping

Mismatch must fail closed.

### Gate 3 — Raw source-contract inspection

Inspect without destination writes:

- table and field contract
- total rows and unique video IDs
- duplicate IDs
- oldest/newest dates
- required-field gaps
- null versus zero semantics
- pagination/refresh behavior
- realistic record volume

### Gate 4 — Isolated UAT runtime preparation

Only after the read-only gate passes:

- create isolated UAT Cloudflare resources
- take backups before remote migrations
- apply approved migrations
- deploy with connectors/schedules disabled
- run validation/manual sync with explicit caps
- rerun for idempotency
- verify reconciliation, retry, lock, DLQ, alerts and reliability mirror
- enable schedules only after manual UAT acceptance

## Data retention and cutover

Before the first destination write, record:

- customer authorization and purpose
- who can access the UAT Base
- retention period
- export/return procedure
- deletion procedure after cutover or cancellation

Production cutover must use customer-owned Lark/Cloudflare resources. The code and Data Model stay the same; only environment bindings, non-secret mappings and secrets change. A later cutover task must decide whether to backfill Production from source or migrate approved UAT data, based on each API's historical limits and reconciliation evidence.

## Current authorization boundary

The customer-real UAT source/profile foundation may be implemented and tested in Source. No live TikTok connection, customer-data read, Lark mutation, Cloudflare resource creation, remote migration, deployment, Queue message or Production mutation is authorized by this document alone.
