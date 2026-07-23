# TikTok Organic D1 Bootstrap — Integration Workspace Runbook

## Status and boundary

This runbook is for the developer-owned **Integration Workspace** only.

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
```

It does not authorize Production, schedules, Report cutover, Lark retention, Google Ads work or a full TikTok RAW → Lark Canonical sync.

The first controlled bootstrap destination is:

```text
RAW_TikTok_Creator_Videos
→ D1 organic_content_state
→ D1 organic_content_observations
→ D1 data_coverage_runs
→ D1 data_coverage_entities
```

`MKT_Content` and `MKT_Content_Daily` must receive **zero** writes from the bootstrap job.

## Stop conditions

Stop immediately and do not continue to the next step when any of these is true:

- the Cloudflare account, D1 database or Queue is not the Integration Workspace resource;
- `main` does not contain the approved bootstrap implementation;
- any business schedule is enabled;
- the remote D1 backup fails or its checksum is missing;
- pending migrations contain anything unexpected besides the reviewed additive migration set;
- Migration `0009` tables or indexes do not reconcile;
- Dry-run reports any Lark write;
- source identity is not exactly `@chemistry_k`;
- Coverage is `partial`, `source_unavailable` or otherwise not `complete` for the intended full inventory;
- duplicate Stable keys are found;
- D1 counts do not reconcile with the Sync Log result;
- any secret appears in logs or persisted payloads.

## Local prerequisites

Use the repository root and the real local Integration Workspace Wrangler config. Never commit that config or secrets.

```bash
set -euo pipefail

export WRANGLER_CONFIG="wrangler.sync.jsonc"
export MKT_D1_DATABASE_NAME="social-mkt-state-dev"
export MKT_QUEUE_NAME="social-mkt-sync-jobs"
export BACKUP_DIR="./backups/d1"

# Required only for the HTTP Queue push step.
export CF_ACCOUNT_ID="replace-with-integration-workspace-account-id"
export CF_QUEUE_ID="replace-with-integration-workspace-queue-id"
export CLOUDFLARE_API_TOKEN="replace-with-token-having-queues-edit-only"

npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Before every remote command, confirm the active Cloudflare account and resource names manually.

## 1. Read-only remote D1 inspection

```bash
npx wrangler whoami
npx wrangler d1 info "$MKT_D1_DATABASE_NAME" --config "$WRANGLER_CONFIG"

npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="SELECT name, type FROM sqlite_schema WHERE type IN ('table','index') ORDER BY type, name;"
```

Capture current operational row counts before applying any migration:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT 'sync_runs' AS object_name, COUNT(*) AS row_count FROM sync_runs
    UNION ALL SELECT 'sync_jobs', COUNT(*) FROM sync_jobs
    UNION ALL SELECT 'sync_locks', COUNT(*) FROM sync_locks
    UNION ALL SELECT 'dead_letter_jobs', COUNT(*) FROM dead_letter_jobs
    UNION ALL SELECT 'system_alerts', COUNT(*) FROM system_alerts
    ORDER BY object_name;
  "
```

Save the terminal output in the rollout evidence folder. Do not infer D1 capacity from repository schema alone; retain the `d1 info` output as the capacity baseline.

## 2. Export and checksum the remote D1 backup

```bash
mkdir -p "$BACKUP_DIR"
export BACKUP_FILE="$BACKUP_DIR/social-mkt-state-dev-before-0009-$(date -u +%Y%m%dT%H%M%SZ).sql"

npx wrangler d1 export "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --output="$BACKUP_FILE"

shasum -a 256 "$BACKUP_FILE" | tee "$BACKUP_FILE.sha256"
test -s "$BACKUP_FILE"
test -s "$BACKUP_FILE.sha256"
```

Do not continue if the export or checksum command fails.

## 3. Review pending migrations

```bash
npx wrangler d1 migrations list "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG"
```

The reviewer must compare the pending list with `migrations/0009_storage_foundation.sql`. If any unreviewed migration is pending, stop and create a separate migration review.

## 4. Guarded additive Migration apply

This command applies all pending migrations, so the previous review is mandatory.

```bash
export CONFIRM_REMOTE_D1_MIGRATION=""

if [ "$CONFIRM_REMOTE_D1_MIGRATION" != "APPLY_0009_TO_INTEGRATION_WORKSPACE" ]; then
  echo "Remote D1 migration not confirmed; stopping."
  exit 1
fi

