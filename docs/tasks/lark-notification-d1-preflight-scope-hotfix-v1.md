# Lark Notification D1 Preflight Scope Hotfix v1

Date: 2026-08-04

## Incident

The read-only Notification Remote preflight stopped before any Remote command because the rollout validator required `LARK_TABLE_MKT_NOTIFICATION_LOG` even though all notification runtime flags were false and the current phases are limited to D1 preflight, backup, Migration 0019 and schema read-back.

The Lark Notification Log table already exists in the Integration Workspace. Its runtime Table mapping is needed only when a later separately approved Worker deployment enables the notification Runtime or Lark mirror. It is not an input to the current D1-only phases.

## Root cause

The rollout operator duplicated a later Worker/UAT prerequisite inside the D1 migration gate. This made preflight depend on four Lark Table IDs that the central notification Runtime contract intentionally does not require while `MKT_NOTIFICATION_RUNTIME_ENABLED=false`.

## Fix

- reuse `readLarkNotificationRuntimeConfig` as the all-false Runtime authority;
- keep all three notification flags false across Wrangler and Environment sources;
- require only the existing Integration Workspace Worker name, D1 binding, Queue and DLQ topology for the D1-only phases;
- defer all four Lark Table mappings to the separate safe Worker deploy or controlled UAT gate;
- bind that explicit deferral policy—not fabricated Table IDs—into the retained target fingerprint;
- preserve the existing Migration source audit, Remote active-work/lock check, backup hash, evidence chain and zero-drift schema read-back.

## Regression coverage

- all mappings absent passes the D1-only config gate;
- unrelated or empty mapping values do not alter the D1-only target fingerprint;
- every explicit true notification flag still fails closed from Wrangler or Environment;
- no deploy, Queue send, Lark request, message send, Automation activation or Schedule path is added.

## Safety

```text
Remote D1 read/write       0 / 0
Migration apply            0
Worker deployment          0
Queue send                 0
Lark read/write            0 / 0
Notification send          0
Automation active          0
Schedule                   disabled
Production                 BLOCKED
```
