# Instagram + Google Ads Remote Readiness Collector v1

## Status

`REPOSITORY_IMPLEMENTATION_IN_REVIEW / PR_424_MERGED / REMOTE_EXECUTION_NOT_AUTHORIZED`

## Objective

Add direct authenticated read-only evidence collection for the independent Instagram Organic and Google Ads readiness decisions merged through PR #424.

## Authority

The public operator must run only from a clean `main` checkout whose exact Head equals the explicitly supplied reviewed Head. Repository validation completes before any Worker, D1 or Lark read.

The internal collector is not a public execution authority. Its `--execute` path requires an internal handoff emitted only by the reviewed terminal after repository validation.

## In scope

- plan-only reviewed terminal by default;
- exact confirmation before Remote reads;
- clean `main` and exact reviewed-Head validation before invoking the internal collector;
- exact Worker deployment/binding inspection;
- SELECT/WITH-only D1 collection for Source facts, Coverage, Work/Lock/DLQ/Alert and Report previews;
- Lark Source/Report schema and record-count reads;
- Instagram and Google Ads evidence emitted as separate channel objects;
- retained Meta continuation and Google Ads delivery replay evidence reads;
- sanitized private evidence compatible with the independent readiness contract;
- source-safety, repository-gate and independent-failure regressions.

## Out of scope

- Instagram/Meta Provider requests;
- Google Ads API calls or signed-delivery replay;
- Queue/DLQ mutation;
- D1/Lark mutation;
- Worker deployment;
- Catalog promotion;
- Schedule/Secret changes;
- Report materialization;
- Production.

## Public command after review and merge

Plan-only:

```bash
node scripts/instagram-google-ads-remote-readiness-reviewed-terminal.mjs
```

Confirmed read-only execution requires the exact reviewed `main` Head:

```bash
CONFIRM_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR=RUN_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR \
MKT_INSTAGRAM_GOOGLE_ADS_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/instagram-google-ads-remote-readiness-reviewed-terminal.mjs --execute
```

## Safety contract

1. Repository validation completes before the internal collector starts.
2. Direct internal `--execute` is blocked without the reviewed handoff.
3. D1 statements must begin with `SELECT` or `WITH` and contain no mutation token.
4. Lark access is list/get/search only.
5. One channel read failure is represented only in that channel's evidence and cannot fabricate the other channel's result.
6. No raw token, authorization value, table/database/queue ID, account identity or Worker UUID is persisted.
7. Plan mode performs zero external calls.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/instagram-google-ads-remote-readiness-collector.test.js
node --test tests/scripts/instagram-google-ads-remote-readiness-collector-source.test.js
node --test tests/scripts/instagram-google-ads-remote-readiness-reviewed-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
