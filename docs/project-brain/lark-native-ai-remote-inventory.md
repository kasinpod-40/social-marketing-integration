# Project Brain — Lark Native AI Remote Inventory

## Purpose

Read the current Integration Workspace Lark Base metadata needed by the merged all-channel AI schema planner without reading Records or exposing any mutation path.

## Current authority

```text
Phase 1 merged main   fffa218e2ab12235883b624793dfb53673a5a2c4
Target table          🧠 MKT_AI_Report_Runs
Remote execution      not run
Schema Apply          not authorized
```

The collector is subordinate to:

```text
packages/config/src/lark-native-ai-schema-preview.js
```

It cannot decide to rename, delete, mutate types, remove options or apply schema.

## Read-only network contract

Allowed requests:

```text
POST tenant_access_token authentication
GET tables metadata
GET target Fields metadata
GET target Views metadata
```

All other paths and methods are blocked before network. Record reads are forbidden.

## Repository execution gate

A Remote run requires:

```text
main
clean working tree
HEAD equals exact reviewed SHA
explicit confirmation value
```

## Evidence policy

Persist only sanitized names, canonical Field types, Select option names, View names, deterministic inventory checksum, Base-token hash, planner result and request counters.

Never persist credentials, access tokens, Table/Field/View IDs, Record data, raw URLs, request bodies or headers.

## Target identity behavior

- zero or duplicate exact target Tables stop detailed metadata reads;
- one exact target permits Field and View reads;
- unsupported Field types fail closed;
- missing Select option metadata remains unknown and blocks option planning;
- existing metadata is never interpreted as permission to Apply.

## Safety

```text
Remote Lark write       0
Record read             0
Lark Native AI call     0
Automation              0
Notification send       0
D1/Queue/Worker/Provider 0
Production              BLOCKED
```

Full task contract:

```text
docs/tasks/lark-native-ai-remote-inventory-v1.md
```
