# Report Runtime Lark Parity Recovery v1

## Incident

Organic 3D refresh on `main@0adb70953e8915ca4916137b4bc7de29011f9e63` completed its first D1 materialization and attempted the Lark Report write, then verification observed seven D1/Lark metric mismatches. Automatic all-false restore succeeded.

```text
activeDeploymentAttempted   true
safeRestoreVerified         true
first materialization       completed
replay                      not sent
closeout summary             not written
production                   blocked
```

No Worker recovery is required. The 3D evidence directory contains partial attempt/backup evidence and must not be restarted as a fresh refresh.

## Confirmed repository defect

`pollLarkCompletion()` returned as soon as one snapshot and any metric rows existed. Refresh targets already had those rows before the write, so the first fresh read could return the old values and immediately compare them against the new D1 payload.

Row existence is not value convergence.

## Correction contract

### Normal closeout

After D1 completion, verification performs bounded fresh Lark reads until all conditions are true together:

- exactly one snapshot;
- positive metric row count;
- zero duplicate metric keys;
- exact D1/Lark metric key parity;
- exact normalized metric value parity;
- Organic incomplete-baseline null semantics remain valid.

Retryable convergence states are limited to incomplete Lark rows and D1/Lark metric key/value drift. Structural errors such as duplicate keys, missing metric keys, invalid Number values or invalid D1 payload fail immediately. No Lark write is retried by the operator.

Persistent drift fails closed with sanitized attempt count, last error code, mismatch count and row counts; metric values and physical IDs are excluded.

### Exact 3D recovery

Recovery accepts only the existing partial state:

- `deploy-active.attempt.json`, `send-first.attempt.json` and `restore-safe.attempt.json` exist;
- the standard closeout summary does not exist;
- Remote Worker is currently all-false;
- original Report ID, operation, window, requestedAt and regenerated job SHA match exactly;
- current D1 materialization is one completed row with at least one successful Sync run;
- current Lark values converge exactly to the D1 payload before any new Remote mutation.

Only after that read-only convergence proof may recovery:

1. create a new D1 backup;
2. deploy the reviewed Report-only window;
3. send the exact original job once as the missing replay;
4. verify the second successful Sync run, stable Report ID/checksum and unchanged Lark rows/values;
5. restore and verify all-false;
6. write the standard closeout summary so the parent sequence can reuse 3D and continue 7D, 1D and 30D.

If the replay attempt already exists but summary is missing, rerun is verification-only: it never sends another Queue message and finalizes only when D1/Lark/replay/all-false evidence is complete.

## Safety

- no Provider calls;
- no Connector ingestion flags;
- no AI or Schedule activation;
- no manual Lark editing;
- no Business fact deletion;
- no first-materialization retry;
- no automatic Queue retry after a recorded replay attempt;
- Production remains blocked.

## Required validation

```text
Focused closeout parity/recovery tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
Branch Verification CI
```
