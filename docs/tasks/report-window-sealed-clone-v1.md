# Report Window Sealed Clone v1

## Incident

Organic Dashboard one-command repair finalized Report schema/settings successfully on
`main@f5aaf935d814fa65da48aeb3b4a5e642f279928a`, then stopped before the 3D refresh.
The Finalizer process observed a clean `main`, but the next Closeout child observed:

```text
branch          codex/woocommerce-2026-only-history
head            80ff94b6c79217613c9348a55812008edfa2a7e8
origin/main     f5aaf935d814fa65da48aeb3b4a5e642f279928a
clean           false
```

PR #276 used the same local checkout while the long-running Report command was between child
processes. The Closeout guard correctly failed before D1 backup, Worker deployment, Queue send or
Report materialization.

## Root cause

The wrapper executed every child with `cwd` set to the mutable invocation worktree. Repository
preflight was repeated per child, but there was no isolation preventing another local agent from
switching branch or modifying that checkout after Finalizer completion.

A normal worktree lock is insufficient because external Git/Codex processes do not automatically
honor an application lock. The execution checkout itself must be private and immutable for the
lifetime of the command.

## Correction contract

The outer wrapper now:

1. secures and resolves `.dev.vars` without exposing its contents;
2. removes inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, Git object/common-directory and
   numbered Git-config environment overrides;
3. fetches `origin/main` once and pins the exact 40-character SHA;
4. creates a temporary independent clone, not a shared Git worktree;
5. checks out local branch `main` at the pinned SHA;
6. changes the clone's `origin` URL to `.` and fetches local `main`, so existing exact-main guards
   remain valid but later remote PR merges cannot move `origin/main` during this run;
7. snapshots `.dev.vars` and `wrangler.sync.jsonc` into the clone as owner-only regular files,
   failing if either source changes during the read;
8. runs Finalizer and all four Report windows only inside the sealed clone;
9. preserves evidence in the original absolute output directory; and
10. recursively destroys the sealed clone in `finally`.

The inner process requires sealed root + pinned Head environment values to match its actual checkout.
It cannot be redirected to another repository by inherited Git context.

## macOS canonical-root follow-up

The first merged sealed-clone run stopped before Finalizer/3D Remote action with
`REPORT_RUNTIME_SEALED_ROOT_MISMATCH` on pinned Head
`76a417eede942e5f721c2cbcd6f881e27ece4fb5`. On macOS the same temporary directory can be exposed
through aliases such as `/var/...` and `/private/var/...`. The original guard compared normalized path
strings, so it rejected the same filesystem directory.

The root guard now preserves the security boundary while accepting only paths that resolve to the same
canonical directory or the same filesystem device/inode. A different directory remains fail-closed.
The regression suite creates a real directory symlink alias, proves the alias is accepted, and proves
an unrelated directory still raises `REPORT_RUNTIME_SEALED_ROOT_MISMATCH`.

This failure occurred before Report Finalizer reuse/apply, D1 backup, Worker deploy, Queue send, D1
materialization or Lark Report write. Production remained blocked.

## Existing resume and Remote safety

The prior resume contract remains unchanged:

- reuse Finalizer evidence only for the same pinned Head;
- reuse only complete Window summaries proving D1/Lark parity, replay and all-false restore;
- block directories containing partial attempt/backup evidence without a valid summary;
- never override a foreign active Worker execution window automatically;
- preserve stable Report IDs and all Business facts.

The worktree-collision incident stopped at `repository-and-finalizer-evidence` with
`activeDeploymentAttempted=false`. No 3D backup, Report deployment, Queue message, D1
materialization or Report Lark write occurred.

## Required validation

```text
Focused sealed-execution and Report-window tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
Branch Verification CI
```

## Live command after merge

Run the wrapper directly from the existing repository. A separate manual temporary clone is no longer
needed because the wrapper creates and destroys its own sealed clone:

```bash
CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR=EXECUTE_REPORT_RUNTIME_WINDOW_REPAIR \
node scripts/report-runtime-window-repair.mjs --execute
```

The wrapper snapshots the then-current `origin/main`; it does not execute from the mutable checkout
that launched the command. Schedule, AI and Production remain disabled.
