# Report Metric Total-Row Ceiling Eradication

Current verified architecture rule:

- Customer/business table size is never an admission gate for Report Metric migration or Dashboard Compatibility Freeze.
- The executable Finalizer chain includes recovery v4, v3, v2 and the base migration; growth safety must hold across every layer, not only the base module.
- Full-table reads use the shared paginated Lark client.
- Record writes use the existing `LarkBitableClient.batchUpdateRecords()` request chunking and partial-write progress handling; no duplicate batching framework is added.
- Exact Field identity, Number/Select parity, canonical/Legacy value checks, source fingerprints and record-count drift checks remain fail closed.
- Legacy fields/values and Business facts remain immutable; delete remains forbidden.

This rule was hardened after the post-PR #525 Finalizer on `main@91792d0d2e31af1774746ad24c58f1462fa2672e` exposed a remaining `MAX_RECORDS=500` guard in recovery v4 at 642 records, despite zero pending migration.

Both failed Finalizer roots are immutable and must not be reused:

```text
outputs/chatwoot-post-523-33bbb142
outputs/chatwoot-post-525-91792d0d
```

Chatwoot 1D incident continuation remains blocked until a new exact-main Finalizer succeeds after this correction is merged.
