# Chatwoot Final D1 Prefix Range Hotfix v1

## Incident

The guarded Chatwoot Final UAT reached the temporary Active Worker window and failed on the first read-only Initial Snapshot query. Automatic all-false Safe restore completed before the operator returned:

```text
safeRestore = ATTEMPTED
production  = BLOCKED
```

A separate all-false read-only diagnostic executed the exact Snapshot SQL from a private mode-0600 file and returned:

```text
LIKE or GLOB pattern too complex: SQLITE_ERROR
```

The diagnostic performed zero Worker deployments, Queue sends, Provider requests and Business writes. The failed UAT attempt stopped before `sendOnce()`, so it also admitted no Chatwoot Queue message and wrote no D1/Lark Business facts.

## Root cause

The Snapshot counted unit Sync/Coverage rows with a generated prefix pattern:

```sql
sync_run_id LIKE '<long stable Chatwoot syncRunId>:unit:%'
```

The exact immutable Chatwoot operation identity made this pattern longer than the Remote D1 LIKE/GLOB pattern limit. The SQL was otherwise read-only and structurally valid.

## Correction

- replace every Chatwoot Final UAT prefix `LIKE` with a bounded lexical prefix range;
- use the next ASCII boundary for the fixed safe suffix (`-` → `.`, `_` → backtick, `:` → `;`);
- preserve exact operation/work/generation identity and all existing count semantics;
- keep the query SELECT-only and avoid GLOB fallback;
- retain Schedule/Webhook disabled and Production blocked.

Example:

```sql
sync_run_id >= '<syncRunId>:unit:'
AND sync_run_id < '<syncRunId>:unit;'
```

## Verification

Required gates:

```bash
npm ci
npm run check
node --test tests/application/chatwoot-final-d1-prefix-range.test.js tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

No Remote action is authorized during implementation or CI. `docs/current-task.md` remains owned by the concurrent Meta workstream and is unchanged.
