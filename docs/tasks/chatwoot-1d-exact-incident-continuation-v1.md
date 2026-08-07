# Chatwoot 1D Exact Report Incident Continuation v1

## Incident

The first reviewed Chatwoot 1D Report Queue delivery failed before any D1/Lark Report write:

```text
REPORT_ID              = integration_workspace:chatwoot:rolling:1d:chemistry_k:rolling_days:2026-08-01:2026-08-01:chatwoot-customer-service-v1
ORIGINAL_REQUESTED_AT  = 1786016588074
FAILED_SYNC_RUN        = 1c7a20b3-5bb7-45a3-b591-b71e392a02b6
FAILED_SYNC_STARTED_AT = 1786016824335
FAILED_SYNC_FINISHED_AT= 1786016827136
ERROR_CODE             = UNHANDLED_SYNC_ERROR
ERROR_MESSAGE          = Unsupported Dashboard metric scope: period_end_snapshot
MATERIALIZATION        = 0
LARK SNAPSHOT / METRIC = 0 / 0
OPEN REPORT DLQ        = 1
OPEN CRITICAL ALERT    = 1
ACTIVE WORK / LOCK     = 0 / 0
WORKER BASELINE        = notification-only / verified
PRODUCTION             = BLOCKED
```

The failed closeout root is immutable and must never be rerun:

```text
outputs/final-woo-chatwoot-closeout-e9ab36e88526/closeout/chatwoot-1d-3d-7d-30d
```

PR #522 fixed the root cause by mapping Chatwoot period-end Account snapshot metrics to the existing canonical `current_total` scope. This continuation does not alter that metric contract or add a Lark Select option.

## Objective

Continue only the exact retained Chatwoot 1D incident once, verify the complete Shared Report output, restore the notification-only Worker baseline, and then close only the bound DLQ and Critical Alert.

## Reused shared components

- current-head Report Runtime Finalizer evidence;
- reviewed Chatwoot channel runtime flags;
- Notification-preserving Worker Safe/Active config window;
- exact reviewed Queue inventory and sender;
- generic Dashboard preset job builder and Report identity;
- D1 materialization snapshot reader;
- Lark inventory, Stable-key state and D1/Lark integrity verifier;
- D1 backup and exact metadata closure pattern.

No Report engine, Queue framework, D1 writer, Lark sync engine or Reliability framework is added.

## Exact execution contract

Before any deployment or Queue send the operator requires:

1. clean `main` at the exact merged implementation Head;
2. current-head Finalizer evidence with zero schema/settings drift;
3. no pending D1 migration;
4. Chatwoot Coverage `complete` for both conversation and account daily datasets;
5. exact Source state: 200 Conversation facts and 42 Account facts;
6. Work/Lock `0/0`;
7. exactly one open Report DLQ and one open current Chatwoot Report Critical Alert;
8. the exact failed Sync Run identity/timestamps/error;
9. exactly one DLQ whose replay payload is byte-semantically identical to the regenerated original 1D job;
10. empty D1/Lark target state for the exact Report ID;
11. verified notification-only Worker baseline.

The operator then:

1. creates a Remote D1 backup;
2. deploys the reviewed Chatwoot Report Active window and requires three stable samples;
3. sends the original exact job once;
4. reports progress approximately every 30 seconds;
5. stops immediately on a new failed Sync Run or exact new DLQ;
6. requires D1 materialization `1`, successful Sync `>=1`, active lock `0`;
7. requires Lark Snapshot `1`, Metrics `139`, Top Content `0`, Top Ads `0`, duplicate Metric keys `0` and exact D1/Lark integrity;
8. restores and verifies the notification-only Worker baseline;
9. only after all prior gates pass, marks the bound DLQ recovery complete and resolves the bound Alert;
10. reads closure state back and requires open Report DLQ/Alert `0/0`.

## Evidence-root rule

A root with any `.attempt.json` file but no valid final summary is considered started and cannot be rerun. A new incident inspection and new root are required after any partial/unknown outcome.

Default root:

```text
outputs/chatwoot-1d-exact-incident-continuation-50d32078f767
```

## Safety

```text
Provider request                 0
Expected Queue send              1 exact retained job
Generic DLQ redrive              forbidden
Remote D1 business write         only normal Report materialization path
Remote Lark write                only normal Shared Report writer path
Metadata closure                 exact retained DLQ + exact retained Alert only
Notification Admission           false
AI Summary                       false
Schedule                         disabled
Production                       BLOCKED
```

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-chatwoot-1d-incident-continuation.test.js
node --test tests/application/chatwoot-report-materialization.test.js
node --test tests/application/chatwoot-report-dimension-metrics.test.js
node --test tests/connectors/d1-chatwoot-report-source.test.js
node --test tests/application/multichannel-report-runtime.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-success sequence

1. run fresh SELECT-only Chatwoot readiness;
2. require 1D `reuse_or_idempotent_verify` with D1 `1`, Snapshot `1`, Metrics `139`, duplicate `0`, integrity `true`;
3. build a new exact-head retained handoff;
4. complete Chatwoot 3D/7D/30D under a new immutable closeout root;
5. run final Chatwoot post-readiness and Dashboard compatibility readback;
6. keep Notification Admission and Schedule disabled and Production blocked.
