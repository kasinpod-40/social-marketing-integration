# YouTube Lark Full-Sync UAT Operator

## Purpose

Repopulate the Integration Workspace Lark Base after the user manually removed old YouTube DEV/test records, using the existing YouTube source, D1-first storage, Shared Reliability and TableSyncEngine path.

## Runtime identity

```text
environment      development
profile          integration_workspace
customer         chemistry_k
account          dev_ft_pumkin
channel          UCAwEENovvqZWosKhJWTS5Kg
job type         youtube.channel.organic.sync
trigger          youtube_lark_full_sync_uat
sync mode        full
dry run          false
analytics        false
```

The trigger has its own stable Queue-operation contract. Both the initial send and same-operation rerun resolve to:

```text
operationId      operator-selected safe identifier
workKey          youtube:<operationId>
syncRunId        youtube-lark-uat:<operationId>
generation       originalRequestedAt
```

Cloudflare delivery message IDs do not define durable business identity.

## Approved active flags

```text
MKT_CONNECTOR_YOUTUBE_ENABLED=true
MKT_YOUTUBE_END_TO_END_ENABLED=true
MKT_TIME_SERIES_D1_WRITE_ENABLED=true
MKT_YOUTUBE_LARK_WRITE_ENABLED=true
```

Every other `MKT_*_ENABLED` binding is false, including Owner Analytics and YouTube Schedule.

## Phase model

```text
plan
lark-preflight
remote-preflight
backup
deploy-active
verify-active
snapshot-before
send-full-sync
verify-full-sync
resend-same-operation
verify-idempotent-rerun
restore-all-false
verify-restore
summary
```

Each executable phase requires a distinct exact confirmation token. Deployment and Queue attempt evidence is persisted before the remote command so automatic repetition is blocked after an ambiguous interruption.

## Lark acceptance

Positive YouTube-scoped counts are required after the first run in:

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
MKT_Accounts
MKT_Content
MKT_Content_Daily
```

`RAW_YouTube_Analytics_Daily` may remain zero because Owner Analytics is deliberately disabled. `MKT_Sync_Log` and `MKT_System_Alerts` remain operational tables and are not deleted or used as positive business-count gates.

## Idempotency acceptance

The exact same stable operation is sent once more. Verification requires:

- a second Queue admission attempt;
- unchanged scoped Lark counts;
- unchanged operation-scoped D1 business counts;
- no active lock;
- no DLQ admission;
- terminal success and completed durable work.

## Safety

The operator never applies migrations, deletes Lark records, changes Lark schema, activates schedules, enables Analytics/OAuth, redrives DLQ work or permits Production. A D1 export is required before enabling write gates, and the Worker must be restored to all-false and verified before summary acceptance.

Repository implementation and CI authorize no remote execution. Merge and live phases require separate explicit authorization.
