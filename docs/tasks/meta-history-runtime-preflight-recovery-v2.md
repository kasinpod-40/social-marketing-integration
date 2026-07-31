# Meta History Runtime Preflight Recovery v2

## Incident boundary

Two guarded Terminal attempts stopped before the first Meta operation:

1. `prepare-safe-config` rejected the readable Wrangler source because it was not a private `0600`
   non-symlink file.
2. After supplying a private temporary copy, `cloudflare-readiness` counted two historical
   `sync_runs.status IN ('queued','running')` rows as active Queue operations despite zero active durable
   Work and zero active Locks.

The active Worker version passed the all-false flag assertion before the Reliability query failed. The
outer closeout then treated the generic failure as an unsafe Worker and attempted an emergency deploy.
The generated config lived under `outputs/` and retained a relative `main` path, so Wrangler could not
resolve `apps/sync-worker/src/index.js` from that directory.

## Correct active-state authority

Active execution is defined by the shared durable-work contract:

```sql
SELECT COUNT(DISTINCT q.operation_id)
FROM queue_operation_attempts q
JOIN sync_work_runs w ON w.work_key = q.work_key
WHERE w.lifecycle_status = 'active';
```

A retained `sync_runs` row marked `queued` or `running` without active durable Work is historical
Reliability state, not proof that a Queue operation is currently executing. It remains stored and is not
deleted or directly edited by this hotfix.

## Config contract

The source Wrangler config is non-secret input. It may be a normal readable file or a symlink resolving
to a regular file. Before any Remote command, the finalizer writes a private `0600` generated config and
normalizes these path-bearing fields against the Repository root:

- `main`
- `migrations_dir`

Secret-bearing `.dev.vars`, pinned session/evidence and generated execution artifacts retain the strict
private non-symlink requirement.

## Restore contract

Worker safety and Reliability idleness are independent checks.

- Inspect the exact active Worker version and its `MKT_*_ENABLED` flags.
- Deploy the generated all-false config only when the exact active-flags assertion returns
  `WOOCOMMERCE_2026_COMPLETION_REMOTE_FLAGS_ACTIVE`.
- Authentication errors, missing files, invalid config, D1 read failures and non-idle Reliability state
  never authorize a deploy.
- After a proven active-flag restore, re-verify Worker flags and then verify zero active Work, Locks and
  active-work-linked Queue operations.

## Safety

Repository implementation and CI perform no Provider request, Queue/DLQ send, Remote D1/Lark mutation,
Worker deployment, Schedule activation, Secret change or Production action. Existing Business facts,
operation IDs, runtime evidence and pinned Meta completion remain unchanged.

## Required gates

```text
npm ci
npm run check
focused Meta finalizer/public-launcher tests
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Meta End-to-End Verification on exact PR Head
Branch Verification on exact PR Head
```
