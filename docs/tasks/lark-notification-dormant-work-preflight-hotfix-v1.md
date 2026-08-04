# Lark Notification Dormant Work Preflight Hotfix v1

Date: 2026-08-04

## Incident

The Notification Migration 0019 read-only preflight found two retained Meta Ads Work rows with `lifecycle_status=active` and no active lock:

- the retained Chemistry K2 May–July page-limit forensic Work;
- the retained Chemistry K3 July partial-staging recovery Work.

Both are owned by the existing Meta recovery workstream and must remain unchanged. Neither is proof of a currently executing Worker invocation. The exact runtime authority for concurrent execution is a non-expired `sync_locks` row.

## Root cause

The Notification rollout operator treated every retained active Work row as an active execution and required `active_work=0`. That forced unrelated additive Migration work to wait indefinitely or tempted an unsafe lifecycle rewrite.

## Fix

- preserve every retained active Work row exactly;
- block on any non-expired `sync_locks` row;
- require the active Work count and Shared Business fact counts to remain unchanged before backup and immediately before Migration apply;
- require the same retained Work count after schema read-back;
- keep Migration 0019 additive-only and verify the new delivery table is empty;
- do not whitelist, close, update, delete, redrive or relabel either Meta Work row;
- reuse the existing D1, Migration, evidence, backup and all-false Runtime paths.

## Safety

```text
Meta Work lifecycle mutation  0
Meta Queue send               0
Meta Provider call            0
Remote D1 mutation            0 during implementation
Migration apply               0 during implementation
Worker deployment             0
Lark write                    0
Notification send             0
Automation active             0
Schedule                      disabled
Production                    BLOCKED
```
