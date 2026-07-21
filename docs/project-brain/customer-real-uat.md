# Customer-real UAT Contract

## Purpose

Customer-real UAT uses real customer-owned accounts and customer data to validate production-scale behavior before customer-owned Production infrastructure is ready. It is not sample, sandbox or demo data.

## Ownership matrix

| Layer | DEV | Customer-real UAT | Production |
| --- | --- | --- | --- |
| Source accounts and data | Developer | Customer | Customer |
| Lark Base | Developer | Developer, temporary | Customer |
| Cloudflare Worker/D1/Queue/DLQ | Developer | Developer, isolated | Customer |
| Runtime profile | `dev_ft_pumkin` | `uat_chemistry_k` | `chemistry_k` |
| Canonical customer/account identity | DEV-specific | `chemistry_k` | `chemistry_k` |

The temporary UAT infrastructure does not transfer ownership of connected accounts or data away from the customer.

## Identity and stable-key contract

- `profileKey` identifies an environment configuration and may differ between UAT and Production.
- `customerKey` and connector `accountKey` identify business data and must remain `chemistry_k` across UAT and Production.
- Never prefix Canonical business identity with `uat_`.
- `accountKey` is required even while a connector is disabled.
- A live source identity such as TikTok handle may remain absent while disabled, but enabling the connector without it must fail closed.
- Live identities must come from approved Environment configuration after customer authorization and exact identity verification.

## Isolation contract

DEV, UAT and Production must not share:

- Lark Base or destination tables
- Worker deployment/environment
- D1 database
- Queue or DLQ
- authentication secrets
- checkpoints, resumable work, generation fences or locks
- sync runs, alerts, dead letters or mirror outbox
- business schedule flags

Recommended non-secret UAT names:

```text
profile: uat_chemistry_k
worker: social-mkt-sync-worker-uat-chemistry-k
d1: social-mkt-state-uat-chemistry-k
queue: social-mkt-sync-jobs-uat-chemistry-k
dlq: social-mkt-sync-dlq-uat-chemistry-k
```

## Authorization and access

- The customer or an authorized customer administrator signs in and authorizes the source account.
- The customer completes authentication on the customer's device or session.
- The developer does not collect customer login credentials.
- UAT access is least-privilege and limited to people involved in delivery and acceptance.
- Customer data is not reused for another customer or a public demo without explicit authorization.

## Default safety state

- Every UAT connector is disabled by default.
- Every UAT business schedule is disabled until its channel gate passes.
- Redrive is disabled by default.
- Production remains disabled.
- Live identities, Table IDs and authentication secrets stay outside Source.
- Migration, deployment and write actions require a separate approved task and guarded runbook.
- A bounded system-recovery job may be configured only with the isolated UAT runtime. It must not write customer business data when no durable recovery work exists.

## TikTok-first UAT gate

The first customer-real channel is TikTok through Lark Native Integration.

### Gate 1 — Customer authorization

The customer authorizes the intended TikTok account without transferring login access to the developer.

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
- oldest and newest dates
- required-field gaps
- null versus zero semantics
- pagination and refresh behavior
- realistic record volume

### Gate 4 — Isolated UAT runtime preparation

Only after the read-only gate passes:

- create isolated UAT Cloudflare resources
- take backups before remote migrations
- apply approved migrations
- deploy with connectors and business schedules disabled
- allow only the bounded recovery route required by the approved runtime contract
- run validation and manual sync with explicit caps
- rerun for idempotency
- verify reconciliation, retry, lock, DLQ, alerts and reliability mirror
- enable business schedules only after manual UAT acceptance

## Data retention and cutover

Before the first destination write, record customer authorization, access scope, retention period, export procedure and deletion procedure.

Production cutover must use customer-owned Lark and Cloudflare resources. Code and Data Model remain the same; environment bindings, non-secret mappings and secrets change. A later cutover task decides whether Production backfills from source or migrates approved UAT data based on historical API limits and reconciliation evidence.

## Current authorization boundary

This document authorizes only Source/profile foundation work and automated tests. It does not authorize a live TikTok connection, customer-data read, Lark mutation, Cloudflare resource creation, remote migration, deployment, Queue message or Production mutation.
