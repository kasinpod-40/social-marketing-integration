# TikTok Organic Bootstrap Durable Recovery — Integration Workspace Runbook

## Status and authorization

This runbook governs only the exact TikTok Organic bootstrap interruption recorded on `2026-07-23`.

```text
AUTHORIZED_BY_USER = 2026-07-24
ENVIRONMENT = development / integration_workspace
PRODUCTION = blocked
SCHEDULES = disabled
LARK_BUSINESS_WRITE = forbidden
DELETE_OR_CLEANUP = forbidden
```

Repository implementation baseline:

```text
Implementation PR #29
Verified head e77633442cc48454df134c608bd4740254d43d2f
Branch Verification #342 / 30038029278 / PASS
Squash merge 1fce94344100a6b1ed9dce471966f3596c00778a
```

Use the real ignored local `wrangler.sync.jsonc` and Integration Workspace credentials. Never commit Wrangler configuration, API tokens, D1 exports, Queue IDs or secrets.

## Immutable incident identity

```text
original_requested_at = 1784829780000 / 2026-07-23T18:03:00Z
operation_id           = f59b852f00634005c7ff4da51afee964
original_work_key      = tiktok:f59b852f00634005c7ff4da51afee964
generation             = 1784829780000
dlq_id                  = dlq:8d1b9077657385a417cb32a0ed3114cb
dlq_message_id          = 8d1b9077657385a417cb32a0ed3114cb
phase                   = tiktok_organic_history_write_v1
initial_next_sequence   = 2
expected_rows           = 2021
```

Expected pre-recovery facts:

```text
organic_content_state         = 1309
organic_content_observations  = 1000
data_coverage_entities        = 1000
coverage.status               = partial
coverage.expected             = 2021
coverage.completed_at         = null
```

The 309 partially written State rows are valid durable facts. They must not be deleted, relabelled or excluded to make reconciliation pass.

## Hard stop conditions

Stop immediately when any condition below is true:

- Cloudflare account, Worker, D1 or Queue is not the developer-owned Integration Workspace;
- checked-out `main` does not contain merge `1fce94344100a6b1ed9dce471966f3596c00778a`;
- any TikTok, YouTube, Report or Notification business schedule flag is true;
- Remote D1 backup or SHA-256 generation fails;
- pending migrations contain anything other than the reviewed additive `0010_tiktok_bootstrap_durable_recovery.sql`;
- Migration `0009_storage_foundation.sql` is not already applied;
- exact Work, checkpoint, DLQ, generation, requested time or expired-lock evidence differs;
- pre-recovery counts differ from the incident evidence without a reviewed explanation;
- source identity is not exactly Chemistry K `@chemistry_k`;
- any Lark business write appears;
- duplicate Stable keys appear;
- Coverage cannot finish exactly at 2,021 expected and observed rows with `failed_rows=0`;
- any secret or token appears in logs or evidence.

No mismatch may be repaired by deleting rows or opening a new generation.

## 0. Local verification and variables

```bash
set -euo pipefail

export WRANGLER_CONFIG="wrangler.sync.jsonc"
export MKT_D1_DATABASE_NAME="social-mkt-state-dev"
export BACKUP_DIR="./backups/d1"

# Required only for the initial Queue push and the later exact replay.
export CF_ACCOUNT_ID="replace-with-integration-workspace-account-id"
export CF_QUEUE_ID="replace-with-integration-workspace-queue-id"
export CLOUDFLARE_API_TOKEN="replace-with-token-having-queues-edit-only"

npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run

git rev-parse HEAD
git merge-base --is-ancestor 1fce94344100a6b1ed9dce471966f3596c00778a HEAD
```

## 1. Read-only Remote identity and incident preflight

