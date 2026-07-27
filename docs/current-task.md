# Current Task — YouTube Queue Timeout Remote Compatibility Hotfix

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_HOTFIX_IMPLEMENTED_CI_PENDING
CURRENT_PROGRAM                     = YOUTUBE_QUEUE_TIMEOUT_REMOTE_COMPATIBILITY_HOTFIX
BASE_MAIN_SHA                       = 197be38956222ed536560eb30aad9500f7643097
BRANCH                              = hotfix/youtube-queue-max-wait-time-ms
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
HISTORICAL_YOUTUBE_LARK_SYNC        = CONFIRMED_PASS
REMOTE_READ_ONLY_PREFLIGHT          = FAIL_CLOSED_AT_QUEUE_TIMEOUT_PARSE
REMOTE_MUTATION                     = NONE
PROVIDER_CALL                       = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_REQUEST                        = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE_ROUTE_SECRET_MUTATION      = NONE
PRODUCTION                          = BLOCKED
```

The preceding YouTube parser-rollout task is preserved verbatim at:

```text
docs/archive/current-task-before-youtube-queue-timeout-compatibility-hotfix-2026-07-28.md
```

Related contracts:

```text
docs/tasks/youtube-queue-timeout-remote-compatibility-hotfix.md
docs/project-brain/youtube-queue-timeout-remote-compatibility-hotfix-2026-07-28.md
docs/runbooks/youtube-remote-read-only-preflight-final.md
```

## Correct historical baseline

YouTube has already completed the DEV Lark path. This Hotfix does not rebuild or rerun first-time
YouTube-to-Lark writes.

```text
LARK_SCHEMA_APPLY                    = PASS
FULL_SYNC                            = PASS
IDEMPOTENT_RERUN                     = PASS
INCREMENTAL_SYNC                     = PASS
LOCK_RETRY_DLQ_ALERT                 = PASS
IDENTITY_FAIL_CLOSED                 = PASS
```

Existing RAW/Canonical records and stable-key semantics remain protected.

## Live incident

The authorized Remote read-only preflight authenticated and read Remote Worker/Queue metadata, then
stopped fail-closed with:

```text
YOUTUBE_DRY_RUN_COUNT_INVALID
remoteMaxBatchTimeout must be a non-negative integer
```

Cloudflare's current Queue Consumers API represents push-consumer wait time as
`settings.max_wait_time_ms` in milliseconds. The strict validator consumes normalized
`max_batch_timeout` seconds. The compatibility adapter had not translated the official API field, so
`undefined` reached the strict integer validator.

The operation performed no mutation:

```text
REMOTE_MUTATION                     = NONE
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_REQUEST                        = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
```

## Implemented Hotfix

- Accept `settings.max_wait_time_ms` and top-level `max_wait_time_ms` from scoped Remote Queue responses.
- Require non-negative safe integers.
- Require exact whole-second conversion: `milliseconds % 1000 === 0`.
- Normalize milliseconds to the existing reviewed `max_batch_timeout` seconds contract.
- Preserve legacy explicit `max_batch_timeout` support.
- Reject conflicting top-level/settings values and seconds/milliseconds disagreement.
- Never default a missing Remote timeout from Local configuration.
- Preserve exact Queue command context, Main/DLQ separation, D1 UUID, flags, Secrets, consumers, Cron,
  routes, workers.dev, traffic and Remote fingerprint validation.

## Acceptance

```text
30000 ms                            = 30 s / PASS
negative milliseconds               = FAIL_CLOSED
fractional-second milliseconds      = FAIL_CLOSED
seconds/milliseconds mismatch       = FAIL_CLOSED
missing Remote timeout              = FAIL_CLOSED / NO LOCAL DEFAULT
legacy seconds field                = PASS
Main Queue and DLQ contexts         = DISTINCT
```

## Required verification

```text
Focused YouTube parser tests
Focused rollout/preflight regressions
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Remaining sequence

```text
Draft PR
→ exact-head Branch Verification
→ Integration review
→ separate Squash Merge decision
→ rerun the same one-command Remote read-only preflight
```

A later `PASS_READ_ONLY_PREFLIGHT` closes only the YouTube current-main revalidation. It does not
authorize Worker deployment, Queue execution, Schedule activation or Production.
