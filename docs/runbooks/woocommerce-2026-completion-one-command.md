# Runbook — WooCommerce 2026 Completion One-command

## Command

Run only after this implementation is merged to `main`:

```bash
CONFIRM_WOOCOMMERCE_2026_COMPLETION=EXECUTE_WOOCOMMERCE_2026_COMPLETION \
node scripts/woocommerce-2026-completion-safe-launcher.mjs --execute
```

The Safe Launcher snapshots the current `origin/main` once and performs all work in an isolated sealed clone. The invoking checkout may be on another branch or dirty; it is not used for execution.

Do not invoke `scripts/woocommerce-2026-completion-one-command.mjs` directly from the source checkout. That file is the sealed child and is launched only after the Safe Launcher has prepared canonical private runtime inputs.

## Required local input

- Wrangler authentication for the Integration Workspace Cloudflare account;
- local ignored `.dev.vars` containing the Development/Integration Workspace/Lark identity;
- local `wrangler.sync.jsonc`;
- existing Worker Secrets remain in Cloudflare and are never copied back locally.

The launcher secures the resolved `.dev.vars` target to owner-only mode and creates two owner-only Wrangler snapshots inside the sealed clone:

```text
.mkt-woocommerce-2026-completion-wrangler.jsonc
wrangler.sync.jsonc
```

The first path is passed explicitly to current operators. The second is a clone-local compatibility snapshot for reviewed nested operators that still resolve the historical default filename. Both paths are added only to the sealed clone's `.git/info/exclude`, remain mode `0600`, are destroyed with the clone and are never committed or copied back to the source checkout.

The launcher fails closed if the exact sealed `main` snapshot begins tracking or otherwise already contains `wrangler.sync.jsonc`; it never overwrites a tracked file.

## Incident fixed — missing legacy config in sealed clone

A Live completion attempt on `2026-07-30` stopped at the first cleanup D1 read with:

```text
WOOCOMMERCE_2026_CLEANUP_WRANGLER_FAILED
stage=d1-read
```

The Safe Launcher had copied the local Wrangler config only to the modern private filename, while the nested cleanup operator still resolved `wrangler.sync.jsonc`. The repository intentionally does not track that local config, so Wrangler exited before a successful D1 read. The attempt stopped before cleanup backup, Lark delete, D1 delete, Worker deployment, Queue admission or Meta finalization.

After this compatibility bridge is merged, rerun the same Safe Launcher command. Completion remains resumable and the existing operation identity is preserved.

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

Rerun the exact same Safe Launcher command after a bounded failure.

- completed cleanup is verified and skipped;
- a valid same-Head Final summary is verified and reused;
- one active 2026 Final operation is resumed only when the existing exact-continuation selector accepts its immutable state;
- valid 2026 Customer aggregate rows created by a partial continuation are preserved and do not masquerade as old cleanup rows;
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
