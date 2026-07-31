# Project Brain — Chatwoot Final Lark Auto-Mapping Hotfix

## Decision

The Chatwoot Final UAT public command remains unchanged. Before delegating to the merged Final UAT
operator, the Launcher now resolves all 15 Chatwoot Lark Table IDs through the existing read-only
metadata-discovery contract.

## Incident boundary

The first execution stopped at local config validation because `LARK_TABLE_RAW_CHATWOOT_ACCOUNTS`
was absent. `safeRestore=NOT_REQUIRED` proves the Active deployment window was never entered.
Provider, D1, Lark record, Queue and Worker mutation counts remained zero.

## Mapping authority

```text
CHATWOOT_LARK_BLUEPRINT
→ exact logical names + approved emoji aliases
→ Lark listTables read-only inventory
→ discoverChatwootLarkTables
→ exactly 15 unique bindings
→ private generated config only
```

Configured IDs are accepted only when the remote table name matches the reviewed alias. Missing IDs
are discovered by alias. Stale configured IDs are repaired in the generated config only. Multiple alias
matches, missing tables or configured IDs pointing at the wrong table identity fail closed.

## Privacy and evidence

Raw Table IDs are required by Wrangler Runtime bindings but are not Secret values and still must not be
printed or placed in public evidence. They exist only inside the permission-restricted ignored generated
config, which is removed after execution. Error output contains logical table keys and counts only.

## Final sequence

```text
plan-only guard
→ read-only Lark table discovery
→ private config normalization
→ exact Shared lock preflight
→ existing Final UAT sequence
→ automatic all-flags-false restore
→ exact Shared lock closeout
→ generated config deletion
```

## Final user action after merge

```bash
CONFIRM_CHATWOOT_FINAL_UAT=EXECUTE_CHATWOOT_30D_DAILY_UAT \
node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute
```

No manual Lark Table-ID copy is part of the operating procedure.

## Safety state during implementation

```text
Remote Provider request       0
Remote D1 query/write         0
Remote Lark request/mutation  0
Queue/DLQ message             0
Worker deployment             0
Schedule/Webhook              disabled
Production                    blocked
```
