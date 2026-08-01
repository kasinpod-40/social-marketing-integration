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
