# Current Task — Meta Isolated Retained-Head Clone Cleanliness Hotfix v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_ISOLATED_RETAINED_HEAD_CLONE_CLEANLINESS_V1
BRANCH                               = hotfix/meta-isolated-clone-clean-v1
BASE_MAIN_SHA                        = 65855ee5cfe0ee7caf0080c9b0a7c8bc7c91dd7f
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
NEXT_STEP                            = VERIFY_AND_MERGE_ISOLATED_CLONE_CLEANLINESS_HOTFIX
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

The exact continuation passed current-main validation, retained evidence loading, private runtime loading,
Cloudflare read-only context and two stable read-only D1 boundary snapshots. It then stopped before any Lark,
Queue, Worker deployment or other Remote mutation while preparing the isolated retained-Head clone.

```text
stage       prepare-isolated-retained-head
code        META_HISTORY_EXACT_CONTINUATION_ISOLATED_CLONE_INVALID
clone head  5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
origin/main 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
branch      main
clean       false
```

The emitted safety state remains:

```text
Provider replay         0
Queue resend            0
Remote D1 mutation      0
Remote Lark mutation    0
Worker deployment       0
Schedule activation     0
Production              BLOCKED
```

## Confirmed root cause

`prepareIsolatedClone()` checks out the exact retained Head and then injects two local runtime paths:

1. a repository-root `outputs` symlink pointing to the retained evidence workspace;
2. a private `wrangler.sync.jsonc` copy.

The private Wrangler file is ignored by the existing exact filename pattern. The generated artifact rule was
`outputs/`, which matches a directory but does not match the repository-root symlink itself. Therefore Git
reported the operator-created symlink as an untracked path and the exact cleanliness gate blocked its own valid
clone.

No retained evidence, business fact or Remote state is invalid. The failure is local repository hygiene only.

## Repository correction

- Change the generated artifact ignore rule from `outputs/` to exact root path `/outputs`.
- The exact rule ignores the repository-root runtime path whether it is a directory, regular file or symlink.
- Keep `git status --porcelain --untracked-files=all`; do not disable or broadly hide untracked-file detection.
- Keep `wrangler.sync.jsonc` ignored by its existing exact filename rule.
- Add `.gitignore` to the reviewed retained-Head release delta.
- Add wiring regression covering the symlink, runtime config, exact ignore rules and continued untracked-file
  visibility.

## Preserved invariants

- Retained Repository Head remains `5ff8e2cfb1f890ac2a8f2867a904b477c6456d91`.
- Facebook operation identity, generation, period, Work key and Sync-run ID remain unchanged.
- No Provider replay is introduced.
- No Facebook D1 Queue resend is introduced.
- No broad `status.showUntrackedFiles=no` or `--untracked-files=no` bypass is allowed.
- Any unrelated tracked or untracked clone drift still fails closed.
- Schedule remains disabled and Production remains blocked.

## Changed files

```text
.gitignore
docs/current-task.md
scripts/lib/meta-history-exact-plan-continuation.js
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

Only after the exact Hotfix Head passes all gates and is Squash Merged, run once from clean current `main`:

```bash
cd "/Users/wasanjantawong/Git/social-marketing-integration-woo-diag" && \
git fetch origin main && \
git switch main && \
git pull --ff-only origin main && \
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" && \
test -z "$(git status --porcelain --untracked-files=all)" && \
CONFIRM_META_HISTORY_EXACT_CONTINUATION=CONTINUE_META_HISTORY_FROM_FACEBOOK_LARK_BOUNDARY \
node scripts/meta-history-2026-exact-plan-continuation-terminal.mjs --execute
```

Do not run the ordinary Meta Terminal, D1/Lark child launchers or manual Queue commands. Do not edit retained
evidence, `.dev.vars`, lifecycle state or Business facts.

## Implementation result

The Repository correction is implemented on `hotfix/meta-isolated-clone-clean-v1`. Verification and CI are
pending. No Live or Remote action was performed by this Repository hotfix.
