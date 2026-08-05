# Current Task — Meta Ads Report Entity Bind Chunk Hotfix v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = META_ADS_REPORT_ENTITY_BIND_CHUNK_V1
BRANCH                              = hotfix/meta-ads-report-entity-bind-chunk-v1
EXACT_BASE                          = 56f7354ab9077e045318148cc5d8b76030a987a6
VERIFIED_IMPLEMENTATION_HEAD        = be42c135b9cd4a31e96853dfee8a6480a261b2ec
PR                                  = 513
BRANCH_VERIFICATION_RUN             = 31017237500
BRANCH_VERIFICATION_NUMBER          = 2238
META_END_TO_END_RUN                 = 31017236669
META_END_TO_END_NUMBER              = 445
PRIOR_PROJECTION_FIX                = MERGED_PR_512
PLATFORM                            = meta_ads
WINDOW                              = 3D
REPORT_ID                           = integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
RECOVERY_REQUESTED_AT               = 1785938483493
FAILED_SYNC_RUN_COUNT               = 6
FAILED_SYNC_CODE                    = D1_ADS_REPORT_READ_FAILED
ORIGINAL_DLQ                        = terminal:e408707c9c2d383e04a3e213a7be45a0
NEW_DLQ                             = dlq:2f292f08f5bdc4f12c91b68ceff71e1b
TARGET_MATERIALIZATION_COUNT        = 0
ACTIVE_REPORT_WORK                  = 0
ACTIVE_REPORT_LOCK                  = 0
WORKER_BASELINE_RESTORED            = true
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/meta-ads-report-entity-bind-chunk-v1.md
```

## Goal

Fix the existing Shared Paid Ads reader so Top Ads entity hydration never exceeds the reviewed D1 maximum of 100
bound parameters. Preserve the merged explicit scalar projections from PR #512 and all Report aggregation,
Coverage, Stable-key and null/zero semantics.

## Confirmed repository defect

After selecting the reviewed ranking facts, `D1AdsReportSource` creates one unique Ad ID list and previously sent
all IDs through one statement:

```text
customer_key + platform + account_key + every external Ad ID
```

Three bindings are fixed. Therefore a single statement can safely contain at most 97 Ad IDs under the existing
100-bound D1 contract. The prior code had no chunking and could exceed that boundary for a larger Meta Ads period.
The six retained 3D failures are consistent with this defect, but the exact live unique-Ad count still requires one
post-merge SELECT-only inspector before calling it the proven runtime root cause.

## Root correction

- retain the explicit fact/entity/Coverage projections merged in PR #512;
- split sorted unique Ad IDs into deterministic chunks of at most 97;
- execute entity reads sequentially with three fixed bindings per query;
- preserve one entity row map and identical Top Ads output;
- expose additive sanitized `entityQueryCount` and `entityQueryMaxIds` read evidence;
- add a 98-Ad regression proving two calls with 100 and 4 total bindings;
- keep Google Ads no-Top-Ads behavior at zero entity queries.

## Exact recovery boundary

No Queue action is authorized by this implementation. Both retained DLQs remain open. The failed recovery root and
Run All handoff must not be rerun. After merge, one SELECT-only inspector must bind the new DLQ identity and count
1D/3D unique Ads. Only then may a separate exact continuation submit the original Meta Ads 3D job once.

## Out of scope

- Queue send/redrive or DLQ closure;
- Worker deployment or Remote D1/Lark mutation;
- Provider/source refresh;
- replacement Report identity or requested-at;
- manual materialization repair;
- polling fail-fast changes;
- Dashboard legacy display-name backfill;
- Notification Admission, Schedule or Production activation.

## Acceptance criteria

1. Every entity lookup uses at most 100 total bindings.
2. A 98-Ad input becomes two deterministic queries containing 97 and 1 IDs.
3. Entity hydration and Top Ads output remain complete and deterministic.
4. Meta Ads aggregation and projection regressions remain passing.
5. Google Ads continues to issue zero entity queries and no fabricated Top Ads.
6. Full Unit/Workers and Report reliability gates pass.
7. Repository implementation performs zero Remote action.
8. Notification Admission, Schedule and Production remain disabled.

## Implementation result

Implemented on Draft PR #513 without Remote execution:

- deterministic 97-ID sequential entity chunks;
- additive entity-query evidence;
- focused 98-Ad/100-bound regression;
- no Remote action performed.

Exact implementation Head `be42c135b9cd4a31e96853dfee8a6480a261b2ec` passed:

```text
Branch Verification #2238 / run 31017237500
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

Meta End-to-End #445 / run 31017236669
Diff hygiene                                 PASS
Syntax architecture and repository hygiene  PASS
Focused Meta workstream tests                PASS
Unit and Workers runtime tests               PASS
Report reliability regression               PASS
Dependency audit                             PASS
Wrangler dry run                             PASS
```

## Required verification

```bash
npm ci
npm run check
node --test tests/connectors/d1-ads-report-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge sequence

1. synchronize clean exact merged `main`;
2. run one SELECT-only unique-Ad/new-DLQ inspector;
3. classify the exact D1 read root cause;
4. create/use an exact recovery continuation without repeating either old evidence root;
5. submit only the original Meta Ads 3D job once, then verify/replay/restore/close under separate evidence gates;
6. resume only remaining Report windows;
7. repair `__mkt_legacy_display_name_single_select_v2` after 28-window closure.
