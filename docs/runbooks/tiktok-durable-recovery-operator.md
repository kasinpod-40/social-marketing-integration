# TikTok Durable Recovery Operator

This operator automates the exact guarded rollout in `docs/runbooks/tiktok-organic-bootstrap-durable-recovery.md`. It does not create a generic recovery path and cannot target Production.

## Default behavior

```bash
npm run rollout:tiktok-recovery
```

The default is plan-only. It prints the immutable incident identity, phase order and required confirmation values. It does not call Wrangler, D1, deploy a Worker or send a Queue message.

## Required local environment

Run from a clean checkout of current `main` on the authenticated Integration Workspace machine.

```bash
export WRANGLER_CONFIG="wrangler.sync.jsonc"
export MKT_D1_DATABASE_NAME="social-mkt-state-dev"

# Required only for Queue send/replay phases.
export CF_ACCOUNT_ID="<32-character Cloudflare account ID>"
export CF_QUEUE_ID="<32-character Cloudflare queue ID>"
export CLOUDFLARE_API_TOKEN="<Queues Write token>"
```

The ignored Wrangler config must resolve to:

```text
worker_name = social-mkt-sync-worker
database_name = social-mkt-state-dev
queue = social-mkt-sync-jobs
MKT_ENV = development
MKT_CUSTOMER_PROFILE = integration_workspace
TikTok Connector / D1 write / D1 backfill = true
all TikTok, YouTube, Report and Notification schedules = false
Report D1 reader / Lark retention / DLQ generic redrive = false
```

## Evidence chain

Evidence is written only under the ignored directory:

```text
outputs/tiktok-durable-recovery/exact-2026-07-23/
```

Every phase requires the previous phase's `status=passed` evidence. The operator cannot jump directly to Migration, deployment or Queue send.

## Phases

### 1. Read-only preflight

```bash
npm run rollout:tiktok-recovery:preflight
```

Runs repository checks, focused recovery tests, Wrangler dry-run, `wrangler whoami`, D1 info, exact pending-migration validation and an exact read-only incident query. Acceptance is hard-coded to:

```text
State / Observation / Coverage entities = 1309 / 1000 / 1000
Work = active with original generation/requestedAt
write phase = nextSequence 2, two Units, 1000 durable rows, incomplete
exact DLQ = open / QUEUE_RETRY_EXHAUSTED
lock = expired
Coverage = partial / expected 2021 / observed 1000 / failed 0 / completed_at null
pending migrations = only 0010_tiktok_bootstrap_durable_recovery.sql
```

Any mismatch stops before a Remote write.

### 2. Remote backup

```bash
export CONFIRM_TIKTOK_RECOVERY_BACKUP="BACKUP_EXACT_TIKTOK_RECOVERY_INCIDENT"
npm run rollout:tiktok-recovery:backup
```

Exports the Remote D1 database, verifies the file is non-empty and records SHA-256 evidence.

### 3. Migration 0010

```bash
export CONFIRM_TIKTOK_RECOVERY_MIGRATION="APPLY_0010_EXACT_TIKTOK_RECOVERY"
npm run rollout:tiktok-recovery:migrate
```

Rechecks that the pending set is exactly Migration `0010`, verifies the backup checksum, applies migrations, requires no migration to remain pending, verifies both new tables and indexes, and confirms business facts remain `1309 / 1000 / 1000`.

### 4. Schedule-disabled deployment

```bash
export CONFIRM_TIKTOK_RECOVERY_DEPLOY="DEPLOY_EXACT_TIKTOK_RECOVERY_SCHEDULES_FALSE"
npm run rollout:tiktok-recovery:deploy
```

Validates the real ignored Wrangler config, performs a dry-run, then deploys. Unsafe target names or any enabled business schedule fail closed.

### 5. One exact Queue send

```bash
export CONFIRM_TIKTOK_RECOVERY_QUEUE_SEND="SEND_EXACT_TIKTOK_RECOVERY_ONCE"
npm run rollout:tiktok-recovery:send
```

Sends exactly one HTTP Queue message using the immutable operation ID, Work key, generation, requested time and DLQ ID. The API token is read only from the process environment and is never written into evidence.

Do not send Worker continuations manually.

### 6. Completion verification

```bash
npm run rollout:tiktok-recovery:verify
```

This phase is read-only. Rerun it until the Queue work has completed or until it returns a mismatch that requires investigation. Acceptance requires:

```text
State / Observation / initial Observation / Coverage entities = 2021 each
Content and Observation duplicate groups = 0
original Work = completed
write phase = complete, nextSequence 5, durable counters 2021
Coverage = complete, expected=observed=2021, failed=0
exact DLQ = redriven and retained
recovery metadata = completed with exact operation/work identity
```

### 7. Exact idempotent replay

```bash
export CONFIRM_TIKTOK_RECOVERY_REPLAY="REPLAY_EXACT_TIKTOK_RECOVERY_ONCE"
npm run rollout:tiktok-recovery:replay
npm run rollout:tiktok-recovery:replay-verify
```

Replay uses the same immutable operation and cannot create a new generation. Replay verification requires all durable business counts and duplicate checks to remain unchanged.

## Non-destructive boundary

The operator contains no delete, cleanup, D1 restore, Lark mutation, schedule-enable or Production action. A failed phase stops the chain. Never edit evidence files to bypass a failed gate; delete the local evidence directory and restart from read-only preflight after resolving the underlying mismatch.
