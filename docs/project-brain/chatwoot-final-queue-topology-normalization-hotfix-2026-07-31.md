# Project Brain — Chatwoot Final Queue Topology Normalization Hotfix

## Decision

Chatwoot Final UAT must use the existing shared WooCommerce Queue consumer topology normalizer. Wrangler's current output uses `batch_size` and `max_wait_time_ms`; legacy output may use `max_batch_size` and `max_batch_timeout`. Both are valid only when they resolve to the same exact reviewed topology.

## Incident boundary

The failed attempt stopped during read-only Queue topology inspection before D1 backup and before any Active Worker deployment. `safeRestore=NOT_REQUIRED` is authoritative. Queue submission, Provider access and D1/Lark Business mutation counts are zero.

## Shared authority

```text
wrangler queues consumer list --json
→ extract bounded consumer array
→ assertWooCommerceQueueConsumerTopology
→ resolve modern/legacy aliases
→ exact topology comparison
→ continue read-only preflight
```

Modern `max_wait_time_ms` must divide evenly by 1000. Conflicting aliases, missing fields, duplicate consumers or topology drift remain fail-closed.

## Safety

```text
Remote Provider request       0 during hotfix
Remote D1/Lark action         0 during hotfix
Queue/DLQ message             0 during hotfix
Worker deployment             0 during hotfix
Schedule/Webhook              disabled
Production                    blocked
```
