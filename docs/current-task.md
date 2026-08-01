# Current Task — Meta Multichannel Audit Allowlist Alignment v1

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_MULTICHANNEL_AUDIT_ALLOWLIST_ALIGNMENT_V1
BRANCH                               = hotfix/meta-multichannel-docs-allowlist-v1
BASE_MAIN_SHA                        = d84254f4fe5f14b68f6a30c43ccc7876ce8a0e9c
RETAINED_OPERATION_REPOSITORY_HEAD   = 5ff8e2cfb1f890ac2a8f2867a904b477c6456d91
FACEBOOK_OPERATION_ID                = meta-facebook-history-20260701-20260731-1d12a5ec4fef
FACEBOOK_D1_PHASE                    = COMPLETE
FACEBOOK_LARK_PHASE                  = PENDING
FACEBOOK_COMPLETION_PHASE            = PENDING
FACEBOOK_PROVIDER_REPLAY_ALLOWED     = NO
FACEBOOK_D1_QUEUE_RESEND_ALLOWED     = NO
LATEST_CONTINUATION_STAGE            = verify-current-main-before-local-summary
LATEST_CONTINUATION_CODE             = META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID
LATEST_CONTINUATION_REMOTE_ACTIONS   = 0
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = VERIFY_AND_MERGE_MULTICHANNEL_DOC_ALLOWLIST
```

## Latest guarded stop

The public exact continuation stopped before local summary materialization, Cloudflare context, Queue, Lark,
Worker deployment or any Remote mutation because the retained-Head delta contained two reviewed documentation
paths that were absent from the exact allowlist:

```text
docs/project-brain/multichannel-report-coverage.md
docs/tasks/multichannel-report-coverage-v1.md
```

All emitted Remote counters were zero. Schedule remains disabled and Production remains blocked.

## Confirmed repository history

The two files were introduced by documentation-only commit:

```text
df42737b2f96a51404da46ecfd8f2ad5898e617d
docs: audit multichannel report coverage and metric matrix
```

That commit became the direct parent of the PR #391 Squash Merge:

```text
df42737b2f96a51404da46ecfd8f2ad5898e617d
  -> d84254f4fe5f14b68f6a30c43ccc7876ce8a0e9c
```

PR #391 CI was created from the earlier base and therefore did not include the two documentation paths in its
reviewed allowlist. This is a merge-order race, not retained evidence drift and not a Meta runtime change.

The Multichannel commit changes only the two documentation files above. It does not change Worker, Queue, D1,
Lark connector, finalizer, source runtime, feature flags or Production configuration.

## Repository correction

- Add the two exact Multichannel audit document paths to
  `META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA`.
- Add a focused regression proving both paths are required and omission still fails closed.
- Preserve exact-set comparison; do not add wildcard directory allowances.
- Preserve the retained Repository Head, Facebook operation identity and private child Git exclude behavior.

## Changed files

```text
docs/current-task.md
scripts/lib/meta-history-exact-plan-continuation.js
tests/application/meta-history-exact-plan-continuation-doc-allowlist.test.js
```

## Preserved invariants

- Provider replay remains forbidden.
- Existing Facebook D1 Queue admission is not resent.
- No Remote D1 or Lark mutation is performed by this hotfix.
- No Worker deployment or Schedule activation is performed.
- Any path beyond the exact reviewed release set still fails closed.
- Production remains blocked.

## Required verification

```text
npm ci
npm run check
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-exact-plan-continuation-wiring.test.js
node --test tests/application/meta-history-exact-plan-continuation-doc-allowlist.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Both Meta End-to-End Verification and Branch Verification must pass on the exact branch Head before Squash Merge.
Repository verification must perform zero Provider requests, Queue sends, Remote D1/Lark mutations, Worker
deployments or Schedule activations.

## Public continuation after verified merge

After the exact Hotfix Head passes both workflows and is Squash Merged, run the public exact-plan command once
from clean current `main`. Do not run the ordinary Meta Terminal, D1/Lark child launchers or manual Queue
commands. Do not edit retained evidence, `.dev.vars`, lifecycle state or Business facts.

## Implementation result

The exact documentation allowlist correction and focused regression are implemented on
`hotfix/meta-multichannel-docs-allowlist-v1`. Verification and CI are pending. Repository implementation
performed no Live or Remote action.
