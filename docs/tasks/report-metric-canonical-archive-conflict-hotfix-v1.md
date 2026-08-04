# Report Metric Canonical Archive Conflict Hotfix v1

## Incident

Report Run All stopped safely during the current-main Report Finalizer preview:

```text
main                                   70d8a8c5b8fe313b55b36ef07f0dc36877e714c1
stage                                  report-metric-value-field-migration-preview
code                                   REPORT_RUNTIME_FINALIZE_METRIC_FIELD_MIGRATION_UNSAFE
blocker                                REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT
table                                  MKT_Report_Metric_Values
field                                  display_name
record_count                           86
archived_source_field_count            2
Report materialization                 not started
Queue / Worker / D1 Report write       0 / 0 / 0
```

## Root cause

The existing recovery correctly declares canonical Text `display_name` authoritative after the deterministic Legacy archive exists. However, its inspection compared both archived SingleSelect fields before reading the canonical cell. Historical archive values from two migration generations can differ even when the current canonical Text is already populated and authoritative.

This produced a false blocker for records that require no mutation.

## Exact correction

The existing shared recovery module is corrected in place. No wrapper, loader, source rewrite or channel-specific finalizer is added.

Per record:

- canonical Text populated + archived values conflict: accept canonical as authority, retain every archive value unchanged and record a sanitized conflict count;
- canonical Text missing + archived values conflict: continue to fail closed before mutation;
- canonical Text missing + exactly one archived value: retain the existing bounded backfill behavior;
- canonical Text populated + archive divergence: retain the existing canonical-authority behavior.

Every archived field fingerprint remains immutable across Apply. Delete count and Legacy value mutation count remain zero.

## Regression

- canonical-present conflict converges with zero mutation;
- canonical-missing conflict remains blocked;
- existing canonical divergence, canonical-only and bounded backfill tests remain active;
- evidence exposes counts only and never physical IDs or Business values.

## Safety

```text
Remote execution in implementation    0
Lark write in implementation          0
D1 / Queue / Worker action             0 / 0 / 0
Schedule                               disabled
Production                             blocked
```

After exact-head CI and merge, rerun the original Report Run All command from a clean updated `main`. Do not manually edit either archived field and do not bypass the Finalizer.
