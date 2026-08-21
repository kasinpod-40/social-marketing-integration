# Current Task — Facebook Organic Live Rematerialization Rollout v1

## Status

```text
TASK_STATUS                         = COMPLETE
CURRENT_PROGRAM                     = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
AGGREGATION_REPAIR_PR               = 662_MERGED
AGGREGATION_REPAIR_SHA              = 0d8cac334405d755a108f2adea65e9cc6f4cd646
ROLLOUT_PR                          = 663_MERGED
JSON_BOOLEAN_HOTFIX_PR              = 665_MERGED
DLQ_SCOPE_GUARD_PR                  = 667_MERGED
LIVE_EXECUTION_HEAD                 = d7492b0dd30f81953c21355016f26a06e3a308fc
LIVE_DECISION                       = FACEBOOK_ORGANIC_1_3_7_30_REMATERIALIZED_VERIFIED
INTEGRATION_WORKSPACE               = COMPLETE
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Completion summary

Facebook Organic Report 1D/3D/7D/30D was rematerialized successfully in the Integration Workspace on 2026-08-21 from clean exact `main == origin/main == d7492b0dd30f81953c21355016f26a06e3a308fc`.

The rollout reused the existing Shared Report/D1/Lark/Queue/runtime system. It did not refetch Facebook Provider data, did not manually patch Lark, did not change Production, and did not touch PR #661.

Final acceptance evidence:

- 1D / 3D / 7D / 30D all completed using the existing stable Facebook Report IDs.
- Every window has 25 Report metrics with D1↔Lark `mismatchCount=0`.
- Every window has one Lark snapshot, 25 metric rows, 5 Top Content rows, 0 Top Ads rows and 0 duplicate metric keys.
- Observed latest aggregates are numeric on every window: Likes `18477`, Comments `84`, Shares `2574`, Engagement `21135`.
- Missing source members were preserved; `sourceNullsFabricatedAsZero=false` on every window.
- 30D period Likes/Comments/Shares/Engagement remain `null` under the existing authoritative-baseline contract and are not a closeout failure.
- Final Facebook safety state: active Report work `0`, locks `0`, target-scoped open Report DLQ `0`, open critical alerts `0`.
- Global historical Report DLQ remains 8 because the retained rows are Meta Ads + Google Ads forensic evidence. They were not replayed, redriven, resolved, discarded or deleted.
- Runtime preservation passed: pre/post flag fingerprint identical, `exactFlagRestoration=true`, `changedFlagCount=0`.
- Queue messages `4`; Provider requests `0`; manual Lark patches `0`; customer Production mutations `0`.
- Private D1 backup was captured before first Queue mutation.

## Final report checksums

```text
1D  3e68b4ad54179243bdcd05d6d3ba7d96590c7b818b5743ac4b2a7b86f92ead9b
3D  25e1566bfaaa24f52a99d80941fe67ef725748a79bac2b51cffcce455bb6108e
7D  71c06b5c07a07a32a23b150269fee52d0294b00e631ddc0e9a1fd2d0d5013d67
30D 732a8a65b695eb18a83a8b8090c7cfb6db7413f96e009a55d271fdfd8e6b3dac
```

## Retained closeout authority

Detailed final evidence and incident history are recorded at:

```text
docs/project-brain/facebook-organic-live-rematerialization-closeout-2026-08-21.md
```

Local terminal evidence reviewed for the closeout:

```text
facebook-organic-live-rollout-20260821T080007Z.txt
SHA-256 = 11351c13d2be72341565662763e4b0fb38dfa0c9351f145c1f515e73c1ff769e
```

## Terminal rule

This workstream is closed. Do **not** run `scripts/facebook-organic-live-rematerialization-rollout.mjs --execute` again. The successful summary is terminal evidence; retained earlier attempts and the eight unrelated Paid Ads DLQ rows remain forensic evidence.

Any future Facebook Report work must start as a new explicitly-scoped task from the then-current `main` rather than reopening this rollout.
