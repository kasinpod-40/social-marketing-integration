# Meta History 2026 One-Command Finalizer v1

## Objective

Complete the existing Chemistry K Meta delivery without replacing Shared Meta infrastructure or replaying
the already-completed Facebook operation.

```text
Facebook pinned      verify completed D1/Lark evidence; no replay
Facebook supplemental 2026-07-01 through 2026-07-31 inclusive
Instagram Organic    2026-07-01 through 2026-07-31 inclusive
Meta Ads baseline    2026-05-01 through 2026-07-31 inclusive, both Ads accounts
Meta Ads expansion   2026-01-01 through 2026-04-30 when baseline volume is bounded
```

## Existing authority retained

- Facebook's completed pinned D1/Lark lane remains authoritative and is verified rather than replayed or
  replaced.
- A separate deterministic Facebook July history operation uses existing Stable Business keys, Shared
  Queue/Reliability, D1 writers, Coverage, Organic History Writer and TableSyncEngine. Existing rows are
  preserved; only missing history can be added.
- The pinned Meta session at Head `e069380a544575ce0fc9bca53f1fb56944d26c09` and Instagram operation
  `meta-instagram-d1-20260729t065939687z-1ad3c9` resume before supplemental history.
- Existing Meta Graph transport, active Worker router, Shared Queue/Reliability, D1 stores, Coverage and
  TableSyncEngine remain authoritative.
- Stable keys, D1-first processing, same-operation Lark continuation and idempotent replay remain
  unchanged.

## Organic history

Facebook uses the existing bounded `since`/`until` inventory contract for July 1–31. The supplemental
operation has a new deterministic operation ID, but it does not replace or replay the completed pinned
operation. D1 and Lark reruns must be idempotent.

Instagram `/me/media` does not use the Facebook inventory date query. The source adapter:

- accepts an exact configured content-history range;
- keeps Provider pagination newest-first;
- filters content to the inclusive range;
- continues while pages are newer than the requested range;
- retires pagination after the first row older than the lower boundary;
- fails closed on missing/invalid timestamps or non-monotonic order.

Operations without configured Instagram history bounds preserve the previous behavior.

## Meta Ads history

Every Marketing API request remains at most 31 inclusive days. A longer operation uses an opaque durable
cursor containing the exact root range, current date chunk and current Provider cursor:

```text
multi-month operation
→ one <=31-day Provider page
→ persist compound cursor
→ finish pagination for that chunk
→ advance to the next <=31-day chunk
```

Existing operations no longer than 31 days preserve the previous raw Provider-cursor contract.

## Public command

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

The Terminal entrypoint owns the first pre-mutation boundary. It requires clean `main == origin/main`,
creates or validates the private persisted operation plan and guarantees all six operations have unique
ISO `originalRequestedAt` values accepted by the existing D1/Lark rollout contracts. Epoch-millisecond
strings are rejected before any Remote action.

It then delegates to the guarded one-command launcher, which:

1. runs the full Repository gate before Remote mutation;
2. reuses deterministic operation IDs and ISO requested-at generations from the persisted plan;
3. verifies the current all-false Worker and idle Reliability state;
4. resumes and verifies the exact pinned Meta finalizer without replaying Facebook;
5. refreshes all four GET-only identity validations;
6. executes Facebook July and Instagram July D1/Lark operations;
7. executes the required three-month Ads operations for both accounts;
8. expands Ads to January 1 only when reviewed limits permit;
9. verifies same-operation replay, D1/Lark parity and all-false restore;
10. blocks uncertain Queue resends;
11. restores the reviewed Safe Worker configuration after a failed active window;
12. emits `META_HISTORY_2026_COMPLETED_SAFE` only after final active Work/Lock/Queue counts are `0/0/0`.

`scripts/meta-history-2026-one-command.mjs` and
`scripts/meta-history-2026-finalizer.mjs` are implementation children and are not public operator commands.

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

If a limit is exceeded, the accepted three-month history is final and no older operation is created.

## Exact closeout correction

The authoritative Lark operator summary field is `larkParityVerified`. Closeout verifies that field with
`idempotentRerunVerified`, `restoredAllFalse` and zero Provider requests in every Lark continuation.
Facebook and Instagram supplemental evidence are both required; a missing Facebook operation cannot be
accepted as completion.

Only the known final summary alias mismatch can be recovered from authoritative evidence. Earlier-stage
failures remain failures after Safe Worker restore and are never converted to success.

## Safety

```text
Existing Facebook operation replay  forbidden
Facebook replacement operation      forbidden
Business fact deletion              forbidden
Direct Business-table mutation      forbidden
New Queue/Writer framework          none
Uncertain Queue resend              forbidden
Epoch-string generation             rejected before Remote action
Schedule activation                 forbidden
Production                          blocked
Secrets in evidence                 none
Final Worker flags                  all false
```

## Required verification

```text
npm ci
npm run check
focused Meta history source/finalizer/Terminal/closeout tests
focused Meta D1/Lark rollout tests
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Meta End-to-End Verification on exact PR Head
Branch Verification on exact PR Head
```
