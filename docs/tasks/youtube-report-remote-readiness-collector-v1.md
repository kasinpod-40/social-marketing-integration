# YouTube Report Remote Readiness Collector v1

## Status

`REPOSITORY_IMPLEMENTATION / DEPENDS_ON_PR_422 / REMOTE_EXECUTION_NOT_AUTHORIZED`

## Objective

Extend the accepted YouTube Report readiness assessor with one direct authenticated read-only evidence collector so the operator no longer depends on a manually assembled JSON document.

## Dependency

This branch is stacked on `audit/youtube-report-live-readiness-v1` (Draft PR #422). It must not alter the readiness decision contract or claim that Live materialization is complete.

## In scope

- plan-only CLI by default;
- explicit confirmation before any read-only Remote call;
- current repository and exact Worker deployment inspection;
- `wrangler d1 execute --remote` with SELECT/WITH statements only;
- pending D1 migration inspection;
- Lark table, Stable-key field and exact Report window-option reads;
- D1/Lark state collection for exact rolling 1/3/7/30 identities;
- sanitized private evidence output compatible with `assessYouTubeReportLiveReadiness`;
- source-safety and parser/query regressions.

## Out of scope

- YouTube Provider requests or replay;
- Queue/DLQ mutation;
- Remote D1 mutation;
- Remote Lark mutation;
- Worker upload/deployment;
- Schedule, Secret or Catalog changes;
- Report materialization execution;
- Production.

## Safety contract

1. Every D1 statement is validated as `SELECT` or `WITH` before invocation.
2. No command may contain `wrangler deploy`, `versions upload`, Queue message endpoints or D1 migration apply.
3. Lark access uses list/get/search methods only.
4. Evidence output strips token, secret, authorization, table/database/queue IDs and Worker UUIDs.
5. Any incomplete read fails closed into blockers; it never fabricates readiness.
6. Plan mode performs zero external calls.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/youtube-report-remote-readiness-collector.test.js
node --test tests/scripts/youtube-report-remote-readiness-collector-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
