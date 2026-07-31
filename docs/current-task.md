# Current Task — Meta History 2026 One-Command Finalizer

## Status

```text
TASK_STATUS                   = REPOSITORY_IMPLEMENTATION_IN_REVIEW
CURRENT_PROGRAM               = META_HISTORY_2026_FINALIZER_V1
IMPLEMENTATION_PR             = #319 / OPEN
BASE_MAIN_SHA                 = a6abb815467dbf4d452f6a6fc37f13294c875306
WOOCOMMERCE                   = WOOCOMMERCE_2026_COMPLETED_SAFE
FACEBOOK_PINNED               = VERIFY_EXISTING_D1_LARK_NO_PROVIDER_REPLAY
FACEBOOK_SUPPLEMENTAL_RANGE   = 2026-07-01..2026-07-31
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
TableSyncEngine. Do not replay or replace the completed Facebook operation and do not duplicate Shared
infrastructure.

## History scope

- Facebook pinned lane: verify the existing D1/Lark completion without replaying that operation.
- Facebook supplemental history: run one new deterministic and idempotent operation for July 1–31, 2026
  through the existing D1 and Lark phase operators. Stable Business keys must preserve existing rows and
  add only missing history.
- Instagram: load all content from July 1–31, 2026 using newest-first cursor filtering.
- Meta Ads: load May 1–July 31, 2026 for both Ads accounts.
- Meta Ads January–April: run only when the three-month baseline remains under reviewed row and Coverage
  limits.
- Every Meta Ads Provider request remains at most 31 inclusive days.

## Public command after merge

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

The Terminal entrypoint requires exact clean `main`, persists six deterministic operation IDs with unique
ISO `originalRequestedAt` generations before any Remote action, then delegates to the guarded one-command
finalizer. The child verifies authoritative D1 and Lark summaries, blocks uncertain Queue resends,
restores the safe Worker configuration after a failed active window and accepts completion only when
Facebook/Instagram history, Ads history, Lark parity, idempotent replay and zero active Reliability state
are proven.

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
ISO requested-at generations         six / persisted before Remote action
Meta End-to-End Verification         pass
Branch Verification                  pass
Facebook pinned completion           verified / no replay
Facebook July supplemental history   complete
Facebook replacement operation       false
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
