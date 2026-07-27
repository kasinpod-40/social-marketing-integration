# Current Task — YouTube Shared-Worker Remote Fingerprint Scope Hotfix

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_MERGE_DECISION_PENDING_FINAL_ALIGNMENT_CI
CURRENT_PROGRAM                     = YOUTUBE_SHARED_WORKER_FINGERPRINT_SCOPE_HOTFIX
BASE_MAIN_SHA                       = 4e31f811a8c9960d0bda714c0c7c0fe125d305aa
BRANCH                              = hotfix/youtube-shared-worker-fingerprint-scope
DRAFT_PR                            = #167 / OPEN / DRAFT / UNMERGED
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
- Preserve the public YouTube Queue timeout error contract while delegating normalization to Shared Core.
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
- Emit only allowlisted sanitized mismatch diagnostics such as fingerprints, missing names and field
  identifiers.
- Preserve exact D1 UUID, Queue context, Main/DLQ topology, Cron, route, workers.dev, traffic, flag and
  Remote fingerprint checks.

## Acceptance result

```text
Unrelated connector Secret names           = ACCEPT / NOT FINGERPRINTED FOR YOUTUBE / PASS
Required YouTube Secret missing             = FAIL_CLOSED / PASS
Secret value exposed                        = FAIL_CLOSED / PASS
Duplicate Secret binding                    = FAIL_CLOSED / PASS
Reviewed false flag omitted by metadata     = MATERIALIZE FALSE FOR COMPARISON / PASS
Explicit reviewed flag true                 = FAIL_CLOSED / PASS
Invalid or duplicate flag binding           = FAIL_CLOSED / PASS
Queue current API shape                     = SHARED NORMALIZER / PASS
YouTube Queue public error codes            = PRESERVED / PASS
D1 UUID / Queue / Cron / route / traffic    = STRICT / UNCHANGED / PASS
Remote writes or mutations                  = ZERO
```

## Verification history

The first PR head correctly failed Unit/Workers runtime because Shared Core error codes had replaced the
existing YouTube public timeout codes and one source-wiring assertion depended on object-property syntax.
The correction preserved the YouTube error contract and changed the assertion to verify semantic wiring.

```text
FAILED_HEAD                          = 9c90da5f4c65a08261d6e199bcd158b9b5b0c275
BRANCH_VERIFICATION                 = #796 / 30303479137 / EXPECTED_FAIL
FAILED_STAGE                        = UNIT_AND_WORKERS_RUNTIME
FAILED_ARTIFACT                     = 8667502483
FAILED_ARTIFACT_DIGEST              = sha256:b836446f40fb937f4c5b2cd69ffc050b6f015f566315ccc4e358b71299d80557
```

Corrected implementation head:

```text
IMPLEMENTATION_HEAD                 = a3709433a45dec0eb74d158c5813caa08d21c292
BRANCH_VERIFICATION                 = #800 / 30303887341 / PASS
DIAGNOSTICS_ARTIFACT                = 8667672120
DIAGNOSTICS_DIGEST                  = sha256:c1c0cd70a024986fbdf26fda97a4ec5326e09532fec7e905cfb45799a15bbc0d
```

Combined head after Meta alignment:

```text
COMBINED_HEAD                       = ffea4f825fa1c0036c1845bb19fd80af28e435d3
BRANCH_VERIFICATION                 = #802 / 30304078259 / PASS
SYNTAX_ARCHITECTURE_HYGIENE         = PASS
FOCUSED_STAGED_TIKTOK               = PASS
NODE_AND_WORKERS_RUNTIME            = PASS
REPORT_RELIABILITY                  = PASS
DEPENDENCY_AUDIT                    = PASS
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT                = 8667750778
DIAGNOSTICS_DIGEST                  = sha256:c92c5ccf80186f3894e5bcc96931f2ef91e2323343c30fb0c3fd45b8bb740a35
REMOTE_ACTION_COUNT                 = 0
```

Latest `main@4e31f811a8c9960d0bda714c0c7c0fe125d305aa` adds the separate TikTok post-Lark
reconciliation workstream and changes shared package/test composition without overlapping the YouTube
Parser, preflight or focused tests. It must be aligned and pass one final exact combined-tree Branch
Verification before PR #167 becomes Ready.

## Remaining sequence

```text
Align main@4e31f811a8c9960d0bda714c0c7c0fe125d305aa
→ exact final-head Branch Verification
→ Integration review and zero-thread/comment check
→ mark PR #167 Ready
→ separate Squash Merge authorization
→ rerun the same one-command Remote read-only preflight
→ PASS_READ_ONLY_PREFLIGHT closes YouTube current-main revalidation
```

This task does not authorize Worker deployment, Queue execution, Remote D1/Lark mutation, Schedule
activation or Production.
