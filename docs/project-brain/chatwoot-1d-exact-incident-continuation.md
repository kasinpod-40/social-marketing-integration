# Chatwoot 1D Exact Incident Continuation

## Current authority

The reviewed Chatwoot 1D Report incident is a failed-before-write Runtime incident, not missing Source data.

```text
Source Coverage        complete
Conversation facts     200
Account facts          42
Report materialization 0
Lark Snapshot/Metrics  0/0
Open Report DLQ/Alert  1/1
Work/Lock              0/0
Worker baseline        notification-only / verified
Production             BLOCKED
```

The failed Sync Run is bound to:

```text
sync_run_id = 1c7a20b3-5bb7-45a3-b591-b71e392a02b6
error       = Unsupported Dashboard metric scope: period_end_snapshot
```

PR #522 corrected the Shared contract by mapping Account period-end snapshot metrics to canonical `current_total`. The existing Dashboard/Lark scope options remain `period_delta`, `current_total`, `data_quality`.

## Continuation decision

Use one exact incident continuation operator. Do not rerun the failed multiwindow root and do not use generic DLQ redrive.

The continuation may close the retained DLQ and Alert only after proving:

```text
D1 materialization 1
Lark Snapshot      1
Lark Metrics       139
Top Content/Ads    0/0
Duplicate Metrics  0
D1/Lark integrity  exact
Worker baseline    restored and verified
```

## Operational boundaries

- one exact Queue send for the original 1D job;
- no replay inside the incident continuation;
- progress output every approximately 30 seconds;
- immediate failure on a new failed Sync Run or exact DLQ;
- any started evidence root is immutable;
- Chatwoot 3D/7D/30D remain a separate post-incident closeout;
- WooCommerce remains closed and must not be touched;
- Notification Admission, AI, Schedule and Production remain disabled/blocked.
