# Current Task — Meta Ads D1 Report Projection & Exact Recovery Continuation v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CI_PASS
CURRENT_PROGRAM                     = META_ADS_D1_REPORT_PROJECTION_RECOVERY_V1
BRANCH                              = hotfix/meta-ads-d1-report-projection-v1
EXACT_BASE                          = 5b35861553d2a3074409635458d323b33641d994
VERIFIED_IMPLEMENTATION_HEAD        = 9091d681a3df9fbe7480a10af0dfad12fb7ea897
PR                                  = 512
BRANCH_VERIFICATION_RUN             = 31016060506
BRANCH_VERIFICATION_NUMBER          = 2236
META_END_TO_END_RUN                 = 31016058772
META_END_TO_END_NUMBER              = 443
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
NOTIFICATION_RUNTIME_STATE          = active
NOTIFICATION_ADMISSION_ENABLED      = false
SCHEDULE_ACTIVATION_APPROVED        = false
PRODUCTION                          = BLOCKED
```

Full contract:

```text
docs/tasks/meta-ads-d1-report-projection-recovery-v1.md
```

## Goal

Correct the existing Shared D1 Paid Ads reader so a reviewed Meta Ads 3D materialization does not return large,
unneeded retained JSON columns from `ads_daily_facts`. Preserve the current aggregation, Stable-key, Coverage,
Top Ads and null/zero contracts. Prepare an exact continuation for the already-attempted Meta Ads 3D recovery
without rerunning either prior Recovery evidence root or sending another Queue message before the new DLQ identity
is fully bound.

## Confirmed runtime incident

The first exact recovery attempt on merged `main@5b35861553d2a3074409635458d323b33641d994`:

- deployed the reviewed Active Report window;
- sent the exact retained Meta Ads 3D job once;
- produced six failed `dashboard_performance_report` Sync Runs;
- failed every run as `D1_ADS_REPORT_READ_FAILED`;
- created no `report_materializations` row and no target Lark materialization;
- exhausted Queue retries into one new DLQ `dlq:2f292f08f5bdc4f12c91b68ceff71e1b`;
- restored and verified the preserved Notification Runtime baseline;
- left zero active Report Work and zero active Report lock.

The original configuration DLQ remains open. The new Queue-exhaustion DLQ also remains open. Neither may be
redriven, closed, deleted or edited until exact continuation succeeds.

## Root-cause assessment

The Shared `D1AdsReportSource` currently performs `SELECT *` for:

- `ads_daily_facts`;
- `ads_entity_state`;
- `data_coverage_runs`.

The Report calculation needs only a bounded scalar projection. In particular, it does not consume retained
`actions_json`, `breakdown_json`, `source_payload_hash` or most operational columns from `ads_daily_facts`.
Meta Ads 1D completed while Meta Ads 3D failed deterministically six times at the D1 read boundary. The leading
repository hypothesis is therefore an oversized broad D1 result projection for the larger 3D detailed-fact set.
This remains a hypothesis until post-merge read-only byte/count evidence or successful exact continuation confirms it.

## Root correction

- replace all three Paid Ads `SELECT *` reads with explicit minimum field projections;
- exclude retained Provider JSON and unrelated operational fields from Report reads;
- preserve the same WHERE clauses, ordering, row limit, report-level selection and aggregation semantics;
- preserve Meta Ads publisher-platform partition aggregation and Google Ads campaign all/all behavior;
- add regressions that fail if broad projections or retained large JSON fields return;
- do not create another Ads Report source, Report engine, D1 writer, Queue framework or recovery framework.

## Exact continuation boundary

Before any further Queue action, collect and bind the new DLQ's exact:

- message ID and Queue name;
- replay-payload SHA-256;
- platform/window/report-setting/requested-at identity;
- operation metadata and historical work key;
- generation, Queue-attempt and DLQ-delivery counts;
- current D1/Lark target emptiness and zero active Work/Lock.

The old recovery evidence root is immutable and must not be rerun. A continuation may send only the exact original
job once after the projection fix is merged and deployed under a reviewed Active Report window. Replay and closure
remain separate, evidence-gated stages.

## Out of scope

- rerunning `outputs/meta-ads-3d-exact-recovery-5b35861553d2`;
- rerunning the prior Run All block or retained handoff;
- generic Queue resend or generic DLQ redrive;
- Provider/source refresh;
- manual D1/Lark materialization repair;
- changing Report ID, requested-at, period or source watermark;
- closing either DLQ before exact materialization and replay proof;
- Dashboard legacy display-name backfill;
- Notification Admission, Schedule or Production activation.

## Acceptance criteria

1. The Ads fact query selects only fields consumed by metric aggregation, uniqueness and Top Ads.
2. The fact query excludes `actions_json`, `breakdown_json`, `source_payload_hash` and every `SELECT *`.
3. Entity and Coverage reads also use explicit minimum projections.
4. Meta Ads publisher-platform SUM-before-ratio and deterministic Top Ads regressions remain passing.
5. Google Ads campaign all/all and no-fabricated-Top-Ads regressions remain passing.
6. Full Unit/Workers and Report reliability gates remain passing.
7. Repository implementation performs no Remote D1/Lark mutation, deployment, Queue/DLQ action or Provider call.
8. Post-merge continuation remains impossible until exact new-DLQ metadata is collected and validated.
9. Notification Admission, Schedule and Production remain disabled.

## Implementation result

Implemented on Draft PR #512 without Remote execution:

- explicit scalar fact projection for `ads_daily_facts`;
- explicit minimal entity and Coverage projections;
- focused regressions forbidding broad projections and retained large JSON columns;
- no Remote action performed.

Exact implementation Head `9091d681a3df9fbe7480a10af0dfad12fb7ea897` passed:

```text
Branch Verification #2236 / run 31016060506
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

Meta End-to-End #443 / run 31016058772
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
2. run one SELECT-only exact new-DLQ/row-byte inspector;
3. confirm or reject the broad-projection hypothesis;
4. implement/use the existing recovery authority as an exact continuation, not a rerun;
5. materialize Meta Ads 3D once, verify D1/Lark integrity, then perform one exact replay;
6. restore Notification Runtime baseline and close both bound forensic DLQs only after proof;
7. resume only remaining Report windows under fresh readiness and evidence;
8. repair `__mkt_legacy_display_name_single_select_v2` through the Shared Lark writer/backfill after 28-window closure.
