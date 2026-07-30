# Report Runtime Config-DLQ Evidence Head Bridge v1

## Incident

The exact Organic TikTok 3D config-DLQ retry was recorded and completed under Repository Head:

```text
55db035555f6bd5205c049df318990691e4011e9
```

The Worker was restored to all-false, but post-retry verification stopped because the retry-state SQL omitted `payload_json`. The one-line payload readback fix was later merged at a newer `main` Head.

The existing verification-only recovery correctly refuses retry evidence whose `repositoryHead` differs from current main. Running the fixed code without an explicit evidence transition would therefore stop at `REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_RETRY_ATTEMPT_INVALID`.

## Correction

Add a local-only exact evidence-head bridge before config-DLQ verification.

The bridge:

1. requires clean `main == origin/main`;
2. proves the original retry Head is an ancestor of current main;
3. proves current source includes `payload_json` in the retry readback query;
4. validates the exact retry contract, Report ID, DLQ ID, retry timestamp, job hash, Active version stabilization evidence and D1 backup hash;
5. creates a mode-`0600` byte-for-byte backup with exclusive create;
6. atomically changes only the attempt `repositoryHead` to current reviewed main;
7. retains `originalRepositoryHead`, source/target Head, original file SHA-256 and bridge timestamp;
8. verifies the updated attempt and original backup after the atomic rename.

## Resume behavior

After the bridge, the existing config-DLQ operator detects the already-recorded retry and remains verification-only:

```text
Active Worker deploy       0
Queue sends                0
First materialization      not retried
D1/Lark parity             fresh read-only verification
DLQ metadata closure       exact retained incident only, after verification
Worker final state         all false
```

The wrapper order is:

```text
Finalizer
→ exact local evidence-head bridge
→ config-DLQ verification-only recovery
→ 7D refresh
→ 1D create
→ 30D create
```

## Mutation boundary

The bridge itself may write only these local evidence files:

```text
config-dlq-retry-send.attempt.pre-head-bridge.json
config-dlq-retry-send.attempt.json
config-dlq-evidence-head-bridge-summary.json
```

It cannot deploy a Worker, call Queue APIs, execute/export D1, call Lark, call a Provider, change schedules, change secrets or enable Production.

## Required validation

```text
focused helper and source-order regressions
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
Branch Verification CI on exact PR head
```
