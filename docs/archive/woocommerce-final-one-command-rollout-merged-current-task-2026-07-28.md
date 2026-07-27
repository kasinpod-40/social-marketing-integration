# Current Task — WooCommerce Final One-command Rollout

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_FINAL_HEAD_VERIFICATION_PENDING
CURRENT_PROGRAM                     = WOOCOMMERCE_FINAL_ONE_COMMAND_ROLLOUT
CONTRACT_VERSION                    = woocommerce_final_one_command_v1
BASE_MAIN_SHA                       = 1630fe97ba65fab7c89a6ba1d2644884db37e453
BRANCH                              = integration/woocommerce-final-one-command-rollout
DRAFT_PR                            = #133 / OPEN / DRAFT / UNMERGED
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
REMOTE_EXECUTION_AUTHORIZED         = false
REMOTE_ACTIONS                      = NONE_DURING_IMPLEMENTATION
REMOTE_D1_MUTATION                  = NONE
WOOCOMMERCE_PROVIDER_REQUEST        = NOT_RUN
LARK_MUTATION                       = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

The preceding Meta Lark merge-closeout task is preserved verbatim at:

```text
docs/archive/current-task-before-woocommerce-final-one-command-rollout-2026-07-28.md
```

## Objective

Prepare the complete Chemistry K WooCommerce Integration Workspace rollout so that, after Repository
merge, only one terminal command remains:

```bash
CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
node scripts/woocommerce-final-one-command.mjs --execute
```

The command owns the complete guarded chain:

```text
Remote contract and migration preflight
→ exact Queue ID resolution
→ isolated Migration 0017 backup/apply when pending
→ additive Lark 14-table schema repair
→ second D1 backup before Business processing
→ safe all-WooCommerce-flags-false deployment
→ full reconciliation to D1 and Lark
→ Coverage and 14-table parity proof
→ same-operation idempotent rerun
→ incremental UAT from conservative D1 watermark
→ scheduled active deployment
→ SHA-chained final evidence
```

## Runtime implementation

- WooCommerce Connector and Queue job are active only through exact reviewed gates.
- Accepted triggers are `manual_uat` and `scheduled` only.
- Scheduled operation identity is deterministic per Bangkok local date/time.
- Scheduled processing is incremental only; Full reconciliation remains operator-owned.
- Orders/Products D1 watermarks use the older value to over-fetch safely and avoid skipped revisions.
- Shared Reliability, lock renewal, retry/DLQ, resumable work, D1-first writer, Coverage and Lark sync
  engines remain unchanged and authoritative.
- Continuations preserve operation ID, Work key, generation, requested time, trigger and source window.

## Final command safeguards

- Reads exact clean Git HEAD automatically.
- Resolves exact Cloudflare Main Queue ID automatically.
- Allows only pending Migrations `0017` and `0018`.
- If `0017` is pending, exports D1 backup and applies only `0017` from an isolated migration directory.
- Never applies Chatwoot Migration `0018`.
- Lark repair creates only missing Tables/Fields; no delete, rename or type-change.
- Deploys safe configuration before any WooCommerce Business operation.
- Automatically restores all WooCommerce execution flags false after a later failure when safe config is available.
- Schedule is enabled only after Full, parity, rerun and incremental acceptance pass.

## Acceptance

```text
WooCommerce D1 schema             = 17 tables / 13 indexes
Work lifecycle                    = completed
Commerce phase                    = complete
Coverage datasets                 = 6 / accepted / failed_rows=0
D1-Lark parity                    = 14 / 14 tables
Same-operation rerun              = no Business/Coverage row-count drift
Incremental UAT                   = completed + parity accepted
Final Worker                      = WooCommerce Connector/D1/Lark/Schedule only
Production                        = blocked
```

## Verification already completed before final main alignment

Implementation head `022535fcf03d4d2b8ed247a0f8c345b16f345958` passed Branch Verification
`#744` / run `30293625854` with every workflow step successful.

```text
SYNTAX_ARCHITECTURE_HYGIENE       = PASS
FOCUSED_STAGED_TIKTOK             = PASS
NODE_AND_WORKERS_RUNTIME           = PASS
REPORT_RELIABILITY                = PASS
DEPENDENCY_AUDIT                  = PASS / 0 vulnerabilities
WRANGLER_DRY_RUN                  = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT              = 8663754742
DIAGNOSTICS_DIGEST                = sha256:aa30e9a3e243e48f484ebf7fc4bab312550c420751547857ebbe23bf7878cb41
REMOTE_ACTION_COUNT               = 0
```

## Remaining Repository gate

Align the implementation with then-current `main`, run exact-final-head Branch Verification, confirm
zero unresolved review threads and merge PR #133 by Squash. Repository merge authorizes no Remote action
inside GitHub; the terminal command above remains the sole final operational step.