```bash
npx wrangler whoami
npx wrangler d1 info "$MKT_D1_DATABASE_NAME" --config "$WRANGLER_CONFIG"

npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT id, name, applied_at FROM d1_migrations ORDER BY id;

    SELECT work_key, cursor_key, generation, requested_at, lifecycle_status
    FROM sync_work_runs
    WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964';

    SELECT phase, complete, state_json
    FROM sync_work_phases
    WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964'
      AND phase='tiktok_organic_history_write_v1';

    SELECT lock_key, owner_id, acquired_at, expires_at, updated_at
    FROM sync_locks
    WHERE lock_key=(
      SELECT cursor_key FROM sync_work_runs
      WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964'
    );

    SELECT dlq_id, message_id, job_type, error_code, retry_count, status,
           redrive_requested_at, redrive_reference, redriven_at
    FROM dead_letter_jobs
    WHERE dlq_id='dlq:8d1b9077657385a417cb32a0ed3114cb';

    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count
    FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*)
    FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_entities', COUNT(*)
    FROM data_coverage_entities
    ORDER BY object_name;

    SELECT coverage_run_id, status, expected_entities, observed_entities,
           expected_rows, observed_rows, failed_rows, completed_at
    FROM data_coverage_runs
    WHERE customer_key='chemistry_k'
      AND platform='tiktok'
      AND account_key='chemistry_k'
      AND dataset_key='organic_content_cumulative'
    ORDER BY created_at DESC
    LIMIT 5;
  "
```

Acceptance before any write:

```text
Work identity = exact incident values
Work lifecycle_status = active
write phase complete = 0
write phase nextSequence = 2
write phase counters = 2 units / 1000 durable rows
lock expires_at < current epoch milliseconds
exact DLQ status = open
exact DLQ error_code = QUEUE_RETRY_EXHAUSTED
State / Observation / Coverage entity = 1309 / 1000 / 1000
Coverage = partial, expected 2021, completed_at null
```

## 2. Remote D1 backup and SHA-256

```bash
mkdir -p "$BACKUP_DIR"
export BACKUP_FILE="$BACKUP_DIR/social-mkt-state-dev-before-0010-recovery-$(date -u +%Y%m%dT%H%M%SZ).sql"

npx wrangler d1 export "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --output="$BACKUP_FILE"

shasum -a 256 "$BACKUP_FILE" | tee "$BACKUP_FILE.sha256"
test -s "$BACKUP_FILE"
test -s "$BACKUP_FILE.sha256"
```

The export is disaster-recovery evidence, not permission to overwrite newer data.

## 3. Review and apply Migration `0010`

```bash
npx wrangler d1 migrations list "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG"
```

Continue only when the pending set is exactly:

```text
0010_tiktok_bootstrap_durable_recovery.sql
```

Migration `0010` is additive only and creates:

```text
queue_operation_attempts
dead_letter_operation_metadata
idx_queue_operation_attempts_work_key
idx_dead_letter_operation_work
```

Apply only with the exact guard:

```bash
export CONFIRM_REMOTE_D1_MIGRATION=""

if [ "$CONFIRM_REMOTE_D1_MIGRATION" != "APPLY_0010_TIKTOK_RECOVERY_TO_INTEGRATION_WORKSPACE" ]; then
  echo "Migration 0010 not confirmed; stopping."
  exit 1
fi

npx wrangler d1 migrations apply "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG"
```

Verify schema and unchanged facts:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT name, type FROM sqlite_schema
    WHERE name IN (
      'queue_operation_attempts',
      'dead_letter_operation_metadata',
      'idx_queue_operation_attempts_work_key',
      'idx_dead_letter_operation_work'
    )
    ORDER BY type, name;

    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count
    FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*)
    FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_entities', COUNT(*)
    FROM data_coverage_entities
    ORDER BY object_name;
  "
```

Counts must remain `1309 / 1000 / 1000` after Migration apply.

## 4. Guarded Worker deployment

The ignored Wrangler config must use:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_TIME_SERIES_D1_WRITE_ENABLED=true
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=true
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_YOUTUBE_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_SCHEDULE_WEEKLY_REPORT_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
MKT_NOTIFICATION_RUNTIME_ENABLED=false
TIKTOK_SOURCE_HANDLE=chemistry_k
MKT_SYNC_LOCK_LEASE_MS=600000
MKT_SYNC_LOCK_RENEW_INTERVAL_MS=120000
MKT_QUEUE_RETRY_DELAY_SECONDS=30
```

