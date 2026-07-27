# Current Task — YouTube Shared-Worker Remote Fingerprint Scope Hotfix

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_HOTFIX_IMPLEMENTED_CI_PENDING
CURRENT_PROGRAM                     = YOUTUBE_SHARED_WORKER_FINGERPRINT_SCOPE_HOTFIX
BASE_MAIN_SHA                       = 8364375549f36f0d005aea20864b0bdb5c579adb
BRANCH                              = hotfix/youtube-shared-worker-fingerprint-scope
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
HISTORICAL_YOUTUBE_LARK_SYNC        = CONFIRMED_PASS
REMOTE_READ_ONLY_PREFLIGHT          = FAIL_CLOSED_AT_REMOTE_FINGERPRINT
LIVE_CONFIRMATION_AFTER_FIX         = PENDING
REMOTE_MUTATION                     = NONE
PROVIDER_CALL                       = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_REQUEST                        = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_ROUTE_SECRET_MUTATION      = NONE
PRODUCTION                          = BLOCKED
```

The preceding Queue timeout compatibility task is preserved verbatim at:

```text
docs/archive/current-task-before-youtube-shared-worker-fingerprint-scope-2026-07-28.md
```

Related contracts:

```text
docs/tasks/youtube-shared-worker-fingerprint-scope-hotfix.md
docs/project-brain/youtube-shared-worker-fingerprint-scope-2026-07-28.md
docs/runbooks/youtube-remote-read-only-preflight-final.md
```

## Correct historical baseline

YouTube has already completed the Integration Workspace Lark path. This task does not rebuild, backfill,
delete or rewrite existing YouTube business records.

```text
LARK_SCHEMA_APPLY                    = PASS
FULL_SYNC                            = PASS
IDEMPOTENT_RERUN                     = PASS
INCREMENTAL_SYNC                     = PASS
LOCK_RETRY_DLQ_ALERT                 = PASS
IDENTITY_FAIL_CLOSED                 = PASS
```

## Latest live result

After PR #152 normalized the current Cloudflare Queue timeout field, the authorized read-only preflight
progressed to the complete sanitized Remote contract comparison and stopped fail-closed with:

```text
YOUTUBE_DRY_RUN_REMOTE_FINGERPRINT_MISMATCH
Sanitized Remote deployment contract differs from the reviewed local contract
```

The operation remained read-only:

```text
REMOTE_MUTATION                     = NONE
PROVIDER_CALL                       = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_REQUEST                        = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
```

## Contract diagnosis

The Worker is shared by YouTube, Meta, WooCommerce, Chatwoot and common runtime facilities. The existing
YouTube fingerprint comparison had two compatibility gaps that can create false drift without weakening
Runtime safety:

1. It fingerprinted every Remote Secret binding name against a local YouTube-only list of three required
   Secrets. Additional connector Secrets on the same Worker therefore changed the YouTube fingerprint.
2. Wrangler live version metadata may omit plaintext bindings whose effective value is `false`, while the
   reviewed local safe config materializes the complete expected-false flag set.

The live result did not expose sanitized mismatch details, so the exact contribution of each gap remains
pending live confirmation. Both gaps are corrected together to avoid another blind Terminal cycle.

## Repository implementation

- Reuse the shared `normalizeCloudflareQueueConsumerPayload` contract instead of maintaining duplicate
  YouTube-only Queue field logic.
- Require the exact YouTube Secret subset:
  - `LARK_APP_ID`
  - `LARK_APP_SECRET`
  - `YOUTUBE_API_KEY`
- Reject missing, duplicate or value-exposing Secret bindings.
- Exclude unrelated shared-Worker Secret names only from the YouTube fingerprint input; never from the
  original Remote response or general Worker configuration.
- Materialize only reviewed expected-false flags omitted from live version metadata.
- Preserve explicit Remote values; explicit `true`, invalid Boolean values and duplicate bindings remain
  fail-closed.
- Pass the expected-false set from the reviewed safe/active config comparison into the live adapter.
- Emit only sanitized mismatch diagnostics such as fingerprints, missing names and field identifiers.
- Preserve exact D1 UUID, Queue context, Main/DLQ topology, Cron, route, workers.dev, traffic, flag and
  Remote fingerprint checks.

## Acceptance criteria

```text
Unrelated connector Secret names           = ACCEPT / NOT FINGERPRINTED FOR YOUTUBE
Required YouTube Secret missing             = FAIL_CLOSED
Secret value exposed                        = FAIL_CLOSED
Duplicate Secret binding                    = FAIL_CLOSED
Reviewed false flag omitted by metadata     = MATERIALIZE FALSE FOR COMPARISON
Explicit reviewed flag true                 = FAIL_CLOSED
Invalid or duplicate flag binding           = FAIL_CLOSED
Queue current API shape                     = SHARED NORMALIZER
D1 UUID / Queue / Cron / route / traffic    = STRICT / UNCHANGED
Remote writes or mutations                  = ZERO
```

## Required verification

```text
Focused shared-worker fingerprint tests
Focused YouTube parser/preflight regressions
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Remaining sequence

```text
Open Draft PR
→ exact-head Branch Verification
→ Integration review and zero-thread check
→ separate Squash Merge authorization
→ rerun the same one-command Remote read-only preflight
→ PASS_READ_ONLY_PREFLIGHT closes YouTube current-main revalidation
```

This task does not authorize Worker deployment, Queue execution, Remote D1/Lark mutation, Schedule
activation or Production.
