# Chatwoot Controller Evidence Arbitration v1

## Status

```text
TASK_STATUS                     = REPOSITORY_IMPLEMENTATION_IN_REVIEW
BRANCH                          = hotfix/chatwoot-controller-evidence-arbitration-v1
BASE_MAIN                       = 6d71c19376b24c1baf64eb31aa191a24ad3d27fd
LATEST_LIVE_STOP_CODE           = CHATWOOT_INITIAL_FAILURE_SESSION_INVALID
INCOMPLETE_EVIDENCE_IDENTITIES  = 2
PROVIDER_ACTIONS                = 0
QUEUE_ACTIONS                   = 0
REMOTE_D1_MUTATIONS             = 0
REMOTE_LARK_MUTATIONS           = 0
WORKER_DEPLOYMENTS              = 0
INCIDENT_CLOSURE_ACTIONS        = 0
SCHEDULE_WEBHOOK                = disabled
PRODUCTION                      = blocked
```

## Incident

The Chatwoot recovery command stopped inside `findControllerResume()` before D1 backup, Work reactivation, Queue
send, Lark mutation or Worker deployment. Two incomplete local controller evidence identities remained visible.
The existing selector correctly refused to choose between them using local timestamps alone.

The active Worker still exposes exactly the four Chatwoot Final UAT gates:

```text
MKT_CONNECTOR_CHATWOOT_ENABLED
MKT_CHATWOOT_D1_WRITE_ENABLED
MKT_CHATWOOT_LARK_WRITE_ENABLED
MKT_CHATWOOT_REPORT_WRITE_ENABLED
```

The Queue-exhaustion recovery contract permits replacement of an interrupted active Worker and transfers Safe
restore ownership to the replacement. Therefore multiple local controller generations can legitimately exist for
the same retained operation while only one deployment version currently owns the active window.

## Correction

Add a public wrapper:

```text
scripts/chatwoot-controller-evidence-arbitration-terminal.mjs
```

The wrapper:

1. requires the exact reviewed wrapper commit and existing recovery confirmation;
2. verifies a clean checkout whose commit remains in current `origin/main` history;
3. performs read-only Cloudflare deployment status and version-view reads;
4. requires the current Worker to expose exactly the four Chatwoot Final UAT active flags;
5. loads incomplete controller evidence without editing or deleting it;
6. deduplicates byte-equivalent evidence identities by newest local copy;
7. selects only when exactly one distinct evidence identity binds to the current active Worker version;
8. fails closed when zero or multiple identities match;
9. creates an isolated exact-main clone with a selective `outputs/chatwoot-final-30d-daily-uat` view containing only
   the selected retained candidate and a fresh current-head evidence directory;
10. delegates all D1 boundary checks, backup, exact Work continuation, parity, Safe restore and incident closure to
    the existing reviewed recovery launcher.

The wrapper contains no Provider request, Queue send, D1/Lark mutation, Worker deployment or incident-closure
implementation. Before child start it performs only local filesystem/Git work and read-only Worker inspection.
After child start, Safe restore ownership remains with the existing inner Final UAT controller.

## Fail-closed boundaries

- No candidate is selected by directory name, repository timestamp or newest Head alone.
- Current active Worker version is required and is never printed in user-visible failure details.
- Distinct baselines sharing one active version remain ambiguous.
- An active Worker that is not the exact Chatwoot four-flag window is rejected.
- Existing current-head evidence blocks blind rerun.
- Retained candidate directories are mounted read-only by behavior; they are not renamed, deleted or rewritten.
- No second Initial admission is introduced.
- Schedule and Webhook remain disabled; Production remains blocked.

## Changed files

```text
scripts/lib/chatwoot-controller-evidence-arbitration.js
scripts/chatwoot-controller-evidence-arbitration-terminal.mjs
tests/application/chatwoot-controller-evidence-arbitration.test.js
docs/tasks/chatwoot-controller-evidence-arbitration-v1.md
docs/current-task.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository verification must perform no Live or Remote mutation. Both Branch Verification and focused Chatwoot
verification must pass on the exact branch Head before Squash Merge.
