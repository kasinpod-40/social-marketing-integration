# Runbook — WooCommerce 2026 Completion One-command

## Command

Run only after this implementation is merged to `main`:

```bash
CONFIRM_WOOCOMMERCE_2026_COMPLETION=EXECUTE_WOOCOMMERCE_2026_COMPLETION \
node scripts/woocommerce-2026-completion-canonical-launcher.mjs --execute
```

The Canonical Launcher resolves the operating-system temporary directory to its filesystem-canonical identity before delegating to the reviewed Safe Launcher. The Safe Launcher then snapshots the current `origin/main` once and performs all work in an isolated sealed clone. The invoking checkout may be on another branch or dirty; it is not used for execution.

Do not invoke `scripts/woocommerce-2026-completion-one-command.mjs` directly from the source checkout. That file is the sealed child and is launched only after the Canonical Launcher and Safe Launcher have prepared canonical private runtime inputs.

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

## Incidents fixed

### Missing legacy config in sealed clone

A Live completion attempt on `2026-07-30` stopped at the first cleanup D1 read with:

```text
WOOCOMMERCE_2026_CLEANUP_WRANGLER_FAILED
stage=d1-read
```

The Safe Launcher had copied the local Wrangler config only to the modern private filename, while the nested cleanup operator still resolved `wrangler.sync.jsonc`. The repository intentionally does not track that local config, so Wrangler exited before a successful D1 read. The compatibility snapshot fixes this path without committing the local config.

### macOS `/var` versus `/private/var` path identity

The next resumable attempt completed the pre-2026 D1/Lark cleanup, then stopped before Final reconciliation with:

```text
WOOCOMMERCE_FINAL_PATH_INVALID
Wrangler config path must remain inside Repository
```

The config was inside the sealed clone, but macOS represented the same temporary directory once as `/var/...` and once as `/private/var/...`. Legacy string-prefix path guards therefore rejected one filesystem identity under two textual names. The Canonical Launcher sets `TMPDIR`, `TMP` and `TEMP` to the real filesystem path before any sealed clone is created, so every nested operator receives one stable path identity without weakening its containment guard.

The completed cleanup is verified and skipped on the next run. It is not repeated as a destructive blind retry.

## Controlled sequence

```text
full local verification
→ Remote Worker all-false preflight
→ verify or complete pre-2026 cleanup
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

Rerun the exact same Canonical Launcher command after a bounded failure.

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