npx wrangler d1 migrations apply "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG"
```

This repository task does not run the command automatically.

## 5. Verify Migration `0009`

All ten Storage Foundation tables must exist:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT name
    FROM sqlite_schema
    WHERE type='table' AND name IN (
      'organic_content_state',
      'organic_content_observations',
      'organic_account_daily_facts',
      'ads_entity_state',
      'ads_daily_facts',
      'ads_conversion_daily_facts',
      'data_coverage_runs',
      'data_coverage_entities',
      'report_materializations',
      'report_requests'
    )
    ORDER BY name;
  "
```

Before the first bootstrap, the four Organic target tables should normally contain zero rows:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*) FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_runs', COUNT(*) FROM data_coverage_runs
    UNION ALL SELECT 'data_coverage_entities', COUNT(*) FROM data_coverage_entities
    ORDER BY object_name;
  "
```

Unexpected pre-existing rows require reconciliation before continuing. Never delete them to make counts look clean.

## 6. Guarded Worker configuration and deployment

A deployment is a separate approved rollout action. Keep all schedules false.

The Integration Workspace runtime must use:

```text
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
```

Review the diff of the real local Wrangler config, then use an explicit deployment guard:

```bash
export CONFIRM_BOOTSTRAP_DEPLOY=""

if [ "$CONFIRM_BOOTSTRAP_DEPLOY" != "DEPLOY_D1_BOOTSTRAP_TO_INTEGRATION_WORKSPACE" ]; then
  echo "Bootstrap deployment not confirmed; stopping."
  exit 1
fi

npx wrangler deploy --config "$WRANGLER_CONFIG"
```

No schedule flag may be enabled by this deployment.

## 7. Build the Dry-run payload

The helper prints a job body only; it never sends a Queue message.

```bash
export REQUESTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DRY_RUN=true npm run --silent job:tiktok-history-bootstrap \
  > /tmp/tiktok-organic-history-dry-run.json

cat /tmp/tiktok-organic-history-dry-run.json
jq -e '
  .schemaVersion == 1 and
  .type == "tiktok.creator.native.history.bootstrap" and
  .trigger == "manual" and
  .dryRun == true
' /tmp/tiktok-organic-history-dry-run.json

jq '{body: .}' /tmp/tiktok-organic-history-dry-run.json \
  > /tmp/tiktok-organic-history-dry-run-envelope.json
```

## 8. Send the Dry-run message manually

Cloudflare's Queue HTTP Push API requires an API token with Queues Edit permission. Use a narrow Integration Workspace token and never store it in Git or Lark.

```bash
export CONFIRM_DRY_RUN_QUEUE_SEND=""

if [ "$CONFIRM_DRY_RUN_QUEUE_SEND" != "SEND_TIKTOK_D1_BOOTSTRAP_DRY_RUN" ]; then
  echo "Dry-run Queue send not confirmed; stopping."
  exit 1
fi

curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/queues/$CF_QUEUE_ID/messages" \
  --data-binary @/tmp/tiktok-organic-history-dry-run-envelope.json
```

Dry-run acceptance evidence:

- `operation=organic_history_bootstrap`;
- `mode=dry_run`;
- `destinationMode=d1_only`;
- planned state rows reconcile with valid selected Content;
- planned observation rows are visible;
- D1 Marketing-history target row counts remain unchanged;
- `lark.contentWrites=0` and `lark.dailyWrites=0`;
- source identity matches `@chemistry_k`;
- no secret or raw customer identity leaks into operational errors.

Operational Reliability/Resumable tables may receive Dry-run audit rows; those are not Marketing-history business facts.

## 9. Capture pre-live target counts

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*) FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_runs', COUNT(*) FROM data_coverage_runs
    UNION ALL SELECT 'data_coverage_entities', COUNT(*) FROM data_coverage_entities
    ORDER BY object_name;
  " | tee /tmp/tiktok-organic-history-before-live.txt
```

## 10. Build and send the bounded Live D1-only payload

Use a new `REQUESTED_AT`; do not reuse the completed Dry-run work.