Review the config diff without printing secrets, then:

```bash
export CONFIRM_RECOVERY_DEPLOY=""

if [ "$CONFIRM_RECOVERY_DEPLOY" != "DEPLOY_TIKTOK_DURABLE_RECOVERY_TO_INTEGRATION_WORKSPACE" ]; then
  echo "Recovery deployment not confirmed; stopping."
  exit 1
fi

npx wrangler deploy --config "$WRANGLER_CONFIG"
```

No schedule flag may be enabled.

## 5. Build and validate the exact recovery payload

```bash
export RECOVERY_REFERENCE="recovery:dlq:8d1b9077657385a417cb32a0ed3114cb:tiktok:f59b852f00634005c7ff4da51afee964"

RECOVERY_REFERENCE="$RECOVERY_REFERENCE" \
  npm run --silent job:tiktok-history-recovery \
  > /tmp/tiktok-organic-history-recovery.json

jq -e '
  .schemaVersion == 1 and
  .type == "tiktok.creator.native.history.recover" and
  .trigger == "manual_recovery" and
  .operationId == "f59b852f00634005c7ff4da51afee964" and
  .workKey == "tiktok:f59b852f00634005c7ff4da51afee964" and
  .generation == 1784829780000 and
  .originalRequestedAt == 1784829780000 and
  .dlqId == "dlq:8d1b9077657385a417cb32a0ed3114cb" and
  .dryRun == false
' /tmp/tiktok-organic-history-recovery.json

jq '{body: .}' /tmp/tiktok-organic-history-recovery.json \
  > /tmp/tiktok-organic-history-recovery-envelope.json
```

Recovery intentionally has no dry-run mode. Safety comes from the exact D1 guard and reviewed preflight.

## 6. Send exactly one initial recovery message

```bash
export CONFIRM_RECOVERY_QUEUE_SEND=""

if [ "$CONFIRM_RECOVERY_QUEUE_SEND" != "SEND_EXACT_TIKTOK_DURABLE_RECOVERY" ]; then
  echo "Recovery Queue send not confirmed; stopping."
  exit 1
fi

curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/queues/$CF_QUEUE_ID/messages" \
  --data-binary @/tmp/tiktok-organic-history-recovery-envelope.json
```

Do not send continuation messages manually. The Worker checkpoints one source Unit before sending its own continuation with the same operation identity. Queue `max_concurrency=1` remains required.

## 7. Observe bounded progress read-only

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT lifecycle_status, completion_json, completed_at
    FROM sync_work_runs
    WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964';

    SELECT complete, state_json
    FROM sync_work_phases
    WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964'
      AND phase='tiktok_organic_history_write_v1';

    SELECT recovery_status, recovery_reference, recovery_started_at,
           recovery_completed_at, audit_reference,
           main_queue_attempts, dlq_delivery_attempts
    FROM dead_letter_operation_metadata
    WHERE dlq_id='dlq:8d1b9077657385a417cb32a0ed3114cb';

    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count
    FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*)
    FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_entities', COUNT(*)
    FROM data_coverage_entities
    ORDER BY object_name;
  "
