# Chatwoot Report Runtime Reader Wiring v1

## Status

`REPOSITORY_IMPLEMENTATION / CATALOG_UAT_PENDING / REMOTE_EXECUTION_NOT_AUTHORIZED`

## Objective

Wire the existing PII-minimized `D1ChatwootReportSource` into the Shared Dashboard Report adapter registry at the Worker composition boundary without promoting Chatwoot Catalog state or creating a Chatwoot-specific Report identity path.

## Contract

1. Register `chatwoot: new D1ChatwootReportSource({ db })` in the existing `createD1ReportRegistry` composition.
2. Preserve the Report platform contract as `sourceStatus=uat_pending`.
3. Preserve Shared Report identity:
   - `platform_scope=chatwoot`;
   - `report_type=dashboard_performance_report`;
   - `report_id` remains the deterministic Shared materialization ID.
4. Do not introduce `chatwoot_report_id`, `CHATWOOT_REPORT_ID` or a separate Chatwoot runtime reader.
5. Runtime reader wiring reads materialized/source facts only; it never creates or promotes Catalog definitions/settings.
6. Until a separately reviewed Catalog-promotion PR changes the source status, `generateDashboardReportMaterialization` must continue returning `source_unavailable` without calling the Chatwoot adapter.
7. No Provider, Queue, Remote D1/Lark, deployment, Schedule/Webhook, Catalog promotion, Live materialization or Production action is authorized.

## Changed files

```text
apps/sync-worker/src/tiktok-d1-aware-report-job-router.js
tests/application/chatwoot-report-materialization-source.test.js
docs/tasks/chatwoot-report-runtime-reader-wiring-v1.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-report-materialization-source.test.js
node --test tests/application/chatwoot-report-materialization.test.js
node --test tests/connectors/d1-chatwoot-report-source.test.js
node --test tests/scripts/chatwoot-report-readiness-audit.test.js
node --test tests/scripts/chatwoot-report-remote-readiness-collector-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Dependency isolation

PR #421 does not modify the Router, Chatwoot D1 source or Chatwoot Report materialization source test. This workstream must not edit any PR #421 file.
