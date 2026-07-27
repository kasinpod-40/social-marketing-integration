# Project Brain — Chatwoot Remote Readiness Implementation

## Status

```text
Repository implementation in progress
Remote execution not authorized
```

Branch `integration/chatwoot-remote-preflight` starts from `main@f3e330339b114536c3a1a9ee7567abf5a76fa78b`
after Chatwoot Runtime Wiring PR #97 and merge-closeout PR #108 were merged.

This work adds a guarded plan-only-by-default operator for:

```text
plan
→ preflight
→ backup
→ migrate
→ schema-readback
```

The operator locks the Integration Workspace, exact D1 database and Migration `0018`, validates all
execution gates false, requires zero active Work/Locks, checksum-binds the backup and requires 14
tables, 15 indexes, zero Chatwoot rows and Shared count parity after Migration.

The operator intentionally has no Chatwoot Provider request, Token read, Lark mutation, Queue/DLQ,
Worker deployment, Schedule/Webhook or Production path. This Repository implementation performs no
Remote phase.
