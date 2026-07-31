# Meta History 2026 One-Command Finalizer v1

## Objective

Complete the existing Chemistry K Meta delivery without replacing the reviewed Shared Meta runtime or
replaying the already-completed Facebook lane unnecessarily.

```text
Facebook Organic     verify existing pinned completion and Lark parity; Provider replay forbidden
Instagram Organic    2026-07-01 through 2026-07-31 inclusive
Meta Ads baseline    2026-05-01 through 2026-07-31 inclusive, both Ads accounts
Meta Ads expansion   2026-01-01 through 2026-04-30 when baseline volume is bounded
```

## Existing authority retained

- Facebook already passed D1/Lark delivery and must be verified, not replaced.
- The pinned Meta session at Head `e069380a544575ce0fc9bca53f1fb56944d26c09` and Instagram operation
  `meta-instagram-d1-20260729t065939687z-1ad3c9` must resume before supplemental history.
- Existing Meta Graph transport, active Worker router, Shared Queue/Reliability, D1 stores,
  Organic History Writer, Coverage and TableSyncEngine remain authoritative.
- Stable keys, D1-first processing, same-operation Lark continuation and idempotent replay remain unchanged.

## Source corrections

### Instagram inventory

Instagram `/me/media` does not use the Facebook `since/until` inventory query. The source adapter now:

- accepts an exact configured content-history range;
- keeps provider pagination newest-first;
- filters content to the inclusive range;
- continues while pages are newer than the requested range;
- retires pagination after the first row older than the lower boundary;
- fails closed on missing/invalid timestamps or non-monotonic provider order.

Existing operations without configured history bounds preserve the previous behavior.

### Meta Ads history

The Marketing API adapter still issues no request longer than 31 inclusive days. For a longer operation it
uses an internal opaque durable cursor containing the current date chunk and provider cursor:

```text
requested multi-month range
→ one <=31-day Provider page
→ persist compound cursor
→ finish Provider pagination for that chunk
→ advance to the next <=31-day chunk
```

Single-window operations preserve the prior raw provider-cursor contract exactly.

## One-command execution

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-finalizer.mjs --execute
```

The command:

1. requires clean `main == origin/main` and private local inputs;
2. runs the complete Repository gate before Remote mutation;
3. creates an exact private persisted operation plan;
4. verifies current all-false Worker and zero active Reliability state;
5. resumes the pinned Meta finalizer and requires its session to complete;
6. refreshes all four GET-only identity validations;
7. executes required Instagram and three-month Ads D1/Lark operations;
8. expands Ads to January 1 only when the two baseline operations remain below exact row/Coverage limits;
9. verifies same-operation replay, D1/Lark parity and all-false restore for every operation;
10. requires final active Work/Lock/Queue counts `0/0/0` and emits `META_HISTORY_2026_COMPLETED_SAFE`.

## Adaptive Ads limits

Year-start expansion is allowed only when the combined three-month baseline is no greater than:

```text
operation Ads Daily rows      15,000
operation Ads Entity rows      5,000
Coverage Entity rows          20,000
invalid Coverage                    0
active Lock                         0
Sync status                    success
```

If the baseline exceeds a limit, the accepted three-month history remains final and no older operation is
created.

## Recovery and rerun

- Operation IDs and requested-at generations are persisted before the first Queue send.
- Completed D1/Lark summaries are reused on a launcher rerun.
- An existing Queue attempt without its accepted phase evidence is never resent automatically.
- Any failure after an active deployment invokes the exact all-false restore and verifies it before returning.
- The pinned historical Meta operation is never replaced.

## Safety

```text
Facebook Provider replay         forbidden
Business fact deletion           forbidden
Direct Business-table mutation   forbidden
New Queue/Writer framework       none
Schedule activation              forbidden
Production                       blocked
Secrets in evidence              none
Final Worker flags               all false
```

## Required verification

```text
npm ci
npm run check
focused Meta history/rollout/Lark tests
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```
