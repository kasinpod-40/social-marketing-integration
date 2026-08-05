# Report Readiness Bootstrap Bindings v1

Date: 2026-08-05

## Incident

The exact-main Report Runtime Finalizer completed successfully and retained the active Notification Runtime
baseline. SELECT-only readiness then stopped for every reviewed channel at
`remote-worker-preserved-baseline-read-only` because the currently deployed Worker did not yet contain
`LARK_TABLE_MKT_REPORT_TOP_ADS`.

```text
ready channels evaluated          0
blocked before source reads       8
Provider requests                 0
Queue actions                     0
Remote mutations                  0
Worker deployments                0
Notification Admission            false
Production                        BLOCKED
```

## Root cause

The shared remote verifier used one Lark binding contract for both stages:

1. existing pre-Report Notification Runtime baseline;
2. newly deployed Report Active or restored baseline versions.

The existing baseline predates the first Report activation and may legitimately omit Report-only bindings. The
verifier incorrectly required every Report binding before the bounded activation window had ever deployed them.

## Correct contract

### Existing bootstrap baseline

- D1 and Queue bindings remain exact and required;
- Notification Runtime bindings remain exact and required;
- Report-only bindings may be absent;
- any Report-only binding that is present must match the Finalizer identity exactly;
- duplicate optional bindings fail closed;
- execution flags must equal the retained Notification Runtime baseline;
- Notification Admission remains false.

### Newly deployed Active and restored versions

- every Report and Notification binding is required exactly once;
- every mapping must match the Finalizer identity;
- Active flags equal Notification baseline plus approved Report flags;
- restored flags equal the retained Notification baseline;
- AI, schedules, automatic Notification Admission and Production remain blocked.

The verifier distinguishes these stages through the expected deployed Version ID: absence means read-only
bootstrap verification; presence means exact post-deploy verification.

## Acceptance

- current Notification Runtime baseline can pass when `TOP_ADS` or another Report-only binding is absent;
- a present but incorrect Report-only mapping is rejected;
- duplicate optional bindings are rejected;
- post-deploy verification still requires every Report and Notification binding;
- readiness remains SELECT-only and performs zero Remote mutation;
- Run All continues to require exact post-deploy and restore verification.
