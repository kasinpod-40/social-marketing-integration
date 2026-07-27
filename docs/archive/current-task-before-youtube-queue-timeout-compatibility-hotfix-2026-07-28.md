# Current Task — YouTube Live Parser Rollout Readiness

## Authoritative status

```text
TASK_STATUS                         = MERGE_AUTHORIZED_EXACT_ALIGNED_CI_REQUIRED
CURRENT_PROGRAM                     = YOUTUBE_LIVE_PARSER_ROLLOUT_WIRING_V2
BASE_MAIN_SHA                       = fd346b21ecbaeca43c117b0b3634f7580683d8d6
BRANCH                              = integration/youtube-live-parser-rollout-wiring-v2
PR                                  = #134 / OPEN / MERGE_AUTHORIZED
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
HISTORICAL_YOUTUBE_LARK_SYNC        = CONFIRMED_PASS
REMOTE_READ_ONLY_PREFLIGHT          = PREPARED / NOT_RUN
REMOTE_ACTIONS                      = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
REMOTE_D1                           = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
YOUTUBE_OR_LARK_REQUEST             = NOT_RUN
SCHEDULE_ROUTE_SECRET_MUTATION      = NONE
PRODUCTION                          = BLOCKED
```

The preceding WooCommerce one-command rollout merge closeout is preserved verbatim at:

```text
docs/archive/current-task-before-youtube-live-parser-rollout-wiring-v2-2026-07-28.md
```

Technical contracts:

```text
docs/tasks/youtube-live-parser-rollout-wiring-v2.md
docs/runbooks/youtube-remote-read-only-preflight-final.md
docs/project-brain/youtube-live-parser-rollout-readiness-2026-07-28.md
```

## Correct historical baseline

YouTube has already completed the DEV Lark path. This task does not rebuild or re-prove first-time
YouTube-to-Lark writes.

```text
LARK_SCHEMA_APPLY                    = PASS
FULL_SYNC                            = PASS
IDEMPOTENT_RERUN                     = PASS
INCREMENTAL_SYNC                     = PASS
LOCK_RETRY_DLQ_ALERT                 = PASS
IDENTITY_FAIL_CLOSED                 = PASS
```

Existing records and stable-key semantics remain protected in:

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
RAW_YouTube_Analytics_Daily
MKT_Accounts
MKT_Content
MKT_Content_Daily
```

## Repository implementation completed

- Wired the merged `validateLiveRemoteYouTubeDeploymentContract` adapter into executable rollout
  verification for safe baseline, active deployment and restore.
- Preserved raw Main Queue and DLQ Wrangler responses until separate exact command contexts are applied.
- Required the reviewed immutable D1 UUID; an omitted display name is accepted only after UUID match.
- Preserved the strict existing flag, Secret-name, consumer, Cron, route, workers.dev, traffic and Remote
  fingerprint validator.
- Added a plan-only-by-default one-command Remote read-only Terminal operator.
- Added exact `main`, clean-tree and active-version-before/after guards.
- Added deterministic migration decisions, including fail-closed treatment of pending `0017` and `0018`.
- Added focused wiring, active-version, migration and read-only-boundary tests.
- Preserved the Wrangler Secret-list compatibility hotfix, WooCommerce one-command runtime and all current
  shared package commands.

## Final Terminal package

Plan-only, no Remote call:

```bash
npm run preflight:youtube-remote-read-only
```

After PR #134 is merged, the only remaining YouTube revalidation operation is:

```bash
CONFIRM_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT=RUN_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT \
  npm run preflight:youtube-remote-read-only:run
```

The executable command performs only read operations and writes a private sanitized result to:

```text
outputs/youtube-remote-read-only-preflight/summary.json
```

Decision contract:

```text
PASS_READ_ONLY_PREFLIGHT
BLOCKED_MAIN_CHANGED
BLOCKED_ACTIVE_VERSION_CHANGED
BLOCKED_REMOTE_CONTRACT
BLOCKED_MIGRATION_0017_REMOTE_TRUTH
BLOCKED_PENDING_MIGRATION_0018
BLOCKED_PENDING_MIGRATIONS
```

Migration `0017_woocommerce_commerce.sql` must not be rerun. Migration
`0018_chatwoot_analytics.sql` remains owned by the Chatwoot workstream and may block this preflight
without being applied here.

## Safety boundary

```text
Worker deploy/upload/rollback        = FORBIDDEN / NOT_RUN
Queue send/Ack/Retry/DLQ mutation    = FORBIDDEN / NONE
D1 execute/write/migration apply     = FORBIDDEN / NONE
YouTube/Lark request                 = FORBIDDEN / NOT_RUN
Cron/route/workers.dev/Secret change = FORBIDDEN / NONE
Production                           = BLOCKED
```

## Verified implementation history

The implementation passed repeated exact-head Branch Verification runs while `main` advanced through
Meta, Chatwoot and WooCommerce workstreams. Latest pre-alignment proof:

```text
BRANCH_VERIFICATION                 = #756 / 30295071793 / PASS
SYNTAX_ARCHITECTURE_HYGIENE         = PASS
FOCUSED_STAGED_TIKTOK               = PASS
NODE_AND_WORKERS_RUNTIME            = PASS
REPORT_RELIABILITY                  = PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT                = 8664315727
DIAGNOSTICS_DIGEST                  = sha256:6526e71037d7f311abbdef81bd05f6e67c49b29c573ea8be4df9bdeea6151740
UNRESOLVED_REVIEW_THREADS           = 0
PR_COMMENTS_REQUIRING_ACTION        = 0
REMOTE_ACTION_COUNT                 = 0
```

## Remaining gate

The branch is aligned onto current `main@fd346b21ecbaeca43c117b0b3634f7580683d8d6`. GitHub Branch
Verification must pass on the exact aligned head, then the already authorized Squash Merge may proceed.
After merge, only the final Terminal read-only preflight remains. A PASS closes the current YouTube
revalidation; it does not authorize deployment, Queue execution, Schedule activation or Production.
