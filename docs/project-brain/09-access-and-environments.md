# 09 — Access and Runtime Ownership

## Integration Workspace

The project has one pre-Production Workspace:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

`development` is a technical Cloudflare isolation label only. It is not a separate business stage from UAT.

Ownership:

- Lark Base, Worker, D1, Queue, DLQ and secret store: developer-owned current resources;
- target customer context: Chemistry K;
- source ownership: mixed per Connector;
- secrets: Environment/Secret Manager only;
- schedules: disabled until each connector passes manual validation.

## Per-Connector source ownership

Runtime readiness exposes:

- `sourceOwner`: `developer` or `customer`;
- `sourceRole`: `temporary_substitute` or `customer_real`;
- `replacementRequired`: whether the source must be replaced before final customer-data validation.

The profile remains `integration_workspace` while sources are replaced.

## Production

```text
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

Production resources, platform assets and secrets must be customer-owned. The developer is invited with least privilege.

## Replacement boundary

Before replacing a temporary source:

1. stop the connector and its schedules;
2. record source identity/checkpoint and backup/export;
3. clean rows only by exact platform/account/source scope;
4. replace credentials and source identifiers;
5. run full backfill, reconciliation and idempotent rerun;
6. verify no temporary rows or duplicate customer stable keys remain.

## Secret rules

- no tokens, passwords, API secrets, OTPs or session cookies in Git/Lark/logs;
- non-secret IDs and mappings may be source-controlled;
- customer login credentials are never collected;
- current developer secrets are not copied into customer-owned Production.

## Freelancer constraint

The user has no registered company. Customer-owned Production remains the default for Business Verification, Developer App ownership, OAuth consent, cloud resources and platform assets.
