# Meta Lark Parity Fast-Track Decision — 2026-07-27

## Customer priority

Chemistry K's immediate value is seeing trusted Meta data in Lark. Repository implementation and
Provider validation are no longer the main waiting point. The rollout must therefore pipeline D1 and
Lark rather than wait for all four Meta targets to finish D1 first.

## Decision

Adopt a target-streamed rollout:

```text
prepare all Lark destination metadata now
then for each target:
D1 accepted → same operation continues to Lark immediately
```

Target order remains Facebook, Instagram, ChemistryK2 and ChemistryK3. This ordering limits risk while
allowing the next target's read-only/D1 preparation to overlap with the previous target's review.

## Technical basis

The merged Meta Runtime already provides the required continuation semantics:

- Provider units are durably staged before Business writes;
- D1 phase state is durable and idempotent;
- `lark_gate_disabled` leaves the Work active rather than discarding source staging;
- the same stable operation can resume with Lark enabled;
- completed D1 is skipped;
- existing destination preflight and `TableSyncEngine` perform Lark reconciliation;
- final completion closes the Work only after Lark passes.

This avoids a second Provider pull and avoids a new D1 operation.

## Parallel boundaries

Safe parallel work:

- Lark table/field metadata preflight while Facebook D1 readiness proceeds;
- Repository implementation/review while local Remote credentials remain untouched;
- next-target planning/read-only inspection while the previous target evidence is reviewed.

Serialized work:

- Worker deployment windows;
- shared Queue sends;
- active Lark write windows;
- all-false restore verification;
- any operation sharing the same target/Work identity.

## Data integrity rules

A Lark continuation is accepted only when:

- exact D1-only summary and Work identity match;
- Provider requests during continuation are zero;
- D1 Business counts do not change;
- Coverage counts/status do not change;
- all expected Lark rows reconcile;
- rerun leaves Lark reconciliation unchanged;
- safe restore completes before another target's active window.

## Scope retained

The implementation reuses existing Meta adapters, source staging, Reliability, Queue operation,
D1 repositories, Coverage, Lark client and `TableSyncEngine`. No new schema, Formula, View, migration,
Connector, Queue framework, writer or schedule is introduced.

## Remote status

This Project Brain record reflects Repository design only. At creation time:

```text
Remote D1 processing       NOT_RUN
Worker deployment          NOT_RUN
Queue messages             NONE
Lark metadata reads        NOT_RUN
Lark record writes         NONE
Schedule                   DISABLED
Production                 BLOCKED
```
