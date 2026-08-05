# Dashboard Compatibility Record Bound v1

## Trigger

The exact WooCommerce 1D Lark-incomplete recovery completed successfully on the merged Report schema/recovery baseline:

```text
Current Report Metric records   410
WooCommerce 1D                  58 rows / recovered
WooCommerce remaining windows   3 × 58 = 174 rows
Chatwoot per window              19 summary + 120 fixed-rank = 139 rows
Chatwoot four windows            556 rows
Expected completed footprint     1,140 rows
```

The permanent Dashboard Compatibility Freeze still used the original pre-multichannel bound of `500` Report Metric records. Completing WooCommerce alone would increase the table to at least `584`, causing future Finalizer/compatibility admission to fail even when every physical Field identity and Number/Select value remained correct.

## Root cause

The `500` bound was introduced when the live Report Metric table contained only the original bounded dashboard set. It was not updated when the reviewed WooCommerce and Chatwoot fixed-rank contracts were merged.

This is an admission-capacity defect in the existing Compatibility Freeze, not a Dashboard block, Lark schema, Report writer, Stable-key, D1 materialization or Queue defect.

## Correction

- retain the existing read-only Compatibility Freeze inspector;
- retain exact physical Field ID/name/type/Primary checks;
- retain exact `1 / 3 / 7 / 30` Number/Select parity;
- increase only the bounded Report Metric record ceiling from `500` to `2,000`;
- verify the expected full WooCommerce + Chatwoot footprint of `1,140` records is admitted;
- verify `2,001` records still fail closed with `REPORT_METRIC_COMPATIBILITY_FREEZE_RECORD_BOUND_EXCEEDED`;
- do not add a new Dashboard inspector, schema engine, pagination wrapper or mutation path.

## Safety

```text
Repository implementation only
Remote Lark mutation       0
Remote D1 mutation         0
Queue/DLQ action           0
Worker deployment          0
Provider request           0
Schedule                   false
Production                 BLOCKED
```

## Post-merge sequence

1. synchronize exact clean merged `main`;
2. rerun the current-head Report Runtime Finalizer because the Repository Head changed;
3. run fresh SELECT-only readiness for every non-planned reviewed channel;
4. build a new exact-head retained multichannel handoff;
5. close WooCommerce 3D/7D/30D while reusing the recovered 1D window;
6. require WooCommerce post-readiness before starting Chatwoot;
7. close Chatwoot 1D/3D/7D/30D;
8. run the Compatibility Freeze readback and require full record parity.

The original WooCommerce failed multiwindow root and the completed 1D recovery root remain non-repeatable.
