# Current Task — Meta Reviewed Clone Exact Exclude Hotfix v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_REVIEWED_CLONE_EXACT_EXCLUDE_V1
BRANCH                               = hotfix/meta-reviewed-clone-exclude-v1
BASE_MAIN_SHA                        = a453135eb78bbea9c74d1be7dc72375334eece7a
REVIEWED_META_RELEASE_HEAD           = 29de2303fa311c4a13fac4725699416cfdc04386
REVIEWED_WRAPPER_PREVIOUS_HEAD       = 78b3e4f25bddf1605c58c9e7aa11084fca396810
RETAINED_OPERATION_REPOSITORY_HEAD   = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
FACEBOOK_OPERATION_ID                = meta-facebook-history-20260701-20260731-1d12a5ec4fef
FACEBOOK_D1_PHASE                    = COMPLETE
FACEBOOK_LARK_PHASE                  = PENDING
FACEBOOK_COMPLETION_PHASE            = PENDING
FACEBOOK_PROVIDER_REPLAY_ALLOWED     = NO
FACEBOOK_D1_QUEUE_RESEND_ALLOWED     = NO
LATEST_CONTINUATION_STAGE            = prepare-reviewed-release-clone
LATEST_CONTINUATION_CODE             = META_HISTORY_REVIEWED_RELEASE_CLONE_INVALID
LATEST_CONTINUATION_REMOTE_ACTIONS   = 0
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_REVIEWED_CLONE_EXCLUDE
```

## Latest guarded stop

The reviewed-release wrapper successfully verified the exact wrapper checkout, current `origin/main` ancestry and
local runtime assets. It created the temporary clone at reviewed Meta release `29de230...`, but stopped before the
exact continuation child because the clone was not clean:

```text
head        29de2303fa311c4a13fac4725699416cfdc04386
origin/main 29de2303fa311c4a13fac4725699416cfdc04386
branch      main
clean       false
```

All emitted Remote counters were zero. No Provider request, Queue send, D1/Lark mutation, Worker deployment or
Schedule action occurred. Production remains blocked.

## Confirmed root cause

The wrapper injected three runtime assets after checking out the immutable reviewed release:

```text
outputs      symlink
.dev.vars    symlink
node_modules symlink
```

Directory-style ignore patterns in the reviewed release do not necessarily match repository-root symlinks. Git
therefore reported one or more wrapper-created runtime assets as untracked and the exact cleanliness gate correctly
failed closed.

A second issue was identified before rerun: the downstream exact continuation requires `DEV_VARS_FILE` to be a
private regular file and rejects a symlink. Leaving `.dev.vars` as a symlink would have caused the next guarded stop.

## Repository correction

The reviewed-release wrapper now:

1. keeps `outputs` and `node_modules` as local symlinks;
2. copies `.dev.vars` into the temporary clone as a private regular file with mode `0600`;
3. writes the temporary clone's private `.git/info/exclude` with exactly:

```text
/outputs
/.dev.vars
/node_modules
```

4. reads the exclude file back byte-for-byte and verifies that it is a private regular file;
5. continues to run `git status --porcelain --untracked-files=all`;
6. reports exact dirty paths if any unrelated drift remains.

The exclude is clone-local Git metadata. It does not change the reviewed release worktree, retained evidence,
`.gitignore`, Business facts or any Remote state. No wildcard directories, `status.showUntrackedFiles=no` or
`--untracked-files=no` bypass is allowed.

## Changed files

```text
docs/current-task.md
scripts/meta-history-2026-reviewed-release-terminal.mjs
tests/application/meta-history-reviewed-release-terminal.test.js
```

## Preserved invariants

- Reviewed Meta release remains `29de2303fa311c4a13fac4725699416cfdc04386`.
- Retained Repository Head and Facebook operation identity remain unchanged.
- Existing retained evidence and Business facts are not edited or synthesized.
- Provider replay remains forbidden.
- Existing Facebook D1 Queue admission is not resent.
- Wrapper preparation performs only local Git/filesystem work.
- Any unrelated untracked path remains visible and blocks execution.
- Schedule remains disabled and Production remains blocked.

## Required verification

```text
npm ci
npm run check
node --test tests/application/meta-history-reviewed-release-terminal.test.js
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-exact-plan-continuation-wiring.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Both Meta End-to-End Verification and Branch Verification must pass on the exact branch Head before Squash Merge.
Repository verification must perform zero Live or Remote action.

## Public continuation after verified merge

After verified merge, fetch the exact new wrapper merge commit, switch to it in detached mode and invoke only:

```text
scripts/meta-history-2026-reviewed-release-terminal.mjs
```

Inside the immutable reviewed release clone, that wrapper delegates only to the existing exact child authority:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

Do not run the previous wrapper commit, ordinary Meta Terminal, direct D1/Lark launchers or manual Queue commands.
Do not edit retained evidence, `.dev.vars`, lifecycle state or Business facts.

## Implementation result

The exact temporary-clone exclude, private `.dev.vars` copy and focused regression are implemented on
`hotfix/meta-reviewed-clone-exclude-v1`. CI is pending. Repository implementation performed no Live or Remote
action.
