# Current Task — YouTube Shared-Worker True-Flag Scope Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTED_PENDING_EXACT_HEAD_CI
CURRENT_PROGRAM                     = YOUTUBE_SHARED_WORKER_TRUE_FLAG_SCOPE_HOTFIX
BASE_MAIN_SHA                       = 8ca246bd0de3a4a48a10e900d8c9349c00938a1c
BRANCH                              = hotfix/youtube-shared-worker-true-flag-scope
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
HISTORICAL_YOUTUBE_LARK_SYNC        = CONFIRMED_PASS
REMOTE_READ_ONLY_PREFLIGHT          = FAIL_CLOSED_AT_UNRELATED_SHARED_WORKER_TRUE_FLAG
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

Related contracts:

```text
docs/tasks/youtube-shared-worker-true-flag-scope-hotfix.md
docs/project-brain/youtube-shared-worker-true-flag-scope-2026-07-28.md
docs/tasks/youtube-shared-worker-fingerprint-scope-hotfix.md
docs/tasks/youtube-d1-migration-read-transient-hotfix.md
docs/runbooks/youtube-remote-read-only-preflight-final.md
```

## Correct historical baseline

YouTube has already completed the Integration Workspace Lark path. This task does not rebuild, backfill, delete or rewrite existing YouTube business records.

```text
LARK_SCHEMA_APPLY                    = PASS
FULL_SYNC                            = PASS
IDEMPOTENT_RERUN                     = PASS
INCREMENTAL_SYNC                     = PASS
LOCK_RETRY_DLQ_ALERT                 = PASS
IDENTITY_FAIL_CLOSED                 = PASS
```

## Latest live result

The authorized one-command Remote read-only preflight authenticated through the local Wrangler session and progressed through the merged Queue timeout compatibility, Shared-Secret scoping and bounded D1 migration-list retry. It then stopped with:

```text
YOUTUBE_DRY_RUN_REMOTE_TRUE_FLAG_INVALID
Remote deployment contains an unapproved true flag
```

Safety evidence:

```text
REMOTE_MUTATION                     = NONE
PROVIDER_CALL                       = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_REQUEST                        = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
```

## Root cause

The strict rollout validator enumerates every Remote plaintext binding named `MKT_*_ENABLED` and allows `true` only for the two YouTube dry-run gates. That behavior is correct for the dedicated local all-false safe/active configs, but the Integration Workspace Worker is shared by multiple connectors. A separately reviewed active TikTok, Meta, WooCommerce, Chatwoot, Facebook, Instagram or Google Ads flag therefore creates false YouTube drift before the sanitized YouTube fingerprint is built.

## Repository implementation

- Add `normalizeWranglerVersionUnrelatedConnectorFlags` to the existing live compatibility adapter.
- Recognize only known non-YouTube connector namespaces:
  - `CHATWOOT`
  - `FACEBOOK`
  - `GOOGLE_ADS`
  - `INSTAGRAM`
  - `META`
  - `TIKTOK`
  - `WOOCOMMERCE`
- Validate each recognized binding as an explicit Boolean.
- Reject duplicate recognized connector flag bindings.
- Project recognized connector `true` values to `false` only in the in-memory YouTube fingerprint input.
- Preserve the original Wrangler response and actual Remote Worker configuration unchanged.
- Never project YouTube-owned flags or unknown/shared flags.
- Keep YouTube Lark write, Analytics and Schedule gates fail-closed when true.
- Add only `additionalConnectorTrueFlagCount` to successful output; do not persist flag names or values.
- Allow `unexpectedTrue` only as a sanitized failure diagnostic containing flag names.
- Preserve Queue, D1 UUID, required Secret subset, Cron, route, workers.dev, traffic, migration and fingerprint checks.

## Acceptance criteria

```text
Known unrelated connector true flags     = COMPARISON-ONLY PROJECT FALSE / PASS REQUIRED
Original Remote response                  = UNCHANGED / PASS REQUIRED
YouTube write or schedule true            = FAIL_CLOSED / PASS REQUIRED
Unknown shared true flag                  = FAIL_CLOSED / PASS REQUIRED
Invalid unrelated Boolean                 = FAIL_CLOSED / PASS REQUIRED
Duplicate unrelated binding               = FAIL_CLOSED / PASS REQUIRED
Secret or binding value exposure          = FORBIDDEN
Full Repository gates                     = REQUIRED
Remote writes or mutations                = ZERO
```

## Required verification

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

The exact PR head must pass Branch Verification, remain aligned with current `main`, contain no unresolved review threads or actionable comments, and receive separate Squash Merge authorization before merge.

## Remaining sequence

```text
Exact-head Branch Verification
→ diff/review/main-drift inspection
→ mark PR Ready
→ separate Squash Merge authorization
→ git pull on local main
→ rerun the same authenticated one-command Remote read-only preflight
→ PASS_READ_ONLY_PREFLIGHT closes YouTube current-main revalidation
```

This task does not authorize Worker deployment, Queue execution, Remote D1/Lark mutation, YouTube Provider request, Schedule activation, Secret change or Production.
