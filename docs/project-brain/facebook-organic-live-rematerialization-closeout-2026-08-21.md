# Facebook Organic Live Rematerialization Closeout — 2026-08-21

## Final status

```text
STATUS                              = COMPLETE
PROGRAM                             = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
EXECUTION_HEAD                      = d7492b0dd30f81953c21355016f26a06e3a308fc
EXECUTION_DECISION                  = FACEBOOK_ORGANIC_1_3_7_30_REMATERIALIZED_VERIFIED
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
PLATFORM                            = facebook
CAPABILITY                          = organic
PERIOD_END                          = 2026-08-20
SOURCE_WATERMARK                    = 2026-08-20T12:10:55+0000
PROVIDER_REQUESTS                   = 0
QUEUE_MESSAGES                      = 4
LARK_MANUAL_PATCHES                 = 0
CUSTOMER_PRODUCTION_MUTATIONS       = 0
PRODUCTION                          = BLOCKED
```

## Root causes closed before live execution

1. Shared Organic aggregation repair merged in PR #662 at `0d8cac334405d755a108f2adea65e9cc6f4cd646` so observed Facebook Likes, Comments, Shares and Engagement are not erased by unrelated historical null members while source null evidence remains preserved.
2. Exact-runtime-preserving Facebook 1D/3D/7D/30D rollout operator merged in PR #663.
3. Cloudflare Worker JSON Boolean binding readback was fixed in PR #665.
4. Historical open Report DLQ was classified read-only: eight retained rows belonged to Meta Ads 1D/3D/7D/30D and Google Ads 1D/3D/7D/30D, not Facebook. They remain immutable forensic evidence and were not resolved, discarded, replayed or redriven.
5. Shared Report closeout DLQ safety was corrected in PR #667 so `open_report_dlq` is target-platform scoped while malformed or unscoped payloads still fail closed. PR #667 merged at execution head `d7492b0dd30f81953c21355016f26a06e3a308fc` after Branch Verification success.

## Final controlled Integration execution

The exact merged release was executed one time from a clean `main == origin/main == d7492b0dd30f81953c21355016f26a06e3a308fc` runner.

Preflight proved:

- Lark inventory: 6 required tables, metadata mutation count 0.
- Pending D1 migrations: 0.
- Global retained open Report DLQ: 8 historical other-platform rows.
- Facebook-scoped Report DLQ guard: 0.
- Active Facebook Report work: 0.
- Active Facebook Report locks: 0.
- Open Facebook Report critical alerts: 0.
- D1 backup created before Queue mutation; backup itself performed 0 remote mutations.
- Provider refresh disabled.
- Production remained blocked.

## Verified Report windows

| Window | Report ID period | Metrics | D1↔Lark mismatches | Top Content | Duplicate metric keys |
| --- | --- | ---: | ---: | ---: | ---: |
| 1D | 2026-08-20..2026-08-20 | 25 | 0 | 5 | 0 |
| 3D | 2026-08-18..2026-08-20 | 25 | 0 | 5 | 0 |
| 7D | 2026-08-14..2026-08-20 | 25 | 0 | 5 | 0 |
| 30D | 2026-07-22..2026-08-20 | 25 | 0 | 5 | 0 |

Every window has exactly one Report snapshot and 25 Lark metric rows. Facebook Organic correctly has 0 Top Ads rows.

Final stable report IDs/checksums:

```text
1D  integration_workspace:facebook:rolling:1d:chemistry_k:rolling_days:2026-08-20:2026-08-20:facebook-organic-v1
    3e68b4ad54179243bdcd05d6d3ba7d96590c7b818b5743ac4b2a7b86f92ead9b
3D  integration_workspace:facebook:rolling:3d:chemistry_k:rolling_days:2026-08-18:2026-08-20:facebook-organic-v1
    25e1566bfaaa24f52a99d80941fe67ef725748a79bac2b51cffcce455bb6108e
7D  integration_workspace:facebook:rolling:7d:chemistry_k:rolling_days:2026-08-14:2026-08-20:facebook-organic-v1
    71c06b5c07a07a32a23b150269fee52d0294b00e631ddc0e9a1fd2d0d5013d67
30D integration_workspace:facebook:rolling:30d:chemistry_k:rolling_days:2026-07-22:2026-08-20:facebook-organic-v1
    732a8a65b695eb18a83a8b8090c7cfb6db7413f96e009a55d271fdfd8e6b3dac
```

## Aggregate repair proof

All four windows materialized the same current observed aggregate totals:

```text
latestTotalLikes       = 18477
latestTotalComments    = 84
latestTotalShares      = 2574
latestTotalEngagement  = 21135
```

Period subtotals are present where authoritative baseline coverage supports them. The 30D period Likes/Comments/Shares/Engagement values remain `null`; this is not a rollout failure because the contract requires the observed `latestTotal*` aggregates to be numeric while preserving unavailable source members as null. `sourceNullsFabricatedAsZero=false` for every window, so no missing source value was fabricated as zero.

## Runtime restoration proof

```text
previousVersionId          = da0777dc-447b-452b-b86c-3e96637375c8
baselineDeploymentVersion  = 1e8ec36a-79ab-4e98-b5e5-66a56bc21180
overlayRequired            = false
finalVersionId             = 1e8ec36a-79ab-4e98-b5e5-66a56bc21180
preFlagFingerprint         = 1932b9064a97daa40a9c0851ca2612456c0921dbda4779bba12cb6e658147267
postFlagFingerprint        = 1932b9064a97daa40a9c0851ca2612456c0921dbda4779bba12cb6e658147267
exactFlagRestoration       = true
changedFlagCount           = 0
```

No temporary Report overlay was needed because the required Report runtime was already active. The new current-main baseline deployment preserved the complete captured execution flag vector exactly.

## Final safety state

```text
coverageStatus                = complete
activeReportWorkCount          = 0
activeReportLocks              = 0
openReportDlq                  = 0   # target-scoped Facebook guard
openReportCriticalAlerts       = 0
providerRequests               = 0
queueMessages                  = 4
larkManualPatches              = 0
customerProductionMutations    = 0
production                     = BLOCKED
```

The eight retained Meta Ads / Google Ads historical Report DLQ rows remain forensic evidence and are intentionally outside the Facebook-scoped guard. Do not replay, redrive, resolve or delete them as part of this closeout.

## Retained evidence

Local terminal evidence supplied for closeout review:

```text
facebook-organic-live-rollout-20260821T080007Z.txt
SHA-256 = 11351c13d2be72341565662763e4b0fb38dfa0c9351f145c1f515e73c1ff769e
```

Operator summary path retained in the execution runner:

```text
/Users/wasanjantawong/Git/social-marketing-integration-facebook-live-d7492b0d/outputs/facebook-organic-live-rematerialization-rollout/facebook-organic-live-rematerialization-summary.json
```

The execution runner and earlier failed-attempt runners are evidence. Do not blindly rerun `--execute`; the successful summary makes this rollout terminally complete.
