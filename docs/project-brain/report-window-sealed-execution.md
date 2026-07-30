# Report Window Sealed Execution

## Current decision

Long-running Report Finalizer/Closeout execution must not use a mutable checkout shared with Codex or
another chat. The one-command wrapper snapshots the current `origin/main` SHA into a private clone
and executes every child there.

## Immutable execution identity

```text
source of code              origin/main at command start
execution checkout          independent temporary clone
local branch                main
HEAD                        pinned 40-character SHA
clone origin                . (local pinned main)
invocation worktree         never used by child execution
Git context env             stripped
runtime inputs              private snapshots of .dev.vars + wrangler.sync.jsonc
evidence                    original absolute output directory
cleanup                     recursive finally removal
```

Changing the clone's `origin` to its own repository is intentional. Existing child guards continue
to run `git fetch origin main` and require `HEAD == origin/main`, while unrelated PR merges cannot
move the sealed execution identity midway through Finalizer or a Report window.

## Resume boundary

Completed Finalizer or Window evidence remains reusable only when its repository Head equals the
sealed Head. Partial attempt/backup directories without a complete summary block automatic retry.
A foreign active Worker window is never overwritten.

## Incident that established this rule

On 2026-07-30, Finalizer completed on `main@f5aaf935...`; before 3D Closeout started, another local
agent switched the same checkout to `codex/woocommerce-2026-only-history`. Closeout failed at the
repository guard with no Remote Report action. PR #276 was subsequently merged, confirming the
checkout collision was real rather than operator input error.

Detailed contract: `docs/tasks/report-window-sealed-clone-v1.md`.
