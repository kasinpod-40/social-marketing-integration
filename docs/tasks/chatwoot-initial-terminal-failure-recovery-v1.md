# Chatwoot Initial Terminal Failure Recovery v1

## Status

```text
TASK_STATUS                    = REPOSITORY_IMPLEMENTATION_COMPLETE
ISSUE                          = #389
BASE_MAIN                      = b188c6bd297b8f825840de3949945562357f1ac4
BRANCH                         = hotfix/chatwoot-initial-terminal-failure-recovery-v1
REMOTE_PROVIDER_REQUESTS       = 0
QUEUE_ACTIONS                  = 0
REMOTE_D1_MUTATIONS            = 0
REMOTE_LARK_MUTATIONS          = 0
WORKER_DEPLOYMENTS             = 0
INCIDENT_CLOSURE_ACTIONS       = 0
SCHEDULE_WEBHOOK               = disabled
PRODUCTION                     = blocked
```

`docs/current-task.md` is owned by the concurrent Meta workstream and is intentionally unchanged.

## Long-running controller resume addendum

The authorized live recovery advanced the same Initial operation through Conversation page 2, but the local Final
UAT controller stopped after its Cloudflare bearer expired during prolonged polling. Remote inspection proved the
Work remained active, unit 2 completed successfully, unit 3 was running, the durable cursor advanced to sequence 3,
and no ninth DLQ or fifteenth Alert was created.

The guarded command now detects exactly one prior incomplete Final UAT evidence directory and resumes it without
an Initial Queue send. It binds the retained Initial and Daily identities, the original baseline, safe/active Worker
versions, attempts >= 17, DLQ 8, Alerts 14, zero failed Coverage and the advanced durable cursor. Ambiguous,
completed, safely restored or drifted evidence is rejected. Wrangler uses refreshable OAuth while direct Queue REST
authorization is obtained just in time, and deployment status is checked first, periodically and at completion.
The resumed controller owns Safe restore before any remote preflight. Its retained source-config preflight accepts
the same one exact in-flight Chatwoot lock only in resume mode; the ordinary path continues to require zero locks.
The original 30-day Initial, 3-day Daily, replay and 15-target parity contract is unchanged.

## Queue retry exhaustion addendum

The retained active Worker continued page 3 after the local controller stopped, but the prior runtime processed
every selected Conversation in a Provider page inside one Queue delivery. Attempts 22–25 each performed partial
Stable-key work without committing the durable cursor; Cloudflare then terminalized the same Work with
`QUEUE_RETRY_EXHAUSTED`.

The exact admitted boundary is now:

```text
Work lifecycle / reason       terminal / QUEUE_RETRY_EXHAUSTED
main Queue attempts           25
unit 3                        running, no unit error
durable stage / sequence      conversations / 3
Conversation page             3 (2 pages committed, 50 rows scanned)
selected Conversations        40
selected Messages             1,270
selected Reporting events     281
Coverage Runs                 52 (0 failed rows)
DLQ / open Alert              9 / 15
active lock                   0
```

Conversation processing now persists a zero-based row offset and a SHA-256 fingerprint of the selected external
Conversation IDs for the current page. Each Queue delivery processes exactly one Conversation, advances the page
only after all selected rows commit and rejects page identity/order drift. Legacy durable state has no offset or
fingerprint and therefore safely resumes page 3 at offset zero; existing D1/Lark Stable keys absorb already-written
partial facts.

The controller can deduplicate identical retained evidence copies, verify and reactivate only this exact terminal
boundary, replace the prior active Worker with the reviewed current Head and send one recovery-owned continuation.
The pre-existing active version remains owned by automatic Safe restore until replacement succeeds. The 30-day
window, Schedule/Webhook-disabled state and Production block are unchanged.

## Exact read-only diagnosis

The repository inspector selected the latest retained session whose exact operation was proven by Remote D1,
instead of treating a local Queue attempt marker as admission authority. Wrangler output containing progress text
such as `├ Checking...` was parsed through the shared complete-JSON-document extractor.

The exact SELECT-only inspection returned:

```text
retained Repository Head    65855ee5cfe0ee7caf0080c9b0a7c8bc7c91dd7f
Work lifecycle              terminal
terminal reason             QUEUE_PERMANENT_FAILURE
main Queue attempts         2
unit Sync Run               1 / running
durable phase               absent / nextSequence 0
active lock                 0
current DLQ / Alert         1 open / 1 open
DLQ error                   CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID
Worker                      all execution flags false
Remote rows written         0
```

The Issue snapshot had been observed earlier at active Work / one Queue attempt / no current DLQ. The later
terminal boundary is preserved and handled explicitly; no Remote state was changed during diagnosis.

