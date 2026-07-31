# Current Task — Meta History Runtime Preflight Recovery v2

## Status

```text
TASK_STATUS                   = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM               = META_HISTORY_RUNTIME_PREFLIGHT_RECOVERY_V2
BASE_MAIN_SHA                 = 17c59e1196a1713aa19bacac41e8d101dfe7ceb0
BRANCH                        = hotfix/meta-history-runtime-preflight-v2
IMPLEMENTATION_PR             = PENDING
PREVIOUS_IMPLEMENTATION_PR    = #319 / SQUASH_MERGED
FACEBOOK_SUPPLEMENTAL_RANGE   = 2026-07-01..2026-07-31
INSTAGRAM_RANGE               = 2026-07-01..2026-07-31
META_ADS_REQUIRED_RANGE       = 2026-05-01..2026-07-31
META_ADS_CONDITIONAL_RANGE    = 2026-01-01..2026-04-30
PLANNED_OPERATION_COUNT       = 6
REMOTE_ACTION_DURING_HOTFIX   = NONE
WORKER_FLAGS_BEFORE_INCIDENT  = ALL_FALSE_VERIFIED
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
NEXT_STEP                     = VERIFY_AND_MERGE_HOTFIX
```

## Live failures retained

The first execution stopped at `prepare-safe-config` because the launcher incorrectly required the
non-secret Wrangler source config to be a private `0600` non-symlink file.

A temporary private-copy workaround passed that boundary. The second execution then stopped at
`cloudflare-readiness` with:

```text
active Work                         0
active Lock                         0
sync_runs queued/running rows       2
reported active Queue operations    2
```

The active Worker version had already passed the all-false flag check. No Meta operation, Queue message,
Remote D1/Lark write or Provider request had started. The outer closeout nevertheless caught the
Reliability-idle error as a generic inspection failure and attempted an unnecessary emergency Safe deploy.
That deploy failed because a generated config under `outputs/` retained the relative Worker entry point
`apps/sync-worker/src/index.js`, which Wrangler resolved relative to the generated config directory.

## Root corrections

- Treat the Wrangler source as a readable regular file; symlinks resolving to a regular file are valid.
- Keep `.dev.vars`, pinned evidence and generated execution config private and non-symlinked.
- Rewrite relative `main` and `migrations_dir` paths to absolute Repository paths before writing the
  generated private config.
- Define active Queue operations by `queue_operation_attempts` joined to active durable
  `sync_work_runs`, matching the existing completed-state Reliability contract.
- Do not treat historical `sync_runs` rows without active Work as active Queue execution.
- Split Worker-flag verification from Reliability-idle verification.
- Run an emergency all-false deploy only when the exact
  `WOOCOMMERCE_2026_COMPLETION_REMOTE_FLAGS_ACTIVE` condition proves execution flags are enabled.
- Authentication, config, D1-read or Reliability-idle failures never trigger a blind deploy.
- Preserve all six deterministic Meta operations, stable keys and retained evidence. No Business fact is
  deleted or replaced.

## Acceptance

```text
Readable 0644/symlink source config accepted       required
Generated execution config mode                    private 0600
Generated Worker entry point                       absolute Repository path
Generated migrations directory                     absolute Repository path
Worker flag and Reliability checks                  separated
Historical queued/running sync_runs                 not active Queue by itself
Active Queue operation                              tied to active durable Work
Emergency deploy                                    exact active-flag error only
Meta End-to-End Verification                        PASS required
Branch Verification                                 PASS required
Remote action during Repository work                0
Schedule / Production                               disabled / blocked
```

## Public command after merge

The public entrypoint remains unchanged:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not run the previous command again until this hotfix is reviewed, merged and the new exact `main` SHA
is provided. Do not delete the prior runtime plan or evidence directories.

Detailed incident contract: `docs/tasks/meta-history-runtime-preflight-recovery-v2.md`.
