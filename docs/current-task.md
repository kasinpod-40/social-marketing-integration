# Current Task — WooCommerce Final One-command Rollout Merge Closeout

## Authoritative status

```text
TASK_STATUS                         = MERGED_TERMINAL_EXECUTION_PENDING
CURRENT_PROGRAM                     = WOOCOMMERCE_FINAL_ONE_COMMAND_ROLLOUT
CONTRACT_VERSION                    = woocommerce_final_one_command_v1
MERGED_PR                           = #133
SOURCE_HEAD                         = 4347558fd75bddf04e918194392025d71c700ee9
MERGED_MAIN_SHA                     = fb3f2a46b4c22bd293ad5395e7717add75bba690
MERGE_METHOD                        = SQUASH
MERGED_AT                           = 2026-07-27T18:36:13Z
REMOTE_EXECUTION_AUTHORIZED         = TERMINAL_COMMAND_ONLY
REMOTE_ACTIONS                      = NOT_RUN_YET
REMOTE_D1_MUTATION                  = NOT_RUN_YET
WOOCOMMERCE_PROVIDER_REQUEST        = NOT_RUN_YET
LARK_MUTATION                       = NOT_RUN_YET
QUEUE_OR_DLQ_ACTION                 = NOT_RUN_YET
WORKER_DEPLOYMENT                   = NOT_RUN_YET
SCHEDULE                            = DISABLED_UNTIL_COMMAND_PASSES
PRODUCTION                          = BLOCKED
```

The merged implementation task is archived at:

```text
docs/archive/woocommerce-final-one-command-rollout-merged-current-task-2026-07-28.md
```

Technical contracts and operating instructions remain in:

```text
docs/tasks/woocommerce-final-one-command-rollout.md
docs/runbooks/woocommerce-final-one-command-rollout.md
docs/project-brain/woocommerce-final-one-command-rollout-2026-07-28.md
```

## Merge result

PR #133 passed exact-final-head Branch Verification, had zero unresolved review threads, was ahead of
`main` by one commit and behind by zero, then was Squash Merged. No direct push to `main` occurred.

```text
PR_STATE                            = CLOSED
PR_MERGED                           = true
FINAL_SOURCE_HEAD                   = 4347558fd75bddf04e918194392025d71c700ee9
SQUASH_MERGE_COMMIT                 = fb3f2a46b4c22bd293ad5395e7717add75bba690
FINAL_COMPARE_AHEAD                 = 1
FINAL_COMPARE_BEHIND                = 0
FINAL_CHANGED_FILES                 = 19
UNRESOLVED_REVIEW_THREADS           = 0
```

## Merged capability

The Repository now contains the complete WooCommerce Integration Workspace control plane:

- active WooCommerce Connector and Queue job with exact `manual_uat` and `scheduled` trigger allowlist;
- deterministic Bangkok scheduled operation identity;
- conservative D1 Orders/Products incremental watermark;
- Shared Reliability, lock renewal, retry/DLQ, resumable continuation, D1-first writer, Coverage and
  Lark sync reuse;
- isolated Migration `0017` backup/apply when pending without applying Chatwoot Migration `0018`;
- additive Lark 14-table schema repair;
- safe deployment, Full reconciliation, Coverage verification, 14-table D1/Lark parity;
- same-operation idempotent rerun;
- incremental UAT and final Schedule activation;
- automatic all-WooCommerce-flags-false restore after later failures;
- private SHA-chained evidence.

## Final verification

Exact source head `4347558fd75bddf04e918194392025d71c700ee9` passed Branch Verification
`#751` / run `30294301310`:

```text
INSTALL_LOCKED_DEPENDENCIES         = PASS
SYNTAX_ARCHITECTURE_HYGIENE         = PASS
FOCUSED_STAGED_TIKTOK               = PASS
NODE_AND_WORKERS_RUNTIME            = PASS
REPORT_RELIABILITY                  = PASS
DEPENDENCY_AUDIT                    = PASS / 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT                = 8664014277
DIAGNOSTICS_DIGEST                  = sha256:a0df05c8caa0ec11be21fbcc1252a7cd9289cb79b61021c7ea4d0c05441b9553
REMOTE_ACTION_COUNT                 = 0
```

## Only remaining step

From a clean checkout of `main@fb3f2a46b4c22bd293ad5395e7717add75bba690` with the documented local
ignored credentials/configuration available, run exactly:

```bash
CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
node scripts/woocommerce-final-one-command.mjs --execute
```

The command closes WooCommerce Integration Workspace only when Full, parity, rerun, incremental and
Schedule gates all pass. Production/customer-owned deployment remains a separate blocked scope.
