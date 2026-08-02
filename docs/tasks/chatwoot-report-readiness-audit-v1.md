# Chatwoot Report Readiness Audit v1

## Status

`REPOSITORY_IMPLEMENTATION / REMOTE_EXECUTION_NOT_AUTHORIZED / CATALOG_PROMOTION_BLOCKED`

## Objective

Add one independent fail-closed Chatwoot Report readiness contract and reviewed Remote read-only collector without reopening the accepted Source UAT or changing retained forensic incidents.

## In scope

- pure readiness assessor for clean exact reviewed `main`;
- accepted UAT summary validation;
- exact 65 Conversations / 2,071 Messages boundary;
- retained DLQ 9 / Alert 15 forensic count validation;
- all-false Worker, binding, traffic, migration, Work and Lock checks;
- Connector/Job/Report `uat_pending` and runtime reader registration checks;
- Report Settings and shared materializer/Lark writer compatibility;
- exact `1/3/7/30` decisions;
- 19 summary plus 120 dimension metrics = 139 rows;
- D1/Lark Source parity across 15 Chatwoot targets;
- D1/Lark Report parity through the existing metric-integrity verifier;
- private sanitized evidence output;
- reviewed-terminal and source-safety regressions.

## Deliberate blockers

- Source recovery, incident closure/redrive and replacement UAT are forbidden.
- Catalog promotion is not performed by this task.
- Live Report materialization is not performed by this task.
- A class existing in Source code is not proof of runtime registration. Missing `D1ChatwootReportSource` registration in the shared D1 Report registry remains the explicit `source_reader_missing` blocker.

## Public plan command

```bash
node scripts/chatwoot-report-remote-readiness-reviewed-terminal.mjs
```

## Confirmed read-only command after merge

```bash
CONFIRM_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR=RUN_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR \
MKT_CHATWOOT_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
MKT_CHATWOOT_ACCEPTED_UAT_SUMMARY=<accepted-summary.json> \
node scripts/chatwoot-report-remote-readiness-reviewed-terminal.mjs --execute
```

## Safety contract

1. Repository validation completes before Remote Worker, D1 or Lark reads.
2. Direct internal `--execute` is blocked without the reviewed handoff.
3. D1 statements are validated as `SELECT/WITH` only.
4. Lark uses list/get/search only.
5. Accepted Source facts and retained incidents are read-only invariants.
6. Missing evidence or drift fails closed; no success is fabricated.
7. Plan mode performs zero external calls.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/chatwoot-report-readiness-audit.test.js
node --test tests/scripts/chatwoot-report-readiness-audit-source.test.js
node --test tests/scripts/chatwoot-report-remote-readiness-collector.test.js
node --test tests/scripts/chatwoot-report-remote-readiness-collector-source.test.js
node --test tests/scripts/chatwoot-report-remote-readiness-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
