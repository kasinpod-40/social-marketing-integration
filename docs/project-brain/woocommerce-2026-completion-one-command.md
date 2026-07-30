# Project Brain — WooCommerce 2026 Completion One-command

Date: 2026-07-30

## Locked decision

The Integration Workspace WooCommerce transaction scope starts at `2026-01-01T00:00:00.000Z`. The old unbounded operation `woo-final-full-e2372e56d52d` is scope-replaced after backup and bounded cleanup. It must never be resumed as a valid 2026 operation.

## Current recovery chain

- prior cleanup already backed up D1 and Lark;
- prior cleanup deleted the Lark target set;
- Remote D1 rejected explicit `BEGIN/COMMIT` with code `7500` before D1 mutation;
- merged cleanup now uses 11 ordered scoped idempotent statements;
- the completion command independently validates the old cleanup state, Remote Worker all-false state and final zero active reliability state;
- completion runs from one pinned sealed `origin/main` clone and is isolated from concurrent checkout/main movement.

## Required final state

```text
pre-2026 target rows          0
old Work                      terminal
old Sync                      failed / WOOCOMMERCE_HISTORY_SCOPE_REPLACED
new 2026 Full operation       completed
D1/Lark parity                passed
same-operation replay         passed
incremental UAT               passed
active Work/Lock/Queue        0 / 0 / 0
Worker true execution flags   0
Schedule                      disabled
Production                    blocked
```

Only after the completion summary reaches this state may the pinned Meta Finalizer continue.
