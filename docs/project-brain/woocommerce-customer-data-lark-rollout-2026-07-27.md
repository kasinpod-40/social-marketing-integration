# Project Brain — WooCommerce Chemistry K Customer Data to Lark Rollout

## Decision

WooCommerce is not complete merely because runtime code was merged. The accepted completion target is:

```text
Chemistry K WooCommerce GET-only source
→ D1 durable commerce facts
→ Lark RAW and Canonical commerce tables
→ D1/Lark parity
→ idempotent rerun
→ incremental sync
```

## Existing reusable runtime

- WooCommerce REST client
- protected manual Queue route
- Shared Reliability and lock lifecycle
- resumable pagination and continuation Queue
- D1-first commerce writer
- derived commerce facts
- Coverage runs/entities
- existing Lark repository and sync engine
- 14 logical Lark table mappings

No replacement runtime engine is authorized.

## Current gap

Remote truth is unresolved because older WooCommerce closeout recorded Migration `0017` as source-only,
while later Chatwoot records stated it was applied outside that workstream. A read-only evidence chain must
resolve the ledger and schema before any backup, migration, deploy, Queue send or customer-data write.

## Read-only operator

The new operator validates:

- exact current reviewed Git head and clean worktree;
- Integration Workspace / Chemistry K / Worker / D1 identity;
- exact additive Migration `0017` source: 17 tables and 13 indexes;
- pending migration set is either empty or exactly `0017`;
- zero active work and locks;
- schema/ledger parity;
- WooCommerce GET-only access using store, orders, products and customers samples;
- exact 14 unique Lark table IDs and non-empty field metadata;
- no credential values, provider records or customer PII in evidence.

## Next decisions

- `pending_0017_only` → separate Backup then Migration apply authorization.
- `applied_or_no_pending` with exact schema → guarded manual D1 + Lark backfill implementation.

This record authorizes no Remote mutation.
