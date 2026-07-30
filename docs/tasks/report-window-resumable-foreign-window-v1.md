# Report Window Repair — Resumable Foreign-Window Guard v1

## Incident

Organic Dashboard window repair completed Report schema/settings finalization on clean
`main@bd9dc52a5f49a1964af5cb248754ed40e6080f61`, including lossless migration of
`display_name` and `window_days`, then stopped before the first 3D materialization because the
Remote Worker still exposed the exact WooCommerce Final manual-UAT window:

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=true
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=true
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=true
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=true
```

The Report operator correctly expected all execution flags false and returned
`REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_MISMATCH`. The failure occurred before D1 backup, active
Report deployment, Queue send, Report D1 materialization or Report Lark write.

## Root-cause decision

This is an inter-workstream ownership conflict, not a Report schema failure. The four observed
flags belong to the reviewed WooCommerce Final ingestion window. Report repair must never deploy
its all-false or Report-only config over that window without the WooCommerce operator first proving
its own completion and safe closeout.

The original one-command wrapper also had no durable local resume contract: rerunning always
executed Finalizer again and did not distinguish a completed window from a partially attempted
window.

## Correction

- Reuse Finalizer evidence only when it passes the full Finalizer contract and belongs to the exact
  current repository Head.
- Require completed Metric field migration evidence to have pending=0, legacy mutation=0 and
  delete=0.
- Reuse a completed Report window only when its summary proves:
  - expected operation/window and decision;
  - one D1 materialization row before and after replay;
  - same report ID and payload checksum on replay;
  - unchanged Lark rows and D1/Lark integrity;
  - verified all-false restore with connector, AI, schedules and Production disabled.
- If a window directory has any Attempt, Backup or other evidence but no valid summary, fail closed
  with `REPORT_RUNTIME_WINDOW_REPAIR_PARTIAL_WINDOW_BLOCKED`; never repeat Deploy or Queue send.
- Never override a foreign active execution window automatically. WooCommerce remains responsible
  for its own safe closeout.

## Current live-state interpretation

```text
Report finalizer                    COMPLETE
Lark Metric migration              2/2 CONVERGED
Legacy value mutation              0
Delete count                       0
Report 3D backup/deploy/queue       NOT STARTED
Report 7D/1D/30D                    NOT STARTED
Remote active window owner         WOOCOMMERCE_FINAL
Report Production                  BLOCKED
```

After this hotfix is merged, a rerun on the same Head reuses successful Finalizer/window summaries.
A Head change still requires Finalizer to run again because Repository gates are Head-bound.

## Safety

Repository implementation and CI perform no Live Lark/D1 mutation, Worker deployment, Queue/DLQ
send, Provider request, Schedule/AI activation or Production action.
