# Report D1 Read Retry & Diagnostics Hotfix v1

Date: `2026-08-05`

## Objective

Harden the existing shared Report SELECT-only D1 reader after Run All stopped before Instagram deployment on a
`wrangler d1 execute --remote --json` failure whose `stderr` was discarded by the shared command runner.

## Incident boundary

```text
Repository Head              392673893e390019019f04b299185782214d965d
Stopped channel              instagram
Stopped stage                lark-and-instagram-d1-preflight
Active deployment attempted  false
Queue action count           0
Remote write count           0
Worker deployment count      0
Provider request count       0
Production                   BLOCKED
```

The same Instagram preflight query had passed in the readiness phase immediately before Run All. Facebook was the
first sequential channel and must be reverified read-only before any resumed execution. The old Run All block and
old handoff are non-repeatable.

## Shared correction

Only the existing `createReviewedStateRuntime().readD1Rows()` path changes:

```text
D1 SELECT command
→ attempt 1
→ bounded wait on command failure
→ attempt 2
→ bounded wait on command failure
→ attempt 3
→ parse JSON once command succeeds
```

A successful command returning invalid JSON is not retried. A final command failure exposes only bounded normalized
`sourceCode`, `sourceSignal`, `stderr` and `stdout`. It does not expose the SQL command text.

## Safety

- applies only to D1 reads issued by the reviewed Report state runtime;
- no retry is added to D1 writes, closure statements, migrations, backups or Queue sends;
- no Instagram-specific wrapper or engine;
- no Provider request;
- no Worker deployment during implementation;
- no D1/Lark mutation during implementation;
- Notification Admission, Schedule and Production remain disabled.

## Acceptance criteria

1. Transient failures followed by success return the expected row.
2. Permanent failures stop exactly at the bounded attempt count.
3. Final diagnostics are compact and contain no SQL text.
4. Invalid successful output fails as `REPORT_RUNTIME_CLOSEOUT_D1_RESPONSE_INVALID` without retry.
5. Full Repository and Report reliability gates pass.
6. Resume requires new exact-head Finalizer/readiness/handoff evidence.
