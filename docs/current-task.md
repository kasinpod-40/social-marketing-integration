# Current Task — Meta History Execution After Customer Runtime Config Recovery v6

## Status

```text
TASK_STATUS                         = META_HISTORY_2026_EXECUTION_READY
CURRENT_PROGRAM                     = META_HISTORY_2026_FINALIZER_V1
ORIGINAL_IMPLEMENTATION_PR          = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR         = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR         = #342 / SQUASH_MERGED
SHARED_QUEUE_AUTHORITY_PR           = #343 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_HOTFIX_PR        = #348 / SQUASH_MERGED
EXPLICIT_SAFE_FLAGS_HOTFIX_PR       = #353 / SQUASH_MERGED
CUSTOMER_RUNTIME_CONFIG_HOTFIX_PR   = #359 / SQUASH_MERGED
CUSTOMER_RUNTIME_CONFIG_MAIN_SHA    = 339b72d8b950caffc78efaf513e6e6abf9bf4b0e
META_VERIFICATION_RUN               = 30641268623 / #115 / PASS
BRANCH_VERIFICATION_RUN             = 30641268627 / #1470 / PASS
PLANNED_OPERATION_COUNT             = 6
PREVIOUS_ATTEMPT_CURRENT_OPS        = 0
PREVIOUS_ATTEMPT_D1_BACKUP          = 0
PREVIOUS_ATTEMPT_WORKER_DEPLOY      = 0
PREVIOUS_ATTEMPT_QUEUE_MESSAGES     = 0
PREVIOUS_ATTEMPT_BUSINESS_WRITES    = 0
PREVIOUS_ATTEMPT_PROVIDER_GATE      = GET_ONLY_PASSED
WORKER_FLAGS                        = ALL_FALSE_VERIFIED
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
NEXT_STEP                           = RUN_META_HISTORY_2026_TERMINAL_ONCE
```

## Authority

PR #359 was Squash Merged at:

```text
339b72d8b950caffc78efaf513e6e6abf9bf4b0e
```

The exact reviewed Head `0244029eff2e89bbf762dd9d54771f82ec1511ea` passed:

```text
Meta End-to-End Verification  run 30641268623 / #115 / PASS
Branch Verification           run 30641268627 / #1470 / PASS
Review threads                0
Branch behind main            0 before merge
Changed files                 8 / Meta scope only
Terminal executable mode      100755
D1 launcher executable mode   100755
Lark launcher executable mode 100755
Remote action during Hotfix   0
```

## Seventh attempt retained

The Terminal attempt on `main@2ddc9cef8262f768d1b589e5b7bc069d861d80a4` passed:

```text
Local full gates                   PASS
Cloudflare readiness               PASS
Remote Worker all-false            PASS
Fresh ordered Provider validation  PASS / GET-only
```

It entered the first required Facebook July operation and stopped while loading the D1 target because the
reviewed generated Wrangler config did not contain a pinned Meta Graph API version:

```text
stage    operation-facebook-2026-07-01-2026-07-31
code     META_D1_ONLY_SOURCE_MAPPING_INVALID
message  Meta D1-only config requires a pinned Meta Graph API version
```

The target loader stopped before Remote D1 inspection, backup, Worker deployment and Queue admission.
`emergencyRestoreRequired=false`, and the outer closeout verified the Worker all-false state.

```text
Current operation accepted       0
D1 backup                       0
Worker deployments              0
Queue messages                  0
Remote D1 Business writes       0
Remote Lark writes              0
Schedule mutations              0
Production                      blocked
```

Retain every prior evidence directory. Do not delete, copy or edit prior output.

## Customer runtime authority now merged

The public Terminal, D1 launcher and Lark launcher now use one Shared non-secret authority:

```text
MKT_ENV                     development
MKT_CUSTOMER_PROFILE        integration_workspace
MKT_CONNECTION_CUSTOMER_KEY chemistry_k
META_GRAPH_API_VERSION      v25.0
Facebook mapping            approved Chemistry K Page
Instagram mapping           approved Chemistry K Professional Account
Meta Ads mappings           chemistry_k2 and chemistry_k3
Legacy single Ad mapping    explicitly empty
```

Before the guarded child starts, Terminal materializes this authority and closes every reviewed execution
flag to explicit `false`. D1 and Lark each create a private `0600` runtime Wrangler config beside the
Head-bound Safe config under ignored `outputs/`, replace stale non-secret values, insert missing values and
fail closed unless every exact value is present.

Credentials remain in `.dev.vars` and Worker Secret storage. The operator does not modify `.dev.vars`, does
not place tokens in generated config or evidence and does not require the operator to supply API version or
identity mappings on the command line.

## Retained execution scope

```text
Facebook continuity  fresh identity + exact no-replay plan
Facebook July        2026-07-01..2026-07-31
Instagram            2026-07-01..2026-07-31
Meta Ads required    2026-05-01..2026-07-31 for chemistry_k2 and chemistry_k3
Meta Ads optional    2026-01-01..2026-04-30 only under bounded baseline volume
```

Existing Business facts remain authoritative and are preserved through Stable keys. D1 completes before the
same-operation Lark continuation. Historical local Meta clone/session/overlay/finalizer files remain
unnecessary.

## Public Terminal command

Run only from exact clean current `main`:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not manually supply Meta API version or customer IDs. Do not modify `.dev.vars`, invoke child launchers or
send Queue messages manually.

## Expected accepted result

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook continuity             fresh identity / no old replay
Facebook July supplemental      complete
Instagram July                  complete
Meta Ads required               complete for both accounts
D1/Lark parity                  pass
Same-operation replay           pass
Active Work / Lock / Queue      0 / 0 / 0
Worker flags                    all false
Schedule                        disabled
Production                      blocked
```

Live completion is not declared until the Terminal emits the accepted decision and final safe-state
evidence.

Detailed recovery contract: `docs/tasks/meta-history-customer-runtime-config-recovery-v6.md`.
