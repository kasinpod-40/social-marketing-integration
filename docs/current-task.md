# Current Task — Meta Retained Clone Exact Exclude Hotfix v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_RETAINED_CLONE_EXACT_EXCLUDE_V1
BRANCH                               = hotfix/meta-retained-clone-exclude-v1
BASE_MAIN_SHA                        = b188c6bd297b8f825840de3949945562357f1ac4
RETAINED_OPERATION_REPOSITORY_HEAD   = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
FACEBOOK_OPERATION_ID                = meta-facebook-history-20260701-20260731-1d12a5ec4fef
FACEBOOK_ORIGINAL_REQUESTED_AT       = 2026-07-31T16:51:11.017Z
FACEBOOK_D1_PHASE                    = COMPLETE
FACEBOOK_LARK_PHASE                  = PENDING
FACEBOOK_COMPLETION_PHASE            = PENDING
FACEBOOK_WORK_LIFECYCLE              = ACTIVE
FACEBOOK_ACTIVE_LOCKS                = 0
FACEBOOK_QUEUE_OPERATION_ROWS        = 1
FACEBOOK_PROVIDER_REPLAY_ALLOWED     = NO
FACEBOOK_D1_QUEUE_RESEND_ALLOWED     = NO
LATEST_CONTINUATION_STAGE            = prepare-isolated-retained-head
LATEST_CONTINUATION_CODE             = META_HISTORY_EXACT_CONTINUATION_ISOLATED_CLONE_INVALID
LATEST_CONTINUATION_REMOTE_ACTIONS   = 0
WORKER_FLAGS                         = ALL_FALSE_VERIFIED
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_RETAINED_CLONE_EXACT_EXCLUDE
```

## Retained live boundary

The exact Facebook July operation remains D1-complete and Lark-pending:

```text
work_key      facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef
work_type     facebook.page.organic.sync
operation_id  meta-facebook-history-20260701-20260731-1d12a5ec4fef
lifecycle     active
queue rows    1
active locks  0
```

Existing D1 facts and the existing Queue admission are authoritative. Do not restart, replace, abandon,
terminalize or resend this operation.

## Latest guarded stop

The exact continuation again passed current-main validation, retained evidence loading, private runtime loading,
Cloudflare read-only context and two stable read-only D1 boundary snapshots. It stopped before Facebook Lark,
Queue, Worker deployment or any Remote mutation while checking the isolated retained-Head clone:

```text
stage       prepare-isolated-retained-head
code        META_HISTORY_EXACT_CONTINUATION_ISOLATED_CLONE_INVALID
clone head  5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
origin/main 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
branch      main
clean       false
```

The emitted safety state remains all zero, Schedule disabled and Production blocked.

## Confirmed root cause

PR #388 corrected `.gitignore` on current `main`, but `prepareIsolatedClone()` intentionally checks out the
immutable retained Head `5ff8e2c...`. The isolated clone therefore reads the retained Head's older `.gitignore`,
where `outputs/` still does not match the injected repository-root `outputs` symlink.

The current-main `.gitignore` cannot repair a clone whose worktree is intentionally pinned to an older commit.
The retained Head must not be edited or synthesized.

## Repository correction

The public exact-plan Terminal now creates one private local exclude file under the retained output workspace
with exactly two patterns:

```text
/outputs
/wrangler.sync.jsonc
```

It passes that file to the exact continuation child through command-scoped Git configuration:

```text
GIT_CONFIG_COUNT=1
GIT_CONFIG_KEY_0=core.excludesFile
GIT_CONFIG_VALUE_0=<private exact exclude file>
```

The exclude is created only after explicit confirmation and current-main validation, is written atomically with
private permissions, and is read back byte-for-byte before the child starts. Existing caller-provided
`GIT_CONFIG_COUNT/KEY/VALUE` overrides fail closed.

This correction does not change the retained clone worktree, retained evidence or `.gitignore`. The child still
runs `git status --porcelain --untracked-files=all`, so unrelated tracked or untracked drift remains visible and
blocks execution.

## Preserved invariants

- Retained Repository Head remains `5ff8e2cfb1f890ac2a8f2867a904b477c6456d91`.
- Facebook operation identity, generation, period, Work key and Sync-run ID remain unchanged.
- No Provider replay is introduced.
- No Facebook D1 Queue resend is introduced.
- No broad untracked-file suppression is allowed.
- The exact exclude contains only the two operator-injected runtime paths.
- Any unrelated clone drift still fails closed.
- Schedule remains disabled and Production remains blocked.

## Changed files

```text
docs/current-task.md
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
tests/application/meta-history-exact-plan-continuation-wiring.test.js
```

## Required verification

```text
npm ci
npm run check
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-exact-plan-continuation-wiring.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Repository implementation and CI must perform zero Provider requests, Queue sends, Remote D1 mutations, Remote
Lark mutations, Worker deployments or Schedule activations.

## Public continuation after verified merge

Only after the exact Hotfix Head passes Meta End-to-End Verification and Branch Verification and is Squash
Merged, run the existing public exact-plan command once from clean current `main`.

Do not run the ordinary Meta Terminal, D1/Lark child launchers or manual Queue commands. Do not edit retained
evidence, `.dev.vars`, lifecycle state or Business facts.

## Implementation result

The exact child-only Git exclude correction is implemented on
`hotfix/meta-retained-clone-exclude-v1`. Verification and CI are pending. Repository implementation performed no
Live or Remote action.
