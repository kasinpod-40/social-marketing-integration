# Current Task — YouTube Shared-Worker True-Flag Scope Hotfix

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_MERGE_DECISION_PENDING_DOCS_FINAL_CI
CURRENT_PROGRAM                     = YOUTUBE_SHARED_WORKER_TRUE_FLAG_SCOPE_HOTFIX
BASE_MAIN_SHA                       = 8ca246bd0de3a4a48a10e900d8c9349c00938a1c
BRANCH                              = hotfix/youtube-shared-worker-true-flag-scope
DRAFT_PR                            = #179 / OPEN / DRAFT / UNMERGED
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

The exact live flag name was not exposed by the pre-Hotfix sanitizer. The Repository root cause is verified from the validator path; the post-Hotfix failure boundary now permits only sanitized flag-name diagnostics.

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

## Acceptance result

```text
Known unrelated connector true flags     = COMPARISON-ONLY PROJECT FALSE / PASS
Original Remote response                  = UNCHANGED / PASS
YouTube write or schedule true            = FAIL_CLOSED / PASS
Unknown shared true flag                  = FAIL_CLOSED / PASS
Invalid unrelated Boolean                 = FAIL_CLOSED / PASS
Duplicate unrelated binding               = FAIL_CLOSED / PASS
Secret or binding value exposure          = FORBIDDEN / PASS
Successful output persists names/values   = NO / PASS
Remote writes or mutations                = ZERO
```

## Verification history

The first exact PR head correctly failed Unit/Workers runtime because two test fixtures were ambiguous after the contract became connector-aware:

```text
FAILED_HEAD                          = c75a52b8e3c92376b2bfcfe793aa173e4aa3be5b
BRANCH_VERIFICATION                 = #816 / 30323507763 / EXPECTED_FAIL
FAILED_STAGE                        = UNIT_AND_WORKERS_RUNTIME
FAILED_TESTS                        = 2
FAILED_ARTIFACT                     = 8674834774
FAILED_ARTIFACT_DIGEST              = sha256:e01eccc294036c71e4eae8438fd2cef805e87bd9dd040fae6c6521b67cbd4441
```

Corrections retained Runtime behavior and fixed only test semantics:

- the prior fail-closed regression now selects `MKT_YOUTUBE_LARK_WRITE_ENABLED` explicitly instead of the first alphabetic reviewed false flag;
- the Shared Worker fixture updates its existing Chatwoot binding instead of adding a duplicate.

Corrected exact head:

```text
VERIFIED_HEAD                        = 71b89f28cc87ce1be6d5aeec6c5f022f56dd44bb
BRANCH_VERIFICATION                  = #818 / 30323817522 / PASS
SYNTAX_ARCHITECTURE_HYGIENE          = PASS
FOCUSED_STAGED_TIKTOK                = PASS
NODE_AND_WORKERS_RUNTIME             = PASS
REPORT_RELIABILITY                   = PASS
DEPENDENCY_AUDIT                     = PASS
WRANGLER_DRY_RUN                     = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT                 = 8674940694
DIAGNOSTICS_DIGEST                   = sha256:499869df75bd38bd470d6eef2990efcc888d7ed296f25388134c50499989e369
CHANGED_FILES                        = 8 / EXPECTED ONLY
BEHIND_MAIN                          = 0
UNRESOLVED_REVIEW_THREADS            = 0
COMMENTS_REQUIRING_ACTION            = 0
REMOTE_ACTION_COUNT                  = 0
```

## Implementation result

```text
IMPLEMENTATION                       = COMPLETE
FOCUSED_AND_FULL_REGRESSION           = PASS
SHARED_RUNTIME_REGRESSION             = PASS
TIKTOK_REGRESSION                     = PASS
REMOTE_ACTION_DURING_IMPLEMENTATION   = NONE
LIVE_CONFIRMATION_AFTER_MERGE         = REQUIRED
```

The documentation-only final head must pass one exact-head Branch Verification before PR #179 is marked Ready.

## Remaining sequence

```text
Docs-final exact-head Branch Verification
→ final diff/review/main-drift inspection
→ mark PR #179 Ready
→ separate Squash Merge authorization
→ git pull on local main
→ rerun the same authenticated one-command Remote read-only preflight
→ PASS_READ_ONLY_PREFLIGHT closes YouTube current-main revalidation
```

This task does not authorize Worker deployment, Queue execution, Remote D1/Lark mutation, YouTube Provider request, Schedule activation, Secret change or Production.
