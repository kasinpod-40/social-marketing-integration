# Meta Lark Parity Fast-Track Rollout Operator

## Status

`REPOSITORY_IMPLEMENTATION / REMOTE_NOT_RUN`

## Goal

ให้แต่ละ Chemistry K Meta target ต่อจาก accepted D1-only boundary ไปยัง Lark ทันที โดยไม่รอครบ
สี่ Target และไม่เรียก Meta Provider ซ้ำ

## Authority

- `AGENTS.md`
- `docs/current-task.md`
- `docs/tasks/meta-end-to-end.md`
- `docs/tasks/meta-d1-only-rollout-operator.md`
- `docs/runbooks/meta-d1-only-rollout.md`

## Runtime premise

`processMetaEndToEndSync()` stages Provider source units durably. `processMetaEndToEndGeneration()`
marks the D1 phase complete and returns `lark_gate_disabled` when Lark is false. The Work intentionally
remains active. Sending the same stable operation with Lark enabled reuses staged source and completed
D1, then executes destination preflight, Lark tables and final reconciliation.

## Targets

```text
facebook
instagram
chemistry_k2
chemistry_k3
```

## Parallel execution model

```text
Lark metadata preflight for all 15 destinations
        runs in parallel with
Facebook D1-only plan / preflight / rollout

Facebook D1 accepted → Facebook Lark continuation immediately
Instagram D1 accepted → Instagram Lark continuation immediately
chemistry_k2 D1 accepted → chemistry_k2 Lark continuation immediately
chemistry_k3 D1 accepted → chemistry_k3 Lark continuation immediately
```

Different targets may be in different stages, but only one Worker deployment/active flag window may be
owned by the Integration operator at a time. Queue sends remain target-isolated.

## Lark metadata contract

All 15 logical Table IDs must:

- be present in Environment and exact Safe Wrangler config;
- exist in the connected Base;
- be unique;
- contain the exact stable-key Field declared in `META_END_TO_END_LARK_TABLES`.

The preflight reads table/field metadata only. It does not read or write records.

## D1 readiness contract

The exact target must provide an accepted `meta-d1-only-rollout-v1` summary proving:

- D1 and Coverage accepted;
- same-operation D1 rerun accepted;
- all-false restore verified;
- Lark mutation count zero;
- schedule activation count zero.

Remote D1 readback must additionally prove D1 complete, Coverage valid, no active lock, no existing Lark
or completion phase, and active unfinished Work.

## Active configuration

Exactly four flags may be true:

```text
selected Meta Connector
MKT_META_SOURCE_READ_ENABLED
MKT_META_D1_WRITE_ENABLED
MKT_META_LARK_WRITE_ENABLED
```

All unrelated flags, Report, Schedule, DLQ redrive and Production remain false.

## Queue contract

- same operation ID, Work key, generation and original requested timestamp as D1-only;
- `trigger=manual_uat`;
- `dryRun=false`;
- omit `d1Only` so the Runtime may continue to Lark;
- source-account scope retained for Ads;
- one initial Lark continuation send and one separately confirmed rerun only.

## Acceptance

Initial Lark continuation must prove:

- Provider request count zero during continuation;
- D1 Business counts unchanged;
- Coverage counts unchanged and valid;
- destination preflight complete;
- all target-specific Lark contracts complete;
- every expected row accounted for as created/updated/skipped;
- completion reconciliation complete;
- Work completed, no active lock.

Rerun must prove another Queue attempt with unchanged Lark results/reconciliation and unchanged
D1/Coverage counts.

## Safety

Repository implementation authorizes no Remote phase. Every executable phase has an exact confirmation
and previous-evidence requirement. Emergency restore is required after an active-window failure.

No schema, Formula, View, migration, Schedule, Production resource or customer-owned asset is changed
by this task.
