# Current Task — Report Source Readiness Contract Repair v1

## Status

```text
TASK_STATUS                         = HOTFIX_IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = REPORT_SOURCE_READINESS_CONTRACT_REPAIR_V1
BRANCH                              = hotfix/report-source-readiness-contract-v1
EXACT_BASE                          = 6b88fd9eb05b25a7e3a3e7de9930193bab6c1ace
SOURCE_RECONCILIATION               = COMPLETE_READ_ONLY
PROVIDER_REQUEST_APPROVED           = false
QUEUE_ACTION_APPROVED               = false
REMOTE_D1_MUTATION_APPROVED         = false
REMOTE_LARK_MUTATION_APPROVED       = false
WORKER_DEPLOYMENT_APPROVED          = false
SCHEDULE_ACTIVATION_APPROVED        = false
NOTIFICATION_ADMISSION_ENABLED      = false
PRODUCTION                          = BLOCKED
```

Full decision record:

```text
docs/project-brain/report-source-readiness-contract-repair-v1.md
```

## Goal

Repair the existing Shared Report source-readiness and D1 reader contracts so completed validated facts can be
materialized without deleting forensic alerts, replaying Providers, copying Lark rows into D1, or creating a
second Report/Reliability/Queue/Coverage stack.

The business sequence after this repository hotfix is:

```text
Source readiness repair
→ existing-data Report materialization (1D / 3D / 7D / 30D)
→ incremental catch-up from confirmed watermarks
→ approved Integration Workspace daily schedule activation
```

## Confirmed root causes

1. Historical Connector critical alerts were counted as current Report incidents.
2. Coverage selection used the latest arbitrary row instead of the dataset required by each Report contract.
3. Paid Ads readiness and the Shared D1 reader required `account/ad + none/none` even though:
   - Meta Ads stores validated `ad` facts partitioned by `publisher_platform=*`;
   - Google Ads stores validated `campaign` facts at `all/all`.
4. Facebook Organic has Account Daily authority but no proven Content observations in canonical D1; missing
   Content metrics must remain N/A and Top Content must remain empty.
5. TikTok Ads is still planned and must remain skipped.

## Required shared changes

- scope blocking alerts to active/current `dashboard_performance_report` execution authority;
- retain historical Connector alerts in readiness evidence without deleting or resolving them;
- select Coverage by exact platform Report datasets;
- aggregate one validated Paid Ads source grain without double counting partitions;
- allow Google Ads Account summary from Campaign facts while keeping Top Ads not observed;
- allow Facebook Account-scope readiness while Content performance remains N/A;
- preserve exact Notification Runtime baseline and keep Notification Admission false.

## Implementation boundaries

Use the existing implementations only:

- Report platform adapter registry;
- reviewed Report readiness/closeout binding;
- `D1OrganicReportSource`;
- `D1AdsReportSource`;
- `D1ChatwootReportSource`;
- existing Report materialization, Reliability, Queue, lock, DLQ and Coverage contracts.

Do not create a new Report engine, Reliability framework, Queue framework, D1 writer, Lark sync engine, Coverage
engine, wrapper chain, source-loader monkey patch, manual retained handoff, fabricated metric, or replacement
operation.

## Required regressions

- Instagram and WooCommerce remain ready with completed facts plus historical Connector alerts.
- Chatwoot selects `chatwoot.conversation_daily` / `chatwoot.account_daily`, not an arbitrary recent-window row.
- Meta Ads aggregates detailed `publisher_platform=*` D1 facts and can produce Top Ads from D1.
- Google Ads aggregates Campaign daily facts without double counting and does not fabricate Top Ads.
- Current Report work/lock/DLQ/critical incident still blocks.
- Historical Connector alerts remain visible but do not block.
- Facebook Account scope is allowed while Content metrics/Top Content remain N/A.
- TikTok Ads remains planned/skipped.
- Notification Runtime flags remain true and Notification Admission remains false.

## Repository verification

```bash
npm ci
npm run check
node --test \
  tests/scripts/report-channel-remote-readiness.test.js \
  tests/scripts/report-runtime-closeout-reviewed-binding.test.js \
  tests/connectors/d1-ads-report-source.test.js \
  tests/connectors/d1-chatwoot-report-source.test.js \
  tests/application/multichannel-report-runtime.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Post-merge boundary

Repository merge alone authorizes no Provider, Queue, D1, Lark, Worker, Schedule or Production mutation.

Post-merge execution must use exact merged-main Finalizer and SELECT-only readiness evidence, then the existing
reviewed retained-handoff builder. The original notification smoke test remains permanently forbidden from blind
rerun:

```text
scripts/lark-notification-runtime-smoke-test-exact-terminal.mjs --execute
```

Poll-only notification recovery remains a separate authority and is not invoked by this task.
