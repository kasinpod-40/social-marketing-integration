# Report Metric Migration Growth Boundary

Current verified architecture rule:

- Report Metric field migration must never fail solely because `MKT_Report_Metric_Values` contains more business records than a hard-coded total-table threshold.
- Total customer/business table size is not a migration admission contract.
- Read-only ownership and convergence checks operate across the complete paginated table.
- Actual canonical value writes are bounded per request/batch only.
- Source record count and SHA-256 source fingerprint remain immutable during a real migration; drift fails closed.
- Legacy values are preserved and deletes remain forbidden.
- A partial multi-batch migration is resumable from the existing canonical/legacy state.

The rule was introduced after the post-PR #523 Finalizer saw 642 Report Metric records and was blocked by the historical `MAX_RECORDS=500` guard even though no migration was pending.

Implementation authority:

```text
PR #525
branch fix/metric-migration-record-bound-v1
base main@33bbb142b5a74584628e5236bc9b838d662b6003
```

Live Finalizer and Chatwoot incident continuation remain separate post-merge actions under new immutable evidence roots.
