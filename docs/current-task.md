# Current Task — Meta Reviewed Release Runner v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_REVIEWED_RELEASE_RUNNER_V1
BRANCH                               = hotfix/meta-reviewed-release-runner-v1
BASE_MAIN_SHA                        = 84650187ad64bf351aab395dcc2da30d8f8e7ab4
REVIEWED_META_RELEASE_HEAD           = 29de2303fa311c4a13fac4725699416cfdc04386
RETAINED_OPERATION_REPOSITORY_HEAD   = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
FACEBOOK_OPERATION_ID                = meta-facebook-history-20260701-20260731-1d12a5ec4fef
FACEBOOK_D1_PHASE                    = COMPLETE
FACEBOOK_LARK_PHASE                  = PENDING
FACEBOOK_COMPLETION_PHASE            = PENDING
FACEBOOK_PROVIDER_REPLAY_ALLOWED     = NO
FACEBOOK_D1_QUEUE_RESEND_ALLOWED     = NO
LATEST_CONTINUATION_STAGE            = shell-reviewed-head-pin
LATEST_CONTINUATION_CODE             = PINNED_MAIN_SHA_NO_LONGER_CURRENT
LATEST_CONTINUATION_REMOTE_ACTIONS   = 0
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_REVIEWED_RELEASE_RUNNER
```

## Latest guarded stop

The public shell command fetched `origin/main` and then stopped at its first exact-SHA assertion. Only the fetch
message was printed. The continuation process did not start.

```text
pinned command Head   29de2303fa311c4a13fac4725699416cfdc04386
current origin/main   84650187ad64bf351aab395dcc2da30d8f8e7ab4
commits advanced      17
remote actions        0
```

The 17 intervening commits are Chatwoot recovery work. Their final delta includes Chatwoot Source, Connector,
launcher, documentation and tests. They must not be silently added to the retained Meta release merely to chase a
moving `main` branch.

## Root cause

The exact continuation correctly required local `main` to equal `origin/main`. Parallel workstreams continued to
merge after each reviewed Meta hotfix, so a command pinned to the last Meta merge became stale before it was run.
Repeatedly expanding the Meta allowlist to every later unrelated change is operationally fragile and broadens the
reviewed release unnecessarily.

## Repository correction

Add a new local-only public wrapper:

```text
scripts/meta-history-2026-reviewed-release-terminal.mjs
```

The wrapper:

1. requires the explicit existing Meta continuation confirmation;
2. requires an exact wrapper commit supplied through `MKT_META_HISTORY_REVIEW_WRAPPER_HEAD`;
3. requires that wrapper commit and reviewed Meta release `29de230...` remain ancestors of current `origin/main`;
4. requires a clean checkout and rejects caller-provided `GIT_CONFIG_*` overrides;
5. creates a temporary local clone fixed at reviewed release `29de230...`;
6. sets that clone's local `main` and `origin/main` to the same reviewed release commit;
7. links only the existing local `outputs`, private `.dev.vars` and `node_modules` into the clone;
8. invokes the already reviewed exact authority:

```text
scripts/meta-history-2026-exact-plan-continuation-terminal.mjs
```

The existing exact Terminal and child operator therefore execute from the identical release tree that passed Meta
End-to-End Verification #155 and Branch Verification #1572. Later Chatwoot or other `main` changes are neither
executed nor added to the Meta allowlist.

## Changed files

```text
docs/current-task.md
scripts/meta-history-2026-reviewed-release-terminal.mjs
tests/application/meta-history-reviewed-release-terminal.test.js
```

## Preserved invariants

- Retained Repository Head and Facebook operation identity remain unchanged.
- Reviewed Meta release remains `29de2303fa311c4a13fac4725699416cfdc04386`.
- Existing retained evidence and Business facts are not edited or synthesized.
- Provider replay remains forbidden.
- Existing Facebook D1 Queue admission is not resent.
- The wrapper performs no Provider, Queue, D1, Lark, Worker deployment or Schedule action itself.
- Any failure before the reviewed exact Terminal starts emits all-zero Remote counters.
- Child failure output is propagated without falsely claiming all-zero actions after execution starts.
- Production remains blocked.

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

Both Meta End-to-End Verification and Branch Verification must pass on the exact branch Head before merge.
Repository verification must perform zero Live or Remote action.

## Public continuation after verified merge

After the wrapper Hotfix passes both workflows and is merged, fetch the exact wrapper merge commit, switch to it in
detached mode and invoke only:

```text
scripts/meta-history-2026-reviewed-release-terminal.mjs
```

The wrapper then invokes `scripts/meta-history-2026-exact-plan-continuation-terminal.mjs` inside the immutable
reviewed release clone. Do not run the ordinary Meta Terminal, direct D1/Lark launchers or manual Queue commands.
Do not edit retained evidence, `.dev.vars`, lifecycle state or Business facts.

## Implementation result

The reviewed release wrapper and regression are implemented on
`hotfix/meta-reviewed-release-runner-v1`. Verification and CI are pending. Repository implementation performed no
Live or Remote action.
