# YouTube Report Remote Readiness Collector v1

## Status

`REPOSITORY_IMPLEMENTATION_IN_REVIEW / PR_422_MERGED / REMOTE_EXECUTION_NOT_AUTHORIZED`

## Objective

Extend the merged YouTube Report readiness authority with one direct authenticated read-only evidence collector so the operator no longer depends on a manually assembled JSON document.

## Authority

PR #422 is merged into `main` at `e6936496b58c7e7ae8d939520878e0f9dd5ae449`. The public operator must use the merged reviewed assessor and may run only from a clean `main` checkout whose exact Head equals the explicitly supplied reviewed Head.

The internal collector is not a public execution authority. Its `--execute` path requires an internal handoff emitted only by the reviewed terminal after repository validation.

## In scope

- plan-only reviewed terminal by default;
- exact confirmation before any read-only Remote call;
- clean `main` and exact reviewed-Head validation before invoking the internal collector;
- current Worker deployment and binding inspection;
- `wrangler d1 execute --remote` with SELECT/WITH statements only;
- pending D1 migration inspection;
- Lark table, Stable-key field and exact Report window-option reads;
- D1/Lark state collection for exact rolling 1/3/7/30 identities;
- reviewed readiness assessment with repository evidence;
- private sanitized evidence output;
- source-safety, repository-gate and parser/query regressions.

## Out of scope

- YouTube Provider requests or replay;
- Queue/DLQ mutation;
- Remote D1 mutation;
- Remote Lark mutation;
- Worker upload/deployment;
- Schedule, Secret or Catalog changes;
- Report materialization execution;
- Production.

## Public command after review and merge

Plan-only:

```bash
node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs
```

Confirmed read-only execution requires the exact reviewed `main` Head:

```bash
CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=RUN_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR \
MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs --execute
```

## Safety contract

1. Repository validation completes before the internal collector starts.
2. Direct internal `--execute` is blocked without the reviewed handoff.
3. Every D1 statement is validated as `SELECT` or `WITH` before invocation.
4. No command may contain `wrangler deploy`, `versions upload`, Queue message endpoints or D1 migration apply.
5. Lark access uses list/get/search methods only.
6. Evidence output strips token, secret, authorization, table/database/queue IDs and Worker UUIDs.
7. Any incomplete read fails closed into blockers; it never fabricates readiness.
8. Plan mode performs zero external calls.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/youtube-report-remote-readiness-collector.test.js
node --test tests/scripts/youtube-report-remote-readiness-collector-source.test.js
node --test tests/scripts/youtube-report-remote-readiness-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
