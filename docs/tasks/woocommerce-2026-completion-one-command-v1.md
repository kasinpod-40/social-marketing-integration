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

PR #279 replaced the unsupported transaction with 11 ordered, scoped, idempotent statements and per-step evidence. This workstream adds final orchestration and independent Remote safety verification rather than another cleanup engine.

## Exact command

After exact-head CI, review and merge:

```bash
CONFIRM_WOOCOMMERCE_2026_COMPLETION=EXECUTE_WOOCOMMERCE_2026_COMPLETION \
node scripts/woocommerce-2026-completion-safe-launcher.mjs --execute
```

`woocommerce-2026-completion-one-command.mjs` is the sealed child. Operators must not invoke it directly from a mutable source checkout.

## Safe Launcher

The launcher:

1. secures the resolved local `.dev.vars` target to owner-only mode;
2. fetches and snapshots one exact `origin/main` SHA;
3. creates an independent temporary clone;
4. pins `main`, `HEAD` and local `origin/main` to that SHA;
5. adds only private runtime filenames to clone-local `.git/info/exclude`;
6. copies `.dev.vars` as an owner-only regular file;
7. copies the source Wrangler config to the distinct private file
   `.mkt-woocommerce-2026-completion-wrangler.jsonc`;
8. never overwrites tracked `wrangler.sync.jsonc`;
9. removes inherited Git worktree/index/object/config environment;
10. executes the completion child only inside the sealed clone;
11. preserves evidence outside the clone and destroys the clone in `finally`.

The shared canonical sealed-root helper handles macOS `/var` versus `/private/var` identity. Concurrent branch switches, dirty worktrees and later `main` movement cannot change the running code.

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

The command permits only:

1. exact old Work active + exact old Sync running + no foreign active Work + zero locks; or
2. exact old Work already terminal/scope-replaced + date-bound old rows zero, with at most one separate exact 2026 continuation candidate.

Before cleanup, the active Worker version must contain zero true `MKT_*_ENABLED` flags. Cleanup delegates to the existing backup-first operator and then independently requires:

```text
all pre-2026 date-bound targets     0
Customer aggregates after cleanup  0
old Work lifecycle                  terminal
old Sync status/error               failed / WOOCOMMERCE_HISTORY_SCOPE_REPLACED
total active Work                   0
total active Lock                   0
Worker true execution flags         0
```

The completion wrapper issues no manual Business-table DELETE/UPDATE statements itself.

## Resume after partial 2026 operation

Once cleanup has completed, Customer aggregates created by a valid partial 2026 continuation are preserved and are not treated as old date-bound cleanup rows.

If a previous run stopped during the new 2026 Final operation, rerun discovers exactly one active `woocommerce:woo-final-full-*` identity, reads the exact snapshot and delegates acceptance to `selectWooCommerceFullOperation`.

Accepted continuation requires:

- failed Sync with an existing exact-resume error code;
- active durable Work and partial Business facts;
- no active lock;
- immutable Work/Queue generation and requested-at agreement;
- persisted `orderCreatedAfter` equal to the 2026 cutoff;
- persisted `orderCreatedBefore` equal to the original operation boundary.

Running/locked work receives a bounded observation interval. Foreign, obsolete or ambiguous work fails closed. A replacement Full operation is never admitted while an accepted exact continuation exists.

## Final completion

The existing reviewed Final one-command remains authoritative for:

- additive Lark schema repair;
- D1 backup;
- Safe and Manual UAT Worker windows;
- 2026-only Full reconciliation;
- 14-table D1/Lark parity;
- same-operation idempotent replay;
- incremental UAT;
- automatic all-false Safe closeout.

The wrapper accepts `11-summary.json` only when its repository SHA matches the sealed SHA and every completion gate passes.

A final independent Remote read requires:

```text
active Work                 0
active Lock                 0
active Queue operations     0
Worker true MKT flags       0
Schedule execution flags    false
Production                  false
```

## Evidence and rerun

Evidence is isolated by exact `origin/main` SHA:

```text
outputs/woocommerce-2026-completion/<sha>/
  cleanup/
  final/
  woocommerce-2026-completion-summary.json
```

- completed cleanup is verified and skipped;
- a valid same-SHA Final summary is verified and reused;
- a partial 2026 operation is resumed only through the exact existing continuation contract;
- invalid/stale evidence or foreign active work is never overwritten automatically.

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
