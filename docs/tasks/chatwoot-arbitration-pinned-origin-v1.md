# Chatwoot Arbitration Pinned Origin v1

## Status

```text
TASK_STATUS              = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BRANCH                    = hotfix/chatwoot-arbitration-pinned-origin-v1
BASE_MAIN                 = ee5c6ce2450ee052669edc24e7af75e1b47cfc4f
LIVE_ACTIONS              = 0
SCHEDULE_WEBHOOK          = disabled
PRODUCTION                = blocked
```

## Pre-handoff finding

Final review of the merged evidence-arbitration wrapper found that its isolated clone retained a local-workspace
`origin` URL. The delegated recovery launcher executes `git fetch origin main` before any mutation. When the operator
runs a detached reviewed commit while the local `main` branch still points to an older commit, that fetch can replace
`origin/main` with the stale local branch and cause a false exact-main failure.

No operator command using the merged wrapper was issued, so this finding caused no Provider request, Queue action,
Remote D1/Lark mutation, Worker deployment, incident closure or Safe-restore change.

## Correction

Add a small outer authority:

```text
scripts/chatwoot-controller-evidence-pinned-origin-terminal.mjs
```

It creates a temporary bare Git origin, pins `refs/heads/main` and `HEAD` to the exact reviewed wrapper commit, then
creates an exact `main` worktree from that origin. Local runtime assets are injected with private regular-file and
exact clone-exclude guards. The existing evidence-arbitration wrapper runs inside this pinned repository, so every
nested `git fetch origin main` resolves to the same reviewed commit even when the source workspace branch has moved
or remained stale.

The existing arbitration wrapper and core Chatwoot recovery launcher remain unchanged. Evidence selection still
requires one identity bound to the current active Worker version. All D1 backup, exact Work continuation, Queue,
parity, Safe restore and incident closure behavior remains owned by the existing reviewed inner launchers.

## Regression

A real-Git test creates two source commits, pins the synthetic origin to the first, leaves the source `main` on the
second, runs `git fetch origin main` inside the generated clone and proves that `HEAD`, `origin/main` and bare
`refs/heads/main` all remain the first reviewed commit.

## Changed files

```text
scripts/lib/exact-pinned-git-origin.js
scripts/chatwoot-controller-evidence-pinned-origin-terminal.mjs
tests/application/chatwoot-controller-evidence-pinned-origin.test.js
docs/tasks/chatwoot-arbitration-pinned-origin-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-evidence-pinned-origin.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass on the exact branch Head. Repository verification must perform zero Live or Remote
mutation. Schedule and Webhook remain disabled; Production remains blocked.
