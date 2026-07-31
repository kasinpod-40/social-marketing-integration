# Lark Dashboard Full-Config Recovery v2

## Incident

The first canonical Dashboard rebind attempt passed read-only permission checks, entered
`apply-dashboard-rebind`, and then stopped with Lark HTTP 200 / business `code: 1`.

Because the failure occurred inside the per-Block mutation loop, the previous operator cannot claim
that Remote mutation count was zero. Some earlier Blocks may already be canonical while the failed
Block may be unchanged.

## Root cause

The original operator treated `data_config` as if Lark merged nested properties. It sent only the
changed top-level fragment, commonly only `filter`, which omitted required chart properties such as
`table_name`, `series`, `group_by`, measures and type-specific settings.

Lark PATCH is partial at the Block resource level, but `data_config` is one complete Block property.
The recovery therefore sends the full rewritten `data_config` object.

The previous scope contract also omitted `base:block:update`. Dashboard metadata update and Dashboard
Block update are separate capabilities. Recovery v2 requires:

- `base:dashboard:read`
- `base:dashboard:update`
- `base:block:update`
- `base:field:delete`

## Recovery contract

Recovery v2:

1. reads the current six Dashboards and every relevant Block;
2. rebuilds the plan from current Remote state, so previously converged Blocks are skipped;
3. re-reads each Block immediately before mutation;
4. sends the complete canonical `data_config` with no automatic write retry;
5. reads the Block back after every PATCH, including after an API error;
6. classifies the result as `target_converged`, `rejected_unchanged`, or `state_drift`;
7. writes a private checkpoint before and after each Block;
8. verifies all bindings and Organic computed data before deleting any Legacy field;
9. deletes only the four reviewed Legacy fields, with readback after each delete;
10. preserves Dashboard IDs, Block IDs, layout and every Report record, including the 24
    baseline-incomplete N/A records.

## Safety

- No Queue send, D1 write, Worker deployment, Schedule/AI activation or Production action.
- No Record deletion or Business-fact mutation.
- Legacy fields are not deleted unless all Dashboard Blocks converge and computed-data verification
  passes.
- On interruption, rerun is not automatic; retained checkpoints and current Remote state determine the
  next safe action.

## Expected completion

```text
LARK_DASHBOARD_CANONICAL_REBIND_RECOVERY_COMPLETED_SAFE
remainingLegacyFieldCount      0
remainingLegacyReferenceCount  0
layoutMutationCount            0
recordDeleteCount               0
fullDataConfigWrite             true
```
