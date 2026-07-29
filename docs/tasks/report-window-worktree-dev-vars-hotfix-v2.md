# Organic Dashboard Report Window Repair — Worktree `.dev.vars` Hotfix v2

## Incident

The confirmed one-command Report repair was executed from the macOS Git worktree that owns `main`.
The local `.dev.vars` entry is a symbolic link to a shared regular `.dev.vars` file. Hotfix v1
rejected every symbolic link before the Report finalizer, so execution stopped with
`REPORT_RUNTIME_WINDOW_REPAIR_DEV_VARS_INVALID` before any Remote action.

The Repository hygiene gate also used `lstat()` on the link itself. On POSIX systems a symbolic
link commonly appears with `0777`, so the gate could still report an unsafe mode even when the
resolved target was correctly restricted.

## Correction contract

- Resolve `.dev.vars` symbolic links before inspecting permissions.
- The resolved target must be a regular file, retain the filename `.dev.vars`, and be owned by the
  current user on POSIX systems.
- Apply `0600` to the resolved target, not to the symbolic-link inode.
- Verify the resolved path, device and inode remain unchanged across the permission mutation.
- Verify owner-only permission bits by following the link to the target.
- Keep broken links, non-file targets, unexpected target filenames, owner mismatch and target races
  fail-closed.
- Use the same shared policy in the one-command Operator and Repository hygiene gate.
- Do not read, print or persist secret contents or resolved filesystem paths.

## Regression

Focused tests create real temporary symbolic links and prove:

- a worktree `.dev.vars` link remains a link while its target changes from `0644` to `0600`;
- the hygiene inspection evaluates target permissions rather than link metadata;
- a wrong target filename is rejected;
- a broken link is rejected;
- an absent `.dev.vars` remains optional.

## Safety

Repository implementation only. No Worker deployment, Queue/DLQ message, Remote D1/Lark write,
Schedule change, provider request, Secret-content access or Production action is authorized.

After exact-head Branch Verification and Squash Merge, rerun the existing one-command workflow from
the `main` worktree. The previous failed attempt stopped before the Report finalizer and therefore
created no partial Report operation.
