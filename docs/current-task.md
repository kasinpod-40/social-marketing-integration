# Current Task — Meta History Customer Runtime Config Recovery v6

## Status

```text
TASK_STATUS                         = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                     = META_HISTORY_CUSTOMER_RUNTIME_CONFIG_RECOVERY_V6
BASE_MAIN_SHA                       = 890da713eedb8ae54ea1550951f78b9530e22c87
BRANCH                              = hotfix/meta-history-2026-customer-identity-materialization-v6
IMPLEMENTATION_PR                   = #359 / DRAFT / DO_NOT_MERGE
ORIGINAL_IMPLEMENTATION_PR          = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR         = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR         = #342 / SQUASH_MERGED
SHARED_QUEUE_AUTHORITY_PR           = #343 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_HOTFIX_PR        = #348 / SQUASH_MERGED
EXPLICIT_SAFE_FLAGS_HOTFIX_PR       = #353 / SQUASH_MERGED
PLANNED_OPERATION_COUNT             = 6
SEVENTH_ATTEMPT_CURRENT_OPERATIONS  = 0
SEVENTH_ATTEMPT_BUSINESS_WRITES     = 0
SEVENTH_ATTEMPT_QUEUE_MESSAGES      = 0
SEVENTH_ATTEMPT_PROVIDER_VALIDATION = GET_ONLY_PASSED
WORKER_FLAGS_AFTER_ATTEMPT          = ALL_FALSE_VERIFIED
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
NEXT_STEP                           = EXACT_HEAD_VERIFICATION_REVIEW_AND_MERGE
```

## Seventh live attempt retained

The Terminal attempt on `main@2ddc9cef8262f768d1b589e5b7bc069d861d80a4` passed the local gates,
Cloudflare readiness, Remote all-false verification and the fresh ordered Meta GET-only identity validation.
It then entered the first required Facebook July operation and stopped before D1 preflight could begin:

```text
stage    operation-facebook-2026-07-01-2026-07-31
code     META_D1_ONLY_SOURCE_MAPPING_INVALID
message  Meta D1-only config requires a pinned Meta Graph API version
```

The D1 target loader rejected the generated Wrangler config before Remote D1 inspection, backup, Worker
deployment or Queue admission. The outer closeout verified the Worker all-false state and reported
`emergencyRestoreRequired=false`.

```text
Current Meta operation accepted       0
D1 backup                             0
Worker deployment                     0
Queue messages                        0
Remote D1 Business writes             0
Remote Lark writes                     0
Schedule mutation                      0
Production                             blocked
```

Retain every prior evidence directory. Do not delete, copy or edit prior output.

## Root cause

The public command supplied the approved Chemistry K API version and non-secret identity mappings through
the process environment. The read-only operator used that environment and passed.

The D1/Lark rollout operators do not trust process-only mappings for deployment. They validate and deploy
from the reviewed generated Wrangler config. The finalizer-created Safe config preserved the original local
Wrangler vars and did not materialize:

```text
META_GRAPH_API_VERSION
META_FACEBOOK_PAGE_ID
META_INSTAGRAM_ACCOUNT_ID
META_AD_ACCOUNT_MAPPINGS
```

Therefore the same execution had two configuration authorities: read-only phases saw the approved customer
mapping, while D1/Lark phases saw the stale or incomplete local config.

## Correction

A Shared non-secret Meta history runtime authority now owns the exact Integration Workspace customer values:

```text
MKT_ENV                     development
MKT_CUSTOMER_PROFILE        integration_workspace
MKT_CONNECTION_CUSTOMER_KEY chemistry_k
META_GRAPH_API_VERSION      v25.0
Facebook mapping            exact approved Chemistry K Page
Instagram mapping           exact approved Chemistry K Professional Account
Meta Ads mappings           chemistry_k2 and chemistry_k3
Legacy single Ad mapping    explicitly empty
```

The implementation:

1. materializes this authority in the public Terminal child environment;
2. closes every required execution flag to explicit `false`;
3. creates a private `0600` runtime Wrangler config beside the reviewed Safe config under ignored `outputs/`;
4. replaces every stale duplicate mapping and inserts every missing value;
5. validates the resulting config contains only the exact approved values;
6. gives the same runtime config to D1 and Lark launchers;
7. retains credentials only in `.dev.vars` / Worker Secret storage and never writes them to config or evidence.

The runtime config remains inside the Repository boundary required by the operators without dirtying the
Working Tree. D1 and Lark use one identical content authority.

## Main alignment

The branch is based directly on `main@890da713eedb8ae54ea1550951f78b9530e22c87` and retains the concurrent
Chatwoot streamed D1-backup integrity hotfix unchanged. The Meta Hotfix changes eight scoped files only.

## Acceptance criteria

```text
Terminal overrides stale local non-secret mappings        required
META_GRAPH_API_VERSION=v25.0 in child environment          required
META_GRAPH_API_VERSION=v25.0 in reviewed runtime config    required
Facebook / Instagram exact mapping in runtime config       required
Both Meta Ads aliases in runtime config                    required
Legacy META_AD_ACCOUNT_ID                                  empty
Stale duplicate mapping values                             forbidden
Runtime config location                                    repository/outputs only
Runtime config permission                                  0600
D1 and Lark runtime config content                         identical authority
Secrets in runtime config/evidence                         forbidden
Caller .dev.vars mutation                                  forbidden
Terminal / D1 / Lark executable mode                       100755
Meta End-to-End Verification                               PASS required
Branch Verification                                        PASS required
Remote action during implementation/CI                     0
```

## Public command boundary

Do not rerun the Terminal while this Hotfix is unmerged. After exact-head CI, review, Squash Merge and a
docs-only execution handoff, the only public entrypoint remains:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke D1/Lark child launchers or send Queue messages manually.

Detailed recovery contract: `docs/tasks/meta-history-customer-runtime-config-recovery-v6.md`.
