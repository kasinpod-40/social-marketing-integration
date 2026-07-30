# WooCommerce 2026 Completion One-command v1

## Objective

ปิด WooCommerce Integration Workspace จาก Live cleanup ที่ค้างให้จบด้วย Terminal command เดียว:

```text
pre-2026 cleanup
→ exact old Work/Sync scope-replaced closure
→ 2026-only Full reconciliation
→ D1/Lark parity
→ same-operation replay
→ incremental UAT
→ all-false Safe closeout
→ zero active Work/Lock/Queue verification
```

คำสั่งนี้ไม่รวม Production, Schedule/Cron activation, AI หรือ manual D1/Lark edit.

## Confirmed starting state

```text
replaced operation       woo-final-full-e2372e56d52d
history cutoff           2026-01-01T00:00:00.000Z
D1 backup                completed before prior attempt
Lark backup              completed before prior attempt
Lark old targets         deleted by prior attempt
D1 old Orders            7,800 at latest read-only inspection
old Work                 active
old Sync                 running
active lock              0
prior blocker            Remote D1 rejected explicit BEGIN/COMMIT (code 7500)
```

PR #279 replaced the unsupported transaction with 11 ordered, scoped, idempotent statements and per-step evidence. This workstream adds the final orchestration and Remote safety checks rather than another cleanup engine.

## One command

After exact-head CI, review and merge:

```bash
CONFIRM_WOOCOMMERCE_2026_COMPLETION=EXECUTE_WOOCOMMERCE_2026_COMPLETION \
node scripts/woocommerce-2026-completion-one-command.mjs --execute
```

## Sealed execution

The outer process:

1. secures the resolved local `.dev.vars` target to owner-only mode;
2. fetches and snapshots one exact `origin/main` SHA;
3. creates an independent temporary clone;
4. pins `main`, `HEAD` and local `origin/main` to that SHA;
5. copies `.dev.vars` and `wrangler.sync.jsonc` as private regular files;
6. removes inherited Git worktree/index/object/config environment;
7. executes only inside the sealed clone;
8. preserves evidence outside the clone and destroys the clone in `finally`.

Concurrent branch switches, dirty worktrees and later `main` movement cannot change the running code.

## Local gates before Remote mutation

```text
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Any failure stops before cleanup, deployment or Queue admission.

## Cleanup gate

The command reads Remote D1 and permits only one of these states:

1. exact old Work active + exact old Sync running + no foreign active Work + zero locks; or
2. exact old Work already terminal/scope-replaced + old rows zero, with at most one separate exact 2026 continuation candidate.

Before cleanup, the active Worker version must contain zero true `MKT_*_ENABLED` flags. Cleanup delegates to the existing backup-first operator and then independently requires:

```text
all pre-2026 target counts          0
old Work lifecycle                  terminal
old Sync status/error               failed / WOOCOMMERCE_HISTORY_SCOPE_REPLACED
total active Work                   0
total active Lock                   0
Worker true execution flags         0
```

The completion wrapper never issues manual DELETE/UPDATE statements itself.

## Exact continuation

If a previous run stopped during the new 2026 Final operation, rerun does not create a replacement automatically. It discovers exactly one active `woocommerce:woo-final-full-*` identity, reads the existing snapshot and delegates acceptance to `selectWooCommerceFullOperation`.

Accepted continuation still requires:

- failed Sync with an existing exact-resume error code;
- active durable Work;
- partial Business rows;
- no active lock;
- immutable Work/Queue generation and requested-at agreement;
- persisted `orderCreatedAfter` equal to the 2026 cutoff;
- persisted `orderCreatedBefore` equal to the original operation boundary.

Running/locked work is observed with a bounded wait. Foreign, obsolete or ambiguous work fails closed.

## Final completion

The existing reviewed Final one-command remains authoritative for:

- additive Lark schema repair;
- D1 backup;
- Safe and Manual UAT Worker windows;
- 2026-only Full reconciliation;
- 14-table D1/Lark parity;
- same-operation idempotent replay;
- incremental UAT;
- automatic and successful all-false Safe closeout.

The wrapper accepts `11-summary.json` only when the repository SHA matches the sealed SHA and all completion gates are true.

A final independent Remote read requires:

```text
active Work                 0
active Lock                 0
active Queue operations     0
Worker true MKT flags       0
Schedule execution flags    false
Production                  false
```

## Evidence and resume

Evidence is isolated by exact `origin/main` SHA:

```text
outputs/woocommerce-2026-completion/<sha>/
  cleanup/
  final/
  woocommerce-2026-completion-summary.json
```

- completed cleanup is reused after exact Remote verification;
- a valid same-SHA Final summary is reused;
- a partial 2026 operation is resumed only through the exact existing continuation contract;
- an invalid/stale summary or foreign active work is never overwritten automatically.

## Completion signal

```json
{
  "ok": true,
  "decision": "WOOCOMMERCE_2026_COMPLETED_SAFE",
  "remote": {
    "activeWork": 0,
    "activeLocks": 0,
    "activeQueueOperations": 0,
    "executionFlagsAllFalse": true,
    "scheduleExecutionFlagsFalse": true
  },
  "nextStep": "resume_pinned_meta_finalizer"
}
```

Only after this signal may the pinned Meta Finalizer continue with its existing session and operation IDs.
