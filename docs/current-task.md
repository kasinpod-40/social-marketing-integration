# Current Task — Meta History 2026 One-Command Finalizer

## Status

```text
TASK_STATUS                   = REPOSITORY_IMPLEMENTATION_IN_REVIEW
CURRENT_PROGRAM               = META_HISTORY_2026_FINALIZER_V1
IMPLEMENTATION_PR             = #319 / OPEN
BASE_MAIN_SHA                 = a1b04a02627db22a47ba1e83e9e445a6a2043258
WOOCOMMERCE                   = WOOCOMMERCE_2026_COMPLETED_SAFE
FACEBOOK                      = VERIFY_EXISTING_D1_LARK_NO_PROVIDER_REPLAY
INSTAGRAM_RANGE               = 2026-07-01..2026-07-31
META_ADS_REQUIRED_RANGE       = 2026-05-01..2026-07-31
META_ADS_CONDITIONAL_RANGE    = 2026-01-01..2026-04-30
PINNED_META_HEAD              = e069380a544575ce0fc9bca53f1fb56944d26c09
PINNED_INSTAGRAM_OPERATION    = meta-instagram-d1-20260729t065939687z-1ad3c9
REMOTE_ACTION_IMPLEMENTATION  = NONE
WORKER_FLAGS                  = ALL_FALSE
SCHEDULE                      = DISABLED
PRODUCTION                    = BLOCKED
```

## Objective

Complete the existing Chemistry K Meta delivery with one reviewed Terminal command. Reuse the merged
Meta Graph client, Shared Queue/Reliability, D1 writers, Coverage, Organic History Writer and
TableSyncEngine. Do not create a replacement Facebook operation or duplicate shared infrastructure.

## History scope

- Facebook: verify the existing pinned D1/Lark completion without another Provider read.
- Instagram: load all content from July 1 through July 31, 2026 using newest-first cursor filtering.
- Meta Ads: load May 1 through July 31, 2026 for both Ads accounts.
- Meta Ads January-April: run only when the three-month baseline remains under the reviewed row and
  Coverage limits.
- Every Meta Ads Provider request remains at most 31 inclusive days.

## Public command after merge

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-one-command.mjs --execute
```

The public launcher runs the guarded finalizer, verifies authoritative D1 and Lark summaries, blocks
uncertain Queue resends, restores the safe Worker configuration after a failed active window and accepts
completion only when Lark parity, idempotent replay and zero active reliability state are proven.

Expected result:

```text
META_HISTORY_2026_COMPLETED_SAFE
Active Work / Lock / Queue operation = 0 / 0 / 0
Worker flags                         = all false
Schedule                             = disabled
Production                           = blocked
```

## Acceptance

```text
Exact merged main                    required
Meta End-to-End Verification         pass
Branch Verification                  pass
Facebook existing completion         verified
Instagram July history               complete
Meta Ads May-July both accounts      complete
D1 before Lark                       required
D1/Lark parity                       pass
Same-operation replay                pass
Uncertain Queue resend               blocked
Final Worker flags                   all false
Schedule / Production                disabled / blocked
Decision                             META_HISTORY_2026_COMPLETED_SAFE
```

Detailed contract: `docs/tasks/meta-history-2026-one-command-v1.md`.
