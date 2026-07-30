# Runbook — WooCommerce 2026 Completion One-command

## Command

Run only after this implementation is merged to `main`:

```bash
CONFIRM_WOOCOMMERCE_2026_COMPLETION=EXECUTE_WOOCOMMERCE_2026_COMPLETION \
node scripts/woocommerce-2026-completion-one-command.mjs --execute
```

The command snapshots the current `origin/main` once and performs all work in an isolated sealed clone. The invoking checkout may be on another branch or dirty; it is not used for execution.

## Required local input

- Wrangler authentication for the Integration Workspace Cloudflare account;
- local ignored `.dev.vars` containing the Development/Integration Workspace/Lark identity;
- local `wrangler.sync.jsonc`;
- existing Worker Secrets remain in Cloudflare and are never copied back locally.

The command secures the resolved `.dev.vars` target to owner-only mode and copies both runtime files into the sealed clone as private regular files.

## Controlled sequence

```text
full local verification
→ Remote Worker all-false preflight
→ resume/complete pre-2026 cleanup
→ zero-old-row + old-operation closure verification
→ new or exact-resumed 2026 Final operation
→ Full D1/Lark reconciliation
→ 14-table parity
→ same-operation replay
→ incremental UAT
→ all-false Safe closeout
→ zero active Work/Lock/Queue verification
```

## Resume behavior

Rerun the exact same command after a bounded failure.

- completed cleanup is verified and skipped;
- a valid same-Head Final summary is verified and reused;
- one active 2026 Final operation is resumed only when the existing exact-continuation selector accepts its immutable state;
- running work is observed briefly before classification;
- foreign, obsolete, ambiguous, stale-summary and active-flag states fail closed;
- a replacement Full operation is never created while an accepted active operation exists.

## Completion signal

The command is complete only when it prints:

```text
decision = WOOCOMMERCE_2026_COMPLETED_SAFE
activeWork = 0
activeLocks = 0
activeQueueOperations = 0
executionFlagsAllFalse = true
scheduleExecutionFlagsFalse = true
nextStep = resume_pinned_meta_finalizer
```

Evidence is stored under:

```text
outputs/woocommerce-2026-completion/<exact-main-sha>/
```

Do not resume Meta from an incomplete or failed WooCommerce command.
