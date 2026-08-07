# Current Task — Reviewed Handoff Mapped Authority Compatibility v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CODE_CI_PASS
CURRENT_PROGRAM                     = REVIEWED_HANDOFF_MAPPED_AUTHORITY_COMPATIBILITY_V1
BRANCH                              = hotfix/reviewed-handoff-mapped-authority-v1
EXACT_BASE                          = 0acb252be84a739f5b0e1aa15d4999b70d9ae950
VERIFIED_CODE_HEAD                  = 491bd1f3f315c654f761199490ea37f928490c54
BRANCH_VERIFICATION_RUN             = 31158078780
BRANCH_VERIFICATION_NUMBER          = 2282
CHATWOOT_1D_RECOVERY                = CLOSED
CHATWOOT_1D_D1_MATERIALIZATION      = 1
CHATWOOT_1D_LARK_SNAPSHOT           = 1
CHATWOOT_1D_LARK_METRICS            = 139
CHATWOOT_OPEN_REPORT_DLQ            = 0
CHATWOOT_OPEN_REPORT_CRITICAL_ALERT = 0
FAILED_FINAL_CLOSEOUT_ROOT          = outputs/chatwoot-post-532-0acb252b/chatwoot-1d-3d-7d-30d-final-closeout
ACTIVE_DEPLOYMENT_ATTEMPTED         = false
QUEUE_ACTION_COUNT                  = 0
WORKER_DEPLOYMENT_COUNT             = 0
PROVIDER_REQUEST_COUNT              = 0
NOTIFICATION_ADMISSION              = false
SCHEDULE_ENABLED                    = false
PRODUCTION                          = BLOCKED
```

## Incident

The current-head retained multichannel handoff builder completed successfully and wrote the canonical per-channel authority map:

```text
closeoutAuthorities.<platformScope>
```

The Chatwoot reviewed multiwindow closeout then stopped before any Remote deployment or Queue action at:

```text
stage = repository-finalizer-and-reviewed-handoff
code  = REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_INVALID
```

The runtime validator still read only the legacy single-channel field:

```text
closeoutAuthority
```

This created a builder/consumer contract mismatch: the builder's own handoff could not be consumed by the current reviewed runtime loader.

The failed closeout evidence root is immutable. Do not rerun, delete, reset or clean it.

## Correction

Keep one shared reviewed handoff contract and one shared runtime validator.

`assertReviewedChannelCloseoutHandoff()` resolves authority in this order:

```text
1. closeoutAuthorities[descriptor.platform]
2. closeoutAuthority legacy fallback
```

All existing authority validation remains strict:

- operator must be an allowed reviewed operator;
- contractVersion must equal `report_runtime_closeout_uat_v1`;
- platformScope must equal the selected descriptor platform;
- capability must equal the selected descriptor capability;
- exact repository Head, readiness, source and window checks remain unchanged.

No new handoff format, wrapper, execution engine or hand-written JSON workaround was added.

## Regression result

The regression builds the retained multichannel handoff using `buildRetainedMultichannelReportHandoff()` and validates the returned handoff object directly, without injecting `closeoutAuthority`, for every non-planned reviewed channel.

It also proves that the legacy single-channel `closeoutAuthority` fallback remains accepted.

## Verification result

Branch Verification #2282 / run `31158078780` passed on exact code Head `491bd1f3f315c654f761199490ea37f928490c54`:

```text
Install locked dependencies                 PASS
Syntax architecture and hygiene             PASS
Focused Report source readiness tests       PASS
Focused Meta history finalizer tests         PASS
Focused Woo completed-state race tests       PASS
Focused Chatwoot final UAT tests              PASS
Focused staged TikTok tests                  PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
Diff whitespace check                        PASS
```

No Remote runtime action occurred during implementation or CI.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/reviewed-handoff-mapped-authority.test.js
node --test tests/scripts/retained-multichannel-report-handoff.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-binding.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run current-head Finalizer under a new evidence root;
3. run fresh SELECT-only readiness for all reviewed non-planned channels;
4. build a brand-new retained multichannel handoff from those exact-head readiness files;
5. run Chatwoot reviewed multiwindow closeout under a brand-new immutable root;
6. require 1D reuse with Queue 0;
7. require fresh 3D/7D/30D materialization + replay with stable D1/Lark integrity;
8. require Worker baseline restore;
9. run fresh Chatwoot readiness and require all 1/3/7/30 windows to become `reuse_or_idempotent_verify`;
10. keep Notification Admission and Schedule disabled and Production blocked.
