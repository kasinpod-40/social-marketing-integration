# YouTube Remote Read-only Preflight — Final Terminal Gate

## Purpose

Run one fail-closed read-only inspection after the Repository PR is merged. Historical YouTube→Lark
sync is already PASS; this gate validates current `main` and the current active Worker contract only.

## Required local environment

```bash
export MKT_YOUTUBE_DRY_RUN_SAFE_WRANGLER_CONFIG='<reviewed all-flags-false config path>'
export MKT_YOUTUBE_DRY_RUN_ACTIVE_WRANGLER_CONFIG='<reviewed YouTube dry-run config path>'
export MKT_YOUTUBE_DRY_RUN_EXPECTED_CHANNEL_ID='UCAwEENovvqZWosKhJWTS5Kg'
export CLOUDFLARE_ACCOUNT_ID='<Cloudflare account ID>'
export CLOUDFLARE_API_TOKEN='<token with required read scopes>'
```

Optional exact values default and fail closed on any different value:

```text
MKT_YOUTUBE_DRY_RUN_WORKER_NAME=social-mkt-sync-worker
MKT_YOUTUBE_DRY_RUN_DATABASE_NAME=social-mkt-state-dev
MKT_YOUTUBE_DRY_RUN_MAIN_QUEUE=social-mkt-sync-jobs
MKT_YOUTUBE_DRY_RUN_DLQ=social-mkt-sync-dlq
```

## Plan-only inspection

```bash
npm run preflight:youtube-remote-read-only
```

This performs no Remote call.

## Final Terminal command

From a clean checked-out `main`:

```bash
CONFIRM_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT=RUN_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT \
  npm run preflight:youtube-remote-read-only:run
```

The operator itself fetches `origin/main`, requires local `main` to match it, verifies the active Worker
version twice, and writes a private sanitized summary to:

```text
outputs/youtube-remote-read-only-preflight/summary.json
```

## Read-only operations

```text
Wrangler whoami
Worker deployments status ×2
Worker versions view
Main Queue consumer list
DLQ consumer list
Cloudflare Worker list / Cron / workers.dev metadata
D1 migrations list
Reviewed local Safe/Active config comparison
Live Remote fingerprint validation
```

## Forbidden operations

```text
Worker deploy/upload/rollback
Queue send/Ack/Retry/DLQ mutation
D1 execute/write/migration apply
YouTube or Lark request
Cron/route/workers.dev/Secret mutation
Production action
```

## Decision contract

- `PASS_READ_ONLY_PREFLIGHT`: current safe Remote contract matches and no migration is pending.
- `BLOCKED_PENDING_MIGRATION_0018`: all inspected contracts may pass, but Chatwoot Migration `0018`
  remains pending; do not apply it from this workstream.
- `BLOCKED_MIGRATION_0017_REMOTE_TRUTH`: Migration `0017` unexpectedly appears pending; do not rerun it.
- Any main/version/Queue/D1/flag/Secret/trigger/fingerprint drift blocks with its exact error code.

A PASS closes the YouTube read-only revalidation task. It does not authorize Worker deployment, Queue
execution, Schedule activation or Production rollout.
