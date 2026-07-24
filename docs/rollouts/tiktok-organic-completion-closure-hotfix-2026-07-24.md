# TikTok Organic Completion Closure Hotfix — 2026-07-24

## Scope

This hotfix closes the exact TikTok Organic durable-recovery incident after all 2,021 D1 business facts and Coverage became durable but operational DLQ closure failed.

Immutable incident:

```text
operation_id       = f59b852f00634005c7ff4da51afee964
work_key           = tiktok:f59b852f00634005c7ff4da51afee964
generation         = 1784829780000
original_dlq       = dlq:8d1b9077657385a417cb32a0ed3114cb
terminal_dlq       = terminal:a90a4dbf2f281124d40601f2f7799a90
coverage_run_id    = coverage:tiktok:d398495edc3b070b815f99559ecce1a2f24f4c9ac4e0335810e287636fc2f2e0
completed_at       = 1784880407927
```

## Confirmed live sequence

1. The final staged Unit durably produced 2,021 State rows, 2,021 initial Observations and 2,021 Coverage entities.
2. Coverage completed with expected=observed=2,021 and failed_rows=0.
3. `completeWork()` persisted exact `completion_json`, changed Work to completed and intentionally cleared phase/unit rows.
4. DLQ closure still required the now-cleared write phase and raised `TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE`.
5. Permanent Queue failure handling changed the already-completed Work to terminal and created `terminal:a90a4dbf2f281124d40601f2f7799a90`.

## Runtime fix

- TikTok recovery closure accepts a cleared phase only when exact persisted completion counters, zero-Lark proof and complete Coverage all match the immutable incident.
- Queue terminalization uses a completion-protected Work-store adapter and cannot reverse `lifecycle_status=completed`.
- Active, terminal and superseded Work behavior remains delegated to the existing D1 resumable Work store.

## Operator phases

```text
plan
→ deploy
→ repair
→ verify
→ replay
→ replay-verify
```

Operator:

```bash
node scripts/tiktok-recovery-completion-closure-operator.mjs
```

### Deploy

Requires:

```text
CONFIRM_TIKTOK_COMPLETION_CLOSURE_DEPLOY=DEPLOY_TIKTOK_COMPLETION_CLOSURE_HOTFIX_SCHEDULES_FALSE
```

Runs repository checks, focused tests, both deploy dry runs and the Integration Workspace Worker deployment. It performs no Remote D1 write and sends no Queue message.

### Repair

Requires:

```text
CONFIRM_TIKTOK_COMPLETION_CLOSURE_REPAIR=REPAIR_EXACT_COMPLETED_TIKTOK_RECOVERY_CLOSURE
```

The phase first validates exact live evidence, then performs only guarded operational updates:

- restore the exact Work from false terminal state to completed while preserving `completed_at`, `completion_json` and retention;
- mark the original DLQ recovery completed/redriven;
- mark the false-positive terminal DLQ completed/redriven;
- retain all DLQ rows and metadata for audit.

It does not update or delete Organic business facts, Coverage facts, Lark data, Queue messages or generations.

### Verify

Read-only exact closure proof. Required facts include:

```text
State / Observation / initial Observation / Coverage entity = 2021
Duplicate groups = 0
Work = completed
phase rows / unit rows = 0 (normal completed-Work cleanup)
completion_json durable counters = 2021
Lark writes = 0
Coverage = complete, expected=observed=2021, failed=0
Original DLQ = redriven / recovery metadata completed
Terminal DLQ = redriven / closure metadata completed
```

### Replay

Requires:

```text
CONFIRM_TIKTOK_COMPLETION_CLOSURE_REPLAY=REPLAY_EXACT_COMPLETED_TIKTOK_RECOVERY_ONCE
```

Sends the existing same-generation recovery payload exactly once, only after final closure verification.

### Replay verify

Read-only proof that all durable business facts and completion identity remain unchanged and no new terminal recovery failure was created.

## Guardrails

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
Worker=social-mkt-sync-worker
D1=social-mkt-state-dev
Queue=social-mkt-sync-jobs
Schedules=false
Lark business writes=0
Production=blocked
Google Ads PR #17=Draft/HOLD
```

No cleanup, deletion, new generation, manual Work mutation outside the guarded operator, Lark write, schedule enablement or Production change is authorized.
