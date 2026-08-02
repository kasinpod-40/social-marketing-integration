# Chatwoot Generic Report Materialization v1

## Status

`REPOSITORY_IMPLEMENTATION / DEPENDS_ON_PR_423 / SOURCE_STATUS_UAT_PENDING`

## Objective

Implement the reviewed Chatwoot `customer_service` Report contract through the existing generic Report architecture while keeping the source and catalogs fail-closed until a separately authorized readiness and promotion step.

## Dependency

This branch is stacked on `feat/chatwoot-report-contract-v1` (Draft PR #423). The immutable contract in `packages/config/src/chatwoot-report-contract.js` remains the metric/formula authority.

## In scope

- add `customer_service` as a shared Report capability;
- register Chatwoot with `sourceStatus=uat_pending`;
- add Chatwoot Report Settings for existing presets/custom range;
- implement a bounded D1 Chatwoot source using `chatwoot_conversation_daily_facts`, `chatwoot_account_daily_facts` and completed Coverage;
- calculate 19 summary metrics using sums, eligible counts, weighted duration averages and period-end snapshots;
- create fixed-rank Inbox and Agent dimension metric rows with opaque IDs and null placeholders;
- reuse shared materialization, Reliability and Lark Metric writer paths;
- add null/zero, incomplete Coverage, weighted-average, rank-clearing and cross-channel regressions.

## Deliberate fail-closed boundary

- Chatwoot remains `uat_pending` in Connector, Job and Report catalogs;
- generic runtime therefore returns `source_unavailable` until a later Catalog-promotion PR;
- no Provider call, Queue message, Remote D1/Lark write, deployment, Schedule/Webhook activation or Live materialization occurs in this workstream.

## Data rules

1. Completed/no-data-confirmed Coverage is required before numeric Business metrics are emitted.
2. Duration averages are `SUM(non-null duration) / COUNT(non-null duration)` across eligible conversation facts.
3. Daily averages are never averaged.
4. Period-end Account metrics use the latest completed date within the period.
5. Missing or incomplete facts remain `null`; observed event zero remains numeric `0`.
6. Inbox/Agent rank comparisons and changes remain `null` because rank occupants can differ.
7. Message body, Contact fields, free-form Label titles and raw Provider payload are forbidden.

## Required verification

```bash
npm ci
npm run check
node --test tests/connectors/d1-chatwoot-report-source.test.js
node --test tests/application/chatwoot-report-materialization.test.js
node --test tests/application/chatwoot-report-dimension-metrics.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
