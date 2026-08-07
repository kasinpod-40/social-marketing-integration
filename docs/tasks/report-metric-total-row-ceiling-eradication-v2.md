# Report Metric Total-Row Ceiling Eradication v2

## Incident

PR #525 removed the total-table row ceiling from the base Report Metric field migration, but the real Finalizer entrypoint imports recovery v4. The next exact-main Finalizer on `main@91792d0d2e31af1774746ad24c58f1462fa2672e` therefore stopped safely again at migration preview:

```text
recordCount            642
fieldName              display_name
maxRecords             500
migrationCount         0
pendingMigrationCount  0
```

No schema apply, Remote D1/Lark mutation, Queue send or Worker deployment occurred.

The failed evidence root is immutable:

```text
outputs/chatwoot-post-525-91792d0d
```

## Exact root cause

The executable chain is:

```text
migrate-report-metric-value-field-types.mjs
→ recovery-v4
→ recovery-v3
→ recovery-v2
→ base migration
```

Historical total-table guards remained in recovery v2, v3 and v4. The Dashboard Compatibility Freeze also retained a separate 2,000-row ceiling that would create the same customer-growth failure later.

## Correction

Remove total business-table row-count admission from every executable layer:

- base migration remains growth-safe from PR #525;
- recovery v2: no total-row ceiling;
- recovery v3: no total-row ceiling;
- recovery v4: no total-row ceiling;
- Dashboard Compatibility Freeze: no total-row ceiling.

Do not add another migration/batching framework. `LarkBitableClient.listRecords()` already paginates the complete table, and `batchUpdateRecords()` already chunks writes into bounded requests with partial-write progress handling.

## Permanent safety boundary

```text
customer/business row ceiling   none
read boundary                   shared paginated Lark reader
write boundary                  shared Lark batch request chunks
source drift                    fail closed by record count/fingerprint
legacy mutation/delete          forbidden
Dashboard identity/parity       still exact/fail closed
```

Table growth itself is never an error condition.

## Regression

- Compatibility Freeze accepts 2,501 exact compatible records.
- The exact recovery-v4 path used by the Finalizer accepts 2,501 exact compatible records with pending migration 0 and Remote mutation 0.
- Static source audit rejects reintroduction of the historical migration/compatibility row-bound constants and blocker codes.
- Existing v2/v3/v4 migration, archive, parity, conflict and value-preservation regressions remain required.

## Operational boundary

Repository implementation and CI perform no Remote action. The failed Finalizer roots remain immutable. After merge, run a new exact-main Finalizer under a new evidence root. Chatwoot 1D exact incident continuation remains blocked until that Finalizer succeeds.