```

Expected durable progression:

```text
Unit 3 complete → 1500 / 1500 / 1500 and nextSequence 3
Unit 4 complete → 2000 / 2000 / 2000 and nextSequence 4
Unit 5 complete → 2021 / 2021 / 2021 and nextSequence 5
```

A transient mid-Unit interruption must leave the phase checkpoint unchanged and replay that Unit idempotently.

## 8. Final reconciliation

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT lifecycle_status, generation, requested_at, completion_json, completed_at
    FROM sync_work_runs
    WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964';

    SELECT complete, state_json
    FROM sync_work_phases
    WHERE work_key='tiktok:f59b852f00634005c7ff4da51afee964'
      AND phase='tiktok_organic_history_write_v1';

    SELECT status, redrive_reference, redriven_at
    FROM dead_letter_jobs
    WHERE dlq_id='dlq:8d1b9077657385a417cb32a0ed3114cb';

    SELECT recovery_status, operation_id, original_work_key, generation,
           original_requested_at, recovery_reference,
           recovery_started_at, recovery_completed_at, audit_reference
    FROM dead_letter_operation_metadata
    WHERE dlq_id='dlq:8d1b9077657385a417cb32a0ed3114cb';

    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count
    FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*)
    FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_entities', COUNT(*)
    FROM data_coverage_entities
    ORDER BY object_name;

    SELECT COUNT(*) AS initial_observations
    FROM organic_content_observations
    WHERE observed_at=1784829780000
      AND observation_kind='initial';

    SELECT content_key, COUNT(*) AS duplicate_count
    FROM organic_content_state
    GROUP BY content_key
    HAVING COUNT(*) > 1;

    SELECT observation_key, COUNT(*) AS duplicate_count
    FROM organic_content_observations
    GROUP BY observation_key
    HAVING COUNT(*) > 1;

    SELECT coverage_run_id, status, expected_entities, observed_entities,
           expected_rows, observed_rows, failed_rows, completed_at
    FROM data_coverage_runs
    WHERE customer_key='chemistry_k'
      AND platform='tiktok'
      AND account_key='chemistry_k'
      AND dataset_key='organic_content_cumulative'
    ORDER BY created_at DESC
    LIMIT 5;
  "
```

Final acceptance is all-or-nothing:

```text
original Work lifecycle_status = completed
write phase complete = 1
rawRecordsCompleted = 2021
contentRowsDurable = 2021
observationRowsDurable = 2021
coverageEntitiesWritten = 2021
State / Observation / Coverage entity counts = 2021 / 2021 / 2021
initial observations at original timestamp = 2021
duplicate State keys = 0 rows
duplicate Observation keys = 0 rows
Coverage status = complete
Coverage expected_entities = observed_entities = 2021
Coverage expected_rows = observed_rows = 2021
Coverage failed_rows = 0
exact DLQ status = redriven
recovery metadata status = completed
Lark contentWrites = 0
Lark dailyWrites = 0
```

## 9. Exact idempotent replay evidence

Capture final counts first. Then resend the same exact envelope once with a separate guard:

```bash
export CONFIRM_RECOVERY_IDEMPOTENT_REPLAY=""

if [ "$CONFIRM_RECOVERY_IDEMPOTENT_REPLAY" != "REPLAY_COMPLETED_EXACT_TIKTOK_RECOVERY_ONCE" ]; then
  echo "Idempotent replay not confirmed; stopping."
  exit 1
fi

curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/queues/$CF_QUEUE_ID/messages" \
  --data-binary @/tmp/tiktok-organic-history-recovery-envelope.json
```

After replay, all business counts, duplicate checks, completed Work, redriven DLQ and completed recovery metadata must remain unchanged. Operational attempt counters may increase; that is not a duplicate business fact.

## 10. Rollback

Rollback is configuration-first and non-destructive:

```text
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=false
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_CONNECTOR_TIKTOK_ENABLED=false
all schedule flags=false
```

Never:

- drop Migration `0010` tables or indexes;
- delete the 309 incident State rows or any completed facts;
- delete or rewrite the exact DLQ row or recovery audit metadata;
- restore the backup over newer data without a separate incident plan;
- modify Lark records;
- enable Report reader, Retention, Notification, Google Ads rollout or Production.

## Evidence package

Retain outside Git:

- checked-out main SHA and Branch Verification IDs;
- `wrangler whoami` and D1 info output;
- exact incident preflight output;
- backup filename and SHA-256;
- migration list before and after apply;
- schema verification and unchanged pre-recovery counts;
- reviewed schedule-disabled config diff and deployed Worker version;
- exact payload and Queue API response with secrets removed;
- per-Unit checkpoint/count evidence;
- final Work, phase, Coverage, DLQ and metadata reconciliation;
- duplicate-key queries;
- exact idempotent replay before/after counts;
- rollback config diff, whether used or not.
