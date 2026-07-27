# Project Brain — Chatwoot Lark Metadata Readiness

## Durable decision

Chatwoot Provider identity is validated for Chemistry K Account `1`, but Account Reporting Events remains
blocked because the Token owner is Profile ID `14` with role `agent`. The Provider permission gap does not
block Repository-only Lark metadata and mapping readiness.

The authoritative Chatwoot Lark contract contains 15 sinks derived from the current normalized write set.
It must not be reconstructed from D1 column names alone. In particular, the Lark Conversation projection
uses `reopen_count_delta`, while D1 preserves accumulated `reopen_count`.

The guarded metadata operator is plan-only by default and may later perform only Lark Table/Field metadata
reads under exact confirmation. It persists fingerprints, counts, contract names and additive actions only;
raw Table IDs, credentials, PII, record values and raw metadata payloads remain excluded.

## Accepted decisions

```text
PASS_CHATWOOT_LARK_METADATA_READY
CHATWOOT_LARK_ADDITIVE_PLAN_REQUIRED
CHATWOOT_LARK_TYPE_MISMATCH_BLOCKED
CHATWOOT_LARK_TABLE_AMBIGUOUS_BLOCKED
```

Only `bind_table_env`, `create_table` and `create_field` are valid additive-plan actions. Any rename,
delete, primary-key conversion or Field-type mutation remains blocked and requires a separate design
review rather than automatic repair.

## Boundary

This Repository work does not access the Chatwoot Token, call the Provider, read Lark records, mutate
Lark, touch Remote D1, send Queue messages, deploy the Worker, enable Schedule/Webhook or authorize
Production.
