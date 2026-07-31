# Current Task — Meta History Runtime Safe Config Recovery v7

## Status

```text
TASK_STATUS                          = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                      = META_HISTORY_RUNTIME_SAFE_CONFIG_RECOVERY_V7
BASE_MAIN_SHA                        = 761123b079a17ce8be4683d548f81d5b87802c8c
BRANCH                               = hotfix/meta-history-2026-runtime-safe-config-v7
IMPLEMENTATION_PR                    = PENDING
ORIGINAL_IMPLEMENTATION_PR           = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR          = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR          = #342 / SQUASH_MERGED
SHARED_QUEUE_AUTHORITY_PR            = #343 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_HOTFIX_PR         = #348 / SQUASH_MERGED
EXPLICIT_SAFE_FLAGS_HOTFIX_PR        = #353 / SQUASH_MERGED
CUSTOMER_RUNTIME_CONFIG_HOTFIX_PR    = #359 / SQUASH_MERGED
PLANNED_OPERATION_COUNT              = 6
EIGHTH_ATTEMPT_CURRENT_OPS           = 0
EIGHTH_ATTEMPT_D1_BACKUP             = 0
EIGHTH_ATTEMPT_WORKER_DEPLOY         = 0
EIGHTH_ATTEMPT_QUEUE_MESSAGES        = 0
EIGHTH_ATTEMPT_BUSINESS_WRITES       = 0
EIGHTH_ATTEMPT_PROVIDER_GATE         = GET_ONLY_PASSED
WORKER_FLAGS_AFTER_ATTEMPT           = ALL_FALSE_VERIFIED
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
NEXT_STEP                            = EXACT_HEAD_VERIFICATION_REVIEW_AND_MERGE
```

## Eighth live attempt retained

The Terminal attempt on `main@761123b079a17ce8be4683d548f81d5b87802c8c` passed the retained local,
Cloudflare, Remote-safe and ordered GET-only customer identity gates. It entered the first required Facebook
July operation and stopped while loading the D1 target:

```text
stage    operation-facebook-2026-07-01-2026-07-31
code     META_D1_ONLY_CONFIG_INVALID
message  Meta D1-only config requires MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
```

The failure occurred inside `buildMetaD1OnlyConfigWindow()` while validating the private runtime Wrangler
config. It happened before Remote D1 inspection, backup, Worker deployment or Queue admission.
`emergencyRestoreRequired=false`, and the outer closeout verified the Worker all-false state.

```text
Current operation accepted       0
Remote D1 inspection             0
D1 backup                        0
Worker deployments               0
Queue messages                   0
Remote D1 Business writes        0
Remote Lark writes               0
Schedule mutations               0
Production                       blocked
```

Retain every prior evidence directory. Do not delete, copy or edit prior output.

## Root cause

The public Terminal already materialized every `META_D1_ONLY_REQUIRED_FALSE_FLAGS` key as string `false` in
the child process environment. PR #359 subsequently materialized only the customer/API/mapping authority in
the private D1/Lark Wrangler config.

The D1 and Lark operators intentionally validate deployment config text independently of process environment.
Therefore the same execution had:

```text
child process environment     all required Safe flags explicit false
private runtime config        customer mappings exact, Shared Safe flags incomplete
```

The first missing config key surfaced as `MKT_WOOCOMMERCE_D1_WRITE_ENABLED`, but the defect applies to the
complete Shared required-false set. Fixing one named flag would leave the next missing flag waiting behind it.

## Correction

The existing Shared runtime authority now owns both:

1. exact non-secret Chemistry K customer/API mappings; and
2. every key exported by `META_D1_ONLY_REQUIRED_FALSE_FLAGS`, each with string value `false`.

The runtime-config materializer must:

```text
read the Head-bound private Safe config
→ replace stale string values
→ replace stale boolean true/false values with reviewed strings
→ insert every missing Customer/Safe key
→ validate all observed occurrences are exact strings
→ write private 0600 runtime config under ignored outputs/
→ give identical authority to D1 and Lark operators
```

The source of the Safe flag list remains the existing Meta D1-only operator contract. No second manually
maintained list and no connector-specific one-off flag patch is allowed.

## Acceptance criteria

```text
META_D1_ONLY_REQUIRED_FALSE_FLAGS source              Shared operator export
Every required flag in child Environment             string false
Every required flag in D1 runtime config              string false
Every required flag in Lark runtime config            string false
Missing config flags                                  inserted
Existing string true                                  replaced
Existing boolean true/false                           replaced with reviewed string
Customer/API mappings                                 unchanged exact authority
Runtime config rerun                                  byte-identical
Legacy META_AD_ACCOUNT_ID                             empty
Credentials in generated config/evidence              0
.dev.vars mutation                                    0
Remote action during implementation/CI                0
Meta End-to-End Verification                          PASS required
Branch Verification                                   PASS required
full Unit/Workers, Report, audit, Wrangler dry-run     PASS required
```

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

## Public command boundary

Do not rerun the Terminal while this Hotfix is unmerged. After exact-head CI, review, Squash Merge and a
docs-only execution handoff, the only public entrypoint remains:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not modify `.dev.vars`, invoke D1/Lark child launchers or send Queue messages manually.

Detailed recovery contract: `docs/tasks/meta-history-runtime-safe-config-recovery-v7.md`.
