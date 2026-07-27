# YouTube Shared-Worker Remote Fingerprint Scope Hotfix

## Objective

Make the YouTube Remote read-only preflight compare the exact YouTube contract on the shared Worker without
mistaking unrelated connector Secret names or omitted effective-false bindings for YouTube drift.

## Incident

The preflight authenticated, read the Remote Worker, Queue, Trigger and D1 migration metadata, normalized
the current Cloudflare Queue timeout field, and then stopped with:

```text
YOUTUBE_DRY_RUN_REMOTE_FINGERPRINT_MISMATCH
```

No Remote mutation, Provider request, Queue message, D1 write, Lark request or Worker deployment occurred.

## In scope

- shared Cloudflare Queue response normalization;
- exact required YouTube Secret-name subset validation;
- missing/duplicate/exposed Secret fail-closed behavior;
- exclusion of unrelated connector Secret names from only the YouTube fingerprint input;
- reviewed omitted-false flag materialization;
- explicit true/invalid/duplicate flag fail-closed behavior;
- sanitized mismatch diagnostics;
- focused and full Repository regression coverage.

## Out of scope

- Worker deployment or rollback;
- Queue/DLQ message or configuration mutation;
- Remote D1 query beyond the existing migration-list read, write or migration apply;
- YouTube Provider or Lark request;
- Secret creation, deletion or rotation;
- Cron, route or workers.dev mutation;
- Schedule activation or Production.

## Contract

The Worker may contain additional Secret bindings for other connectors, but must contain exactly one binding
for each required YouTube Secret name:

```text
LARK_APP_ID
LARK_APP_SECRET
YOUTUBE_API_KEY
```

The YouTube fingerprint uses only that required subset. Secret values remain forbidden in Wrangler version
output and evidence.

For reviewed flags, a binding omitted from live version metadata may be materialized as `false` only when its
name comes from the reviewed safe/active local comparison. Explicit values are never overwritten. Explicit
`true`, invalid Boolean text and duplicate bindings remain hard failures or deterministic fingerprint drift.

All existing D1 UUID, resource binding, Queue topology, Cron, route, workers.dev, traffic and unexpected-true
checks remain authoritative.

## Acceptance tests

- current Queue API fields normalize through the shared module;
- omitted reviewed false flags reproduce the reviewed safe fingerprint;
- unrelated connector Secrets do not alter the YouTube fingerprint;
- missing, duplicate or exposed required Secrets fail closed;
- explicit true, invalid or duplicate reviewed flag bindings fail closed;
- the executable preflight passes the reviewed expected-false names into the compatibility adapter;
- failure output contains only allowlisted sanitized diagnostics;
- all standard Repository gates pass.