```bash
export REQUESTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DRY_RUN=false npm run --silent job:tiktok-history-bootstrap \
  > /tmp/tiktok-organic-history-live.json

jq -e '
  .schemaVersion == 1 and
  .type == "tiktok.creator.native.history.bootstrap" and
  .trigger == "manual" and
  .dryRun == false
' /tmp/tiktok-organic-history-live.json

jq '{body: .}' /tmp/tiktok-organic-history-live.json \
  > /tmp/tiktok-organic-history-live-envelope.json

export CONFIRM_LIVE_D1_BOOTSTRAP=""

if [ "$CONFIRM_LIVE_D1_BOOTSTRAP" != "WRITE_TIKTOK_HISTORY_TO_D1_ONLY" ]; then
  echo "Live D1-only bootstrap not confirmed; stopping."
  exit 1
fi

curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/queues/$CF_QUEUE_ID/messages" \
  --data-binary @/tmp/tiktok-organic-history-live-envelope.json
```

## 11. Reconcile D1 facts and Coverage

Capture target counts:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT 'organic_content_state' AS object_name, COUNT(*) AS row_count FROM organic_content_state
    UNION ALL SELECT 'organic_content_observations', COUNT(*) FROM organic_content_observations
    UNION ALL SELECT 'data_coverage_runs', COUNT(*) FROM data_coverage_runs
    UNION ALL SELECT 'data_coverage_entities', COUNT(*) FROM data_coverage_entities
    ORDER BY object_name;
  " | tee /tmp/tiktok-organic-history-after-live.txt
```

Stable-key duplicate checks must return zero rows:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT content_key, COUNT(*) AS duplicate_count
    FROM organic_content_state
    GROUP BY content_key
    HAVING COUNT(*) > 1;

    SELECT observation_key, COUNT(*) AS duplicate_count
    FROM organic_content_observations
    GROUP BY observation_key
    HAVING COUNT(*) > 1;
  "
```

Inspect the latest Coverage runs:

```bash
npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT
      coverage_run_id,
      status,
      expected_entities,
      observed_entities,
      expected_rows,
      observed_rows,
      written_rows,
      failed_rows,
      started_at,
      completed_at
    FROM data_coverage_runs
    WHERE customer_key='chemistry_k'
      AND platform='tiktok'
      AND account_key='chemistry_k'
      AND dataset_key='organic_content_cumulative'
    ORDER BY created_at DESC
    LIMIT 5;
  "
```

For the selected latest `coverage_run_id`, reconcile the entity ledger:

```bash
export COVERAGE_RUN_ID="replace-with-latest-coverage-run-id"

npx wrangler d1 execute "$MKT_D1_DATABASE_NAME" \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --command="
    SELECT observation_status, COUNT(*) AS entity_count
    FROM data_coverage_entities
    WHERE coverage_run_id='$COVERAGE_RUN_ID'
    GROUP BY observation_status
    ORDER BY observation_status;
  "
```

Acceptance requires:

```text
Coverage status = complete
expected_entities = observed_entities
expected_rows = observed_rows
failed_rows = 0
organic_content_state rows = unique valid TikTok Content identities
first bootstrap observations = one initial observation per valid Content
Lark writes = 0
```

A `partial` result is evidence to investigate, not permission to delete or zero unseen facts.

## 12. Controlled semantic rerun

Do not induce a failure merely to test Queue retry. Exact same-message retry idempotency is covered by automated durable-work tests.

For a live semantic rerun, send a new manual D1-only bootstrap after confirming the source has not changed. Expected behavior:

- a new Coverage run is created;
- Current state `last_observed_at` advances;
- unchanged metrics create zero new Observation rows;
- changed metrics create exactly one new Observation per changed Content;
- decreased cumulative counters are recorded as `correction`;
- no Lark writes occur.

Record Observation count before and after the rerun and compare it with the job result.

## 13. Rollback

Rollback is configuration-first and non-destructive.

Set:

```text
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=false
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_CONNECTOR_TIKTOK_ENABLED=false
```

Keep all schedules false, review the config diff and deploy the rollback version through the same explicit deployment approval process.

Rollback must not:

- delete D1 Current state, Observation or Coverage facts;
- roll back Migration `0009` by dropping tables;
- modify or delete Lark records;
- relabel legacy account/profile data;
- enable Report D1 reader, retention, Notification or Production.

The pre-migration export is a disaster-recovery artifact, not a routine rollback command. Restoring it requires a separate incident plan because it can overwrite newer operational data.

## Evidence package

Retain together:

- reviewed `main` commit SHA;
- Branch Verification run IDs;
- `wrangler whoami` and D1 info output;
- migration list before and after apply;
- backup file name and SHA-256;
- Dry-run payload/result;
- pre-live and post-live D1 counts;
- latest Coverage row and entity reconciliation;
- duplicate-key query output;
- semantic rerun counts;
- rollback config diff, whether used or not.