## Confirmed root cause

`buildChatwootFinalUatSnapshotSql()` counted every unit status other than `success`/`completed` as failed. A normal
`running` masters unit therefore made Final UAT polling emit `CHATWOOT_FINAL_UAT_TERMINAL_FAILURE` and restore the
Worker to all-false while that unit was still executing. The next Queue delivery reached the Safe Worker and was
correctly rejected with `CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID`, which terminalized the same Work and created the
current DLQ/Alert.

The correction counts only terminal unsuccessful unit states (`failed`, `partial_success`). It does not weaken
pending/running visibility and does not hide untracked reliability state.

## Recovery contract

The public recovery is plan-only by default and requires an exact confirmation. At execution it:

1. reruns the SELECT-only inspector and binds the latest D1-proven retained session;
2. creates a fresh Remote D1 backup;
3. reactivates only the exact terminal Work when every Queue, Work, unit, DLQ/Alert, lock and per-table baseline
   guard still matches;
4. deploys the reviewed active window through the existing Final UAT/source-config launcher;
5. sends one recovery-owned sequence-zero continuation for the same operation/work/generation, never a replacement
   Initial admission;
6. preserves current D1 masters and reconciles any Lark lag through the existing Stable-key writers;
7. completes Initial, Initial replay, Daily, Daily replay and all 15 D1/Lark parity checks;
8. restores and verifies all execution flags false;
9. closes the retained old source-config incident, then the exact current incident, only after accepted summaries.

Schedule, Webhook and Production remain disabled. No Provider replay, Queue redrive, Business deletion or Lark
cleanup is introduced.

## Final command after exact-head CI and merge

```bash
cd "/Users/wasanjantawong/Git/social-marketing-integration" && \
git fetch origin main && \
git switch main && \
git pull --ff-only origin main && \
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" && \
test -z "$(git status --porcelain --untracked-files=all)" && \
CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY=RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY \
node scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs --execute
```

Do not run the ordinary Final UAT launcher, manually send/redrive Queue work, mutate the Work row, or close either
incident outside this reviewed command.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
node --test tests/application/chatwoot-final-source-config-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Focused Meta, WooCommerce and TikTok regressions are also required before handoff.

## Implementation result

Repository implementation is complete and ready for Draft PR review. Verification passed:

```text
npm ci                                 PASS
npm run check                          PASS (509 source files, 1,325 dependencies, 0 cycles; hygiene PASS)
focused Chatwoot/cross-channel tests   PASS (128/128)
npm test                               PASS (1,919 Node tests + 16 Workers-runtime tests)
npm run test:report-reliability        PASS (101/101)
npm audit --audit-level=high           PASS (0 vulnerabilities)
npm run deploy:dry-run                 PASS (--dry-run only; no deployment)
git diff --check                       PASS
```

The SELECT-only inspector was executed against the exact current incident and all returned D1 command metadata
reported zero rows written. Repository implementation and tests performed no Provider request, Queue action,
Remote D1/Lark mutation, Worker deployment, Secret mutation, incident closure, Schedule/Webhook action or
Production action. Exact commit Head and Draft PR URL are recorded in the delivery report.

The controller-resume hotfix subsequently passed `npm ci`, `npm run check`, 30 focused recovery tests,
1,936 Node tests, 16 Workers-runtime tests, 101 report-reliability tests, zero-high `npm audit`, deploy dry-run and
`git diff --check`. Its repository implementation performed no additional Queue send, Remote D1/Lark mutation,
Worker deployment, incident closure, Schedule/Webhook action or Production action.

The source-lock follow-up keeps the default retained-incident guard at zero active locks and permits at most the
single D1-proven in-flight lock owned by controller resume. Two locks, a non-resume invocation or any other
retained-incident drift still fails closed before delegated mutation.

The resume Secret follow-up recognizes that the retained active Worker already owns the UAT window. It verifies
the required remote Secret names without requiring all-false bindings and without reading a local token, deploying
a bootstrap Worker or changing a Secret. A missing Secret remains blocked; only the ordinary all-false path may
perform the previously reviewed one-time bootstrap. The core still binds the active version to retained evidence
immediately afterward.

The Queue-exhaustion follow-up passed `npm ci`, repository check, 74 focused Chatwoot/recovery tests, 1,942 Node
tests, 16 Workers-runtime tests, 101 report-reliability tests, zero-vulnerability `npm audit`, deploy dry-run and
`git diff --check`. No live recovery, Queue/DLQ action, Remote D1/Lark mutation, Worker deployment, Secret change,
incident closure, Schedule/Webhook action or Production action was performed by these repository gates.
