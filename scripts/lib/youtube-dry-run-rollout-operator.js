import { createHash } from 'node:crypto';
import {
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';
import {
  createStableQueueOperationBody,
} from '../../packages/application/src/jobs/queue-operation.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION = 'youtube-dry-run-rollout-v1';

export const YOUTUBE_DRY_RUN_OPERATOR_PHASES = Object.freeze([
  'plan',
  'preflight',
  'deploy-safe-baseline',
  'verify-safe-baseline',
  'deploy-dry-run-gates',
  'verify-deployment',
  'snapshot-operational-state',
  'send-one-dry-run',
  'verify-dry-run',
  'restore-all-false',
  'verify-restore',
  'summary',
]);

export const YOUTUBE_DRY_RUN_CONFIRMATIONS = deepFreeze({
  preflight: confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_PREFLIGHT',
    'PREFLIGHT_YOUTUBE_DRY_RUN_ROLLOUT',
  ),
  'deploy-safe-baseline': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_DEPLOY_SAFE',
    'DEPLOY_YOUTUBE_DRY_RUN_SAFE_BASELINE',
  ),
  'verify-safe-baseline': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_VERIFY_SAFE',
    'VERIFY_YOUTUBE_DRY_RUN_SAFE_BASELINE',
  ),
  'deploy-dry-run-gates': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_ENABLE',
    'DEPLOY_YOUTUBE_DRY_RUN_GATES',
  ),
  'verify-deployment': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_VERIFY_DEPLOYMENT',
    'VERIFY_YOUTUBE_DRY_RUN_DEPLOYMENT',
  ),
  'snapshot-operational-state': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_SNAPSHOT',
    'SNAPSHOT_YOUTUBE_DRY_RUN_OPERATION',
  ),
  'send-one-dry-run': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_SEND',
    'SEND_ONE_YOUTUBE_DRY_RUN',
  ),
  'verify-dry-run': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_VERIFY',
    'VERIFY_ONE_YOUTUBE_DRY_RUN',
  ),
  'restore-all-false': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_RESTORE',
    'RESTORE_YOUTUBE_DRY_RUN_ALL_FALSE',
  ),
  'verify-restore': confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_VERIFY_RESTORE',
    'VERIFY_YOUTUBE_DRY_RUN_RESTORE',
  ),
  summary: confirmation(
    'CONFIRM_YOUTUBE_DRY_RUN_SUMMARY',
    'SUMMARIZE_YOUTUBE_DRY_RUN_ROLLOUT',
  ),
});

export const YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST = Object.freeze([
  'queue_operation_attempts',
  'reliability_mirror_outbox',
  'sync_generation_fences',
  'sync_locks',
  'sync_runs',
  'sync_work_phases',
  'sync_work_runs',
  'sync_work_units',
  'system_alerts',
]);

export const YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES = Object.freeze([
  'data_coverage_entities',
  'data_coverage_runs',
  'organic_account_daily_facts',
  'organic_content_observations',
  'organic_content_state',
  'source_record_states',
  'sync_cursors',
  'youtube_lark_records',
]);

const FULL_GIT_SHA = /^[0-9a-f]{40}$/u;
const VERSION_ID = /^[0-9a-f-]{36}$/u;
const SAFE_OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/u;
const EXECUTABLE_PHASES = new Set(
  YOUTUBE_DRY_RUN_OPERATOR_PHASES.filter((phase) => phase !== 'plan'),
);
const POST_ACTIVATION_PHASES = new Set([
  'deploy-dry-run-gates',
  'verify-deployment',
  'snapshot-operational-state',
  'send-one-dry-run',
  'verify-dry-run',
]);
const TRUE_DURING_DRY_RUN = Object.freeze([
  'MKT_CONNECTOR_YOUTUBE_ENABLED',
  'MKT_YOUTUBE_END_TO_END_ENABLED',
]);
const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
  'MKT_YOUTUBE_LARK_WRITE_ENABLED',
  'MKT_YOUTUBE_ANALYTICS_ENABLED',
  'MKT_SCHEDULE_YOUTUBE_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED',
  'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_CONNECTOR_INSTAGRAM_ENABLED',
  'MKT_CONNECTOR_META_ADS_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED',
  'MKT_META_REPORT_READ_ENABLED',
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
  'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
  'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
  'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  'MKT_TIKTOK_AUDIT_HTTP_ENABLED',
  'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED',
  'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED',
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
  'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
  'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
]);
const REQUIRED_LARK_MAPPINGS = Object.freeze([
  'LARK_TABLE_MKT_ACCOUNTS',
  'LARK_TABLE_RAW_YOUTUBE_CHANNELS',
  'LARK_TABLE_RAW_YOUTUBE_VIDEOS',
  'LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY',
  'LARK_TABLE_MKT_CONTENT',
  'LARK_TABLE_MKT_CONTENT_DAILY',
  'LARK_TABLE_MKT_SYNC_LOG',
  'LARK_TABLE_MKT_SYSTEM_ALERTS',
]);
const EXPECTED_CRONS = Object.freeze([
  '*/5 * * * *',
  '50 0,6,12,18 * * *',
]);
const EVIDENCE_PHASE_FILES = deepFreeze({
  plan: 'plan.json',
  preflight: 'preflight.json',
  'deploy-safe-baseline': 'deploy-safe-baseline.json',
  'verify-safe-baseline': 'verify-safe-baseline.json',
  'deploy-dry-run-gates': 'deploy-dry-run-gates.json',
  'verify-deployment': 'verify-deployment.json',
  'snapshot-operational-state': 'snapshot-operational-state.json',
  'send-one-dry-run': 'send-one-dry-run.json',
  'verify-dry-run': 'verify-dry-run.json',
  'restore-all-false': 'restore-all-false.json',
  'verify-restore': 'verify-restore.json',
  summary: 'summary.json',
});
const PRIOR_PHASE = new Map(
  YOUTUBE_DRY_RUN_OPERATOR_PHASES
    .slice(1)
    .map((phase, index) => [phase, YOUTUBE_DRY_RUN_OPERATOR_PHASES[index]]),
);

export function parseYouTubeDryRunOperatorArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg.startsWith('--phase=')) {
      phase = arg.slice('--phase='.length);
      continue;
    }
    throw operatorError(
      `Unknown YouTube dry-run rollout argument: ${arg}`,
      'YOUTUBE_DRY_RUN_OPERATOR_ARGUMENT_INVALID',
    );
  }
  if (!YOUTUBE_DRY_RUN_OPERATOR_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported YouTube dry-run rollout phase: ${phase}`,
      'YOUTUBE_DRY_RUN_OPERATOR_PHASE_INVALID',
      { phase },
    );
  }
  if (phase === 'plan' && execute) {
    throw operatorError(
      'Plan phase does not accept --execute',
      'YOUTUBE_DRY_RUN_OPERATOR_PLAN_EXECUTE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertYouTubeDryRunConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const expected = YOUTUBE_DRY_RUN_CONFIRMATIONS[phase];
  if (env?.[expected.envName] !== expected.value) {
    throw operatorError(
      `YouTube dry-run rollout requires ${expected.envName}=${expected.value}`,
      'YOUTUBE_DRY_RUN_OPERATOR_CONFIRMATION_REQUIRED',
      { phase, envName: expected.envName },
    );
  }
  return true;
}

export function loadYouTubeDryRunTarget(env = {}) {
  const repositoryHead = requireFullGitSha(
    env.MKT_YOUTUBE_DRY_RUN_REPOSITORY_HEAD,
    'MKT_YOUTUBE_DRY_RUN_REPOSITORY_HEAD',
  );
  const operationId = requireSafeOperationId(
    env.MKT_YOUTUBE_DRY_RUN_OPERATION_ID,
    'MKT_YOUTUBE_DRY_RUN_OPERATION_ID',
  );
  const originalRequestedAt = requireTimestamp(
    env.MKT_YOUTUBE_DRY_RUN_ORIGINAL_REQUESTED_AT,
    'MKT_YOUTUBE_DRY_RUN_ORIGINAL_REQUESTED_AT',
  );
  const target = {
    environment: requireExact(env.MKT_ENV, 'development', 'MKT_ENV'),
    customerProfile: requireExact(
      env.MKT_CUSTOMER_PROFILE,
      'integration_workspace',
      'MKT_CUSTOMER_PROFILE',
    ),
    customerKey: requireExact(
      env.MKT_CONNECTION_CUSTOMER_KEY,
      'chemistry_k',
      'MKT_CONNECTION_CUSTOMER_KEY',
    ),
    connectorAccountKey: requireExact(
      env.MKT_YOUTUBE_DRY_RUN_ACCOUNT_KEY,
      'dev_ft_pumkin',
      'MKT_YOUTUBE_DRY_RUN_ACCOUNT_KEY',
    ),
    channelId: requireText(
      env.MKT_YOUTUBE_DRY_RUN_EXPECTED_CHANNEL_ID,
      'MKT_YOUTUBE_DRY_RUN_EXPECTED_CHANNEL_ID',
    ),
    workerName: requireExact(
      env.MKT_YOUTUBE_DRY_RUN_WORKER_NAME,
      'social-mkt-sync-worker',
      'MKT_YOUTUBE_DRY_RUN_WORKER_NAME',
    ),
    databaseName: requireExact(
      env.MKT_YOUTUBE_DRY_RUN_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_YOUTUBE_DRY_RUN_DATABASE_NAME',
    ),
    mainQueueName: requireExact(
      env.MKT_YOUTUBE_DRY_RUN_MAIN_QUEUE,
      'social-mkt-sync-jobs',
      'MKT_YOUTUBE_DRY_RUN_MAIN_QUEUE',
    ),
    dlqName: requireExact(
      env.MKT_YOUTUBE_DRY_RUN_DLQ,
      'social-mkt-sync-dlq',
      'MKT_YOUTUBE_DRY_RUN_DLQ',
    ),
    expectedActiveVersion: requireVersionId(
      env.MKT_YOUTUBE_DRY_RUN_EXPECTED_ACTIVE_VERSION,
      'MKT_YOUTUBE_DRY_RUN_EXPECTED_ACTIVE_VERSION',
    ),
    safeConfigPath: requireText(
      env.MKT_YOUTUBE_DRY_RUN_SAFE_WRANGLER_CONFIG,
      'MKT_YOUTUBE_DRY_RUN_SAFE_WRANGLER_CONFIG',
    ),
    activeConfigPath: requireText(
      env.MKT_YOUTUBE_DRY_RUN_ACTIVE_WRANGLER_CONFIG,
      'MKT_YOUTUBE_DRY_RUN_ACTIVE_WRANGLER_CONFIG',
    ),
    accountId: optionalText(env.CLOUDFLARE_ACCOUNT_ID),
    queueId: optionalText(env.MKT_YOUTUBE_DRY_RUN_QUEUE_ID),
    operationId,
    workKey: `youtube:${operationId}`,
    syncRunId: `youtube-dry-run:${operationId}`,
    originalRequestedAt,
    generation: originalRequestedAt,
    repositoryHead,
  };
  return deepFreeze({
    ...target,
    targetFingerprint: fingerprintTarget(target),
  });
}

export function validateYouTubeDryRunRepositoryState(input = {}) {
  const observedHead = requireFullGitSha(input.observedHead, 'observedHead');
  const expectedHead = requireFullGitSha(input.expectedHead, 'expectedHead');
  if (observedHead !== expectedHead) {
    throw operatorError(
      'Repository HEAD changed from the explicitly reviewed target',
      'YOUTUBE_DRY_RUN_REPOSITORY_HEAD_MISMATCH',
      { expectedHead, observedHead },
    );
  }
  if (input.workingTreeClean !== true) {
    throw operatorError(
      'YouTube dry-run rollout requires a clean Working Tree',
      'YOUTUBE_DRY_RUN_WORKING_TREE_DIRTY',
    );
  }
  return Object.freeze({ repositoryHead: observedHead, workingTreeClean: true });
}

export function validateYouTubeDryRunConfig(configText, input = {}) {
  const text = requireText(configText, 'configText');
  const active = input.active === true;
  requireConfigString(text, 'name', 'social-mkt-sync-worker');
  requireConfigString(text, 'MKT_ENV', 'development');
  requireConfigString(text, 'MKT_CUSTOMER_PROFILE', 'integration_workspace');
  requireConfigString(text, 'MKT_CONNECTION_CUSTOMER_KEY', 'chemistry_k');
  requireConfigString(text, 'YOUTUBE_CHANNEL_ID', requireText(input.channelId, 'channelId'));
  requireConfigString(text, 'database_name', 'social-mkt-state-dev');
  requireConfigStringValue(text, 'binding', 'MKT_STATE_DB');
  requireConfigStringValue(text, 'binding', 'MKT_SYNC_QUEUE');
  requireConfigStringValue(text, 'queue', 'social-mkt-sync-jobs');
  requireConfigStringValue(text, 'queue', 'social-mkt-sync-dlq');
  requireConfigString(text, 'dead_letter_queue', 'social-mkt-sync-dlq');
  requireConfigNumberOccurrences(text, 'max_concurrency', 1, 2);
  requireConfigNumberOccurrences(text, 'max_batch_size', 10, 2);
  requireConfigNumberOccurrences(text, 'max_batch_timeout', 30, 2);
  requireConfigNumberOccurrences(text, 'max_retries', 5, 1);
  requireConfigNumberOccurrences(text, 'max_retries', 10, 1);
  requireConfigBoolean(text, 'MKT_CONNECTOR_YOUTUBE_ENABLED', active);
  requireConfigBoolean(text, 'MKT_YOUTUBE_END_TO_END_ENABLED', active);
  for (const flag of REQUIRED_FALSE_FLAGS) requireConfigBoolean(text, flag, false);
  for (const mapping of REQUIRED_LARK_MAPPINGS) {
    const value = readConfigString(text, mapping);
    if (!isRealMapping(value)) {
      throw unsafeConfig(`YouTube dry-run rollout requires a real ${mapping}`, mapping);
    }
  }
  const trueFlags = [...text.matchAll(
    /"(MKT_[A-Z0-9_]+_ENABLED)"\s*:\s*(?:"true"|true)/gu,
  )].map((match) => match[1]).sort();
  const allowedTrue = active ? [...TRUE_DURING_DRY_RUN].sort() : [];
  if (JSON.stringify(trueFlags) !== JSON.stringify(allowedTrue)) {
    throw operatorError(
      'YouTube dry-run config contains an unapproved true flag',
      'YOUTUBE_DRY_RUN_CONFIG_EXTRA_TRUE_FLAG',
      { trueFlags },
    );
  }
  const crons = readConfigArrayStrings(text, 'crons');
  if (JSON.stringify(crons) !== JSON.stringify(EXPECTED_CRONS)) {
    throw operatorError(
      'YouTube dry-run config changed the approved Cron set',
      'YOUTUBE_DRY_RUN_CONFIG_CRON_DRIFT',
      { crons },
    );
  }
  const routes = readConfigArrayStrings(text, 'routes', { optional: true });
  const workersDev = readOptionalConfigBoolean(text, 'workers_dev');
  return deepFreeze({
    active,
    trueFlags,
    falseFlags: REQUIRED_FALSE_FLAGS,
    crons,
    routes,
    workersDev,
    bindingFingerprint: sha256(stableJson({
      worker: 'social-mkt-sync-worker',
      d1Binding: 'MKT_STATE_DB',
      d1Database: 'social-mkt-state-dev',
      queueBinding: 'MKT_SYNC_QUEUE',
      mainQueue: 'social-mkt-sync-jobs',
      dlq: 'social-mkt-sync-dlq',
      consumers: {
        main: {
          maxConcurrency: 1,
          maxBatchSize: 10,
          maxBatchTimeout: 30,
          maxRetries: 5,
        },
        dlq: {
          maxConcurrency: 1,
          maxBatchSize: 10,
          maxBatchTimeout: 30,
          maxRetries: 10,
        },
      },
      crons,
      routes,
      workersDev,
    })),
    flagFingerprint: sha256(stableJson({ trueFlags, falseFlags: REQUIRED_FALSE_FLAGS })),
  });
}

export function compareYouTubeDryRunConfigs(safeText, activeText, input = {}) {
  const safe = validateYouTubeDryRunConfig(safeText, { ...input, active: false });
  const active = validateYouTubeDryRunConfig(activeText, { ...input, active: true });
  if (safe.bindingFingerprint !== active.bindingFingerprint
    || JSON.stringify(safe.crons) !== JSON.stringify(active.crons)
    || JSON.stringify(safe.routes) !== JSON.stringify(active.routes)
    || safe.workersDev !== active.workersDev) {
    throw operatorError(
      'Safe and dry-run configs contain binding/Cron/route drift',
      'YOUTUBE_DRY_RUN_CONFIG_TARGET_DRIFT',
    );
  }
  const normalizedSafe = normalizeFlagWindow(safeText);
  const normalizedActive = normalizeFlagWindow(activeText);
  if (normalizedSafe !== normalizedActive) {
    throw operatorError(
      'Dry-run config changes fields outside the two approved YouTube gates',
      'YOUTUBE_DRY_RUN_CONFIG_UNAPPROVED_DIFF',
    );
  }
  return deepFreeze({ safe, active, approvedDiff: TRUE_DURING_DRY_RUN });
}

export function buildYouTubeDryRunDeploymentMessage(phase, repositoryHead) {
  if (!['deploy-safe-baseline', 'deploy-dry-run-gates', 'restore-all-false'].includes(phase)) {
    throw operatorError(
      'Deployment message requested for a non-deployment phase',
      'YOUTUBE_DRY_RUN_DEPLOYMENT_PHASE_INVALID',
      { phase },
    );
  }
  const head = requireFullGitSha(repositoryHead, 'repositoryHead');
  return `${YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION} phase=${phase} git=${head}`;
}

export function buildYouTubeDryRunJob(input = {}) {
  const operationId = requireSafeOperationId(input.operationId, 'operationId');
  const originalRequestedAt = requireTimestamp(
    input.originalRequestedAt,
    'originalRequestedAt',
  );
  const metricDate = bangkokDate(originalRequestedAt);
  if (input.metricDate !== undefined && input.metricDate !== metricDate) {
    throw operatorError(
      'YouTube dry-run metricDate must match generation in Asia/Bangkok',
      'YOUTUBE_DRY_RUN_METRIC_DATE_MISMATCH',
      { expectedMetricDate: metricDate },
    );
  }
  const syncMode = input.syncMode ?? 'incremental';
  if (!['incremental', 'full'].includes(syncMode)) {
    throw operatorError(
      'YouTube dry-run syncMode must be incremental or full',
      'YOUTUBE_DRY_RUN_SYNC_MODE_INVALID',
    );
  }
  return createStableQueueOperationBody({
    schemaVersion: 1,
    type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
    trigger: JOB_TRIGGERS.YOUTUBE_WORKER_DRY_RUN,
    dryRun: true,
    analyticsEnabled: false,
    metricDate,
    syncMode,
  }, {
    operationId,
    originalRequestedAt,
  });
}

export function buildYouTubeDryRunSnapshotSql(identity = {}) {
  const operationId = sqlText(requireSafeOperationId(identity.operationId, 'operationId'));
  const workKey = sqlText(requireExact(
    identity.workKey,
    `youtube:${identity.operationId}`,
    'workKey',
  ));
  const syncRunId = sqlText(requireExact(
    identity.syncRunId,
    `youtube-dry-run:${identity.operationId}`,
    'syncRunId',
  ));
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sync_runs WHERE sync_run_id = '${syncRunId}') AS sync_runs,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = '${syncRunId}') AS sync_locks,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id = '${operationId}'
        AND work_key = '${workKey}') AS queue_operation_attempts,
      (SELECT COALESCE(MAX(main_queue_attempts), 0) FROM queue_operation_attempts
        WHERE operation_id = '${operationId}') AS main_queue_attempts,
      (SELECT COUNT(*) FROM sync_work_runs WHERE work_key = '${workKey}') AS sync_work_runs,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = '${workKey}') AS sync_work_phases,
      (SELECT COUNT(*) FROM sync_work_units WHERE work_key = '${workKey}') AS sync_work_units,
      (SELECT COUNT(*) FROM sync_generation_fences WHERE work_key = '${workKey}')
        AS sync_generation_fences,
      (SELECT COUNT(*) FROM reliability_mirror_outbox
        WHERE outbox_id = 'reliability-mirror:sync-run:${syncRunId}')
        AS reliability_mirror_outbox,
      (SELECT COUNT(*) FROM system_alerts WHERE sync_run_id = '${syncRunId}') AS system_alerts,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata
        WHERE operation_id = '${operationId}') AS dlq_records,
      COALESCE((SELECT json_extract(details_json, '$.providerRequestCount')
        FROM sync_runs WHERE sync_run_id = '${syncRunId}'), 0) AS provider_requests,
      COALESCE((SELECT json_extract(details_json, '$.analyticsRequestCount')
        FROM sync_runs WHERE sync_run_id = '${syncRunId}'), 0) AS analytics_requests,
      COALESCE((SELECT json_extract(details_json, '$.oauthRefreshCount')
        FROM sync_runs WHERE sync_run_id = '${syncRunId}'), 0) AS oauth_refreshes,
      COALESCE((SELECT json_extract(details_json, '$.larkWriteCount')
        FROM sync_runs WHERE sync_run_id = '${syncRunId}'), 0) AS youtube_lark_records,
      (SELECT COUNT(*) FROM organic_content_state WHERE last_sync_run_id = '${syncRunId}')
        AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations WHERE sync_run_id = '${syncRunId}')
        AS organic_content_observations,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE sync_run_id = '${syncRunId}')
        AS organic_account_daily_facts,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = '${syncRunId}')
        AS data_coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_entities WHERE coverage_run_id IN (
        SELECT coverage_run_id FROM data_coverage_runs WHERE sync_run_id = '${syncRunId}'
      )) AS data_coverage_entities,
      (SELECT COUNT(*) FROM sync_cursors WHERE last_sync_run_id = '${syncRunId}'
        OR generation_work_key = '${workKey}') AS sync_cursors,
      (SELECT COUNT(*) FROM source_record_states WHERE last_seen_sync_run_id = '${syncRunId}')
        AS source_record_states;
  `);
}

export function validateYouTubeDryRunSnapshot(row = {}, input = {}) {
  const result = Object.fromEntries([
    ...YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST,
    ...YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES.filter(
      (name) => name !== 'youtube_lark_records',
    ),
    'main_queue_attempts',
    'dlq_records',
  ].map((name) => [name, nonNegativeInteger(row?.[name] ?? 0, name)]));
  const forbiddenChanged = YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES
    .filter((name) => name !== 'youtube_lark_records')
    .filter((name) => result[name] !== 0);
  if (forbiddenChanged.length > 0) {
    throw operatorError(
      'YouTube dry-run changed a forbidden Business resource',
      'YOUTUBE_DRY_RUN_BUSINESS_MUTATION_DETECTED',
      { forbiddenChanged },
    );
  }
  if (input.requireCompleted === true) {
    const missing = ['sync_runs', 'queue_operation_attempts', 'sync_work_runs']
      .filter((name) => result[name] < 1);
    if (missing.length > 0) {
      throw operatorError(
        'YouTube dry-run operational completion evidence is incomplete',
        'YOUTUBE_DRY_RUN_OPERATIONAL_EVIDENCE_INCOMPLETE',
        { missing },
      );
    }
    if (result.dlq_records !== 0) {
      throw operatorError(
        'YouTube dry-run operation appeared in the DLQ',
        'YOUTUBE_DRY_RUN_DLQ_DETECTED',
      );
    }
  }
  const boundary = {
    ...result,
    youtube_lark_records: nonNegativeInteger(
      input.youtubeLarkWrites ?? row.youtube_lark_records ?? 0,
      'youtubeLarkWrites',
    ),
    analyticsRequests: nonNegativeInteger(
      input.analyticsRequests ?? row.analytics_requests ?? 0,
      'analyticsRequests',
    ),
    oauthRefreshes: nonNegativeInteger(
      input.oauthRefreshes ?? row.oauth_refreshes ?? 0,
      'oauthRefreshes',
    ),
    providerRequests: nonNegativeInteger(
      input.providerRequests ?? row.provider_requests ?? 0,
      'providerRequests',
    ),
  };
  if (boundary.youtube_lark_records !== 0) {
    throw operatorError(
      'YouTube dry-run wrote a forbidden Lark target record',
      'YOUTUBE_DRY_RUN_BUSINESS_MUTATION_DETECTED',
      { forbiddenChanged: ['youtube_lark_records'] },
    );
  }
  return deepFreeze(boundary);
}

export function compareYouTubeDryRunSnapshots(before, after, input = {}) {
  const left = validateYouTubeDryRunSnapshot(before, input.before ?? {});
  const right = validateYouTubeDryRunSnapshot(after, {
    ...input.after,
    requireCompleted: true,
  });
  for (const name of YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES) {
    if (right[name] !== left[name]) {
      throw operatorError(
        'YouTube dry-run before/after evidence contains forbidden drift',
        'YOUTUBE_DRY_RUN_FORBIDDEN_DRIFT',
        { resource: name },
      );
    }
  }
  for (const name of ['analyticsRequests', 'oauthRefreshes']) {
    if (right[name] !== 0) {
      throw operatorError(
        'YouTube dry-run used a forbidden Provider capability',
        'YOUTUBE_DRY_RUN_PROVIDER_BOUNDARY_FAILED',
        { resource: name },
      );
    }
  }
  return deepFreeze({
    allowedOperationalMutations: YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST.filter(
      (name) => right[name] !== left[name],
    ),
    businessMutationCount: 0,
    larkWriteCount: 0,
    analyticsRequestCount: 0,
    oauthRefreshCount: 0,
    providerRequestCount: right.providerRequests,
  });
}

export function createYouTubeDryRunEvidence(input = {}) {
  const phase = requirePhase(input.phase);
  const repositoryHead = requireFullGitSha(input.repositoryHead, 'repositoryHead');
  const targetFingerprint = requireFingerprint(input.targetFingerprint, 'targetFingerprint');
  const operationId = input.operationId === null || input.operationId === undefined
    ? null
    : requireSafeOperationId(input.operationId, 'operationId');
  const evidence = {
    contractVersion: YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
    phase,
    repositoryHead,
    targetFingerprint,
    operationId,
    workKey: operationId ? `youtube:${operationId}` : null,
    syncRunId: operationId ? `youtube-dry-run:${operationId}` : null,
    createdAt: requireIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'createdAt'),
    data: sanitizeEvidenceValue(input.data ?? {}),
  };
  assertEvidenceSafe(evidence);
  return deepFreeze(evidence);
}

export function validateYouTubeDryRunEvidence(evidence = {}, expected = {}) {
  if (evidence.contractVersion !== YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION) {
    throw evidenceError('contractVersion');
  }
  if (expected.phase && evidence.phase !== expected.phase) throw evidenceError('phase');
  if (evidence.repositoryHead !== expected.repositoryHead) throw evidenceError('repositoryHead');
  if (evidence.targetFingerprint !== expected.targetFingerprint) {
    throw evidenceError('targetFingerprint');
  }
  if ((expected.operationId ?? null) !== (evidence.operationId ?? null)) {
    throw evidenceError('operationId');
  }
  assertEvidenceSafe(evidence);
  return deepFreeze(structuredClone(evidence));
}

export function validateYouTubeDryRunEvidenceChain(phase, priorEvidence, expected = {}) {
  const requiredPrior = PRIOR_PHASE.get(requirePhase(phase));
  if (!requiredPrior) return true;
  return validateYouTubeDryRunEvidence(priorEvidence, {
    ...expected,
    phase: requiredPrior,
  });
}

export function validateActiveYouTubeDeployment(status = {}, expectedVersion) {
  const versionId = requireVersionId(expectedVersion, 'expectedVersion');
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const active = versions.find((version) => Number(version?.percentage) === 100);
  if (!active || active.version_id !== versionId || versions.length !== 1) {
    throw operatorError(
      'Active Worker version guard failed',
      'YOUTUBE_DRY_RUN_ACTIVE_VERSION_MISMATCH',
      {
        expectedVersion: versionId,
        observedVersion: optionalText(active?.version_id),
      },
    );
  }
  return deepFreeze({
    deploymentId: optionalText(status.id),
    versionId,
    traffic: 100,
    createdAt: optionalText(status.created_on),
  });
}

export function buildEmergencyRestoreInstruction(input = {}) {
  const repositoryHead = requireFullGitSha(input.repositoryHead, 'repositoryHead');
  const safeConfigPath = requireText(input.safeConfigPath, 'safeConfigPath');
  return deepFreeze({
    required: true,
    automaticExecution: false,
    reasonCode: optionalStableCode(input.reasonCode) ?? 'YOUTUBE_DRY_RUN_POST_ACTIVATION_FAILURE',
    phase: 'restore-all-false',
    confirmation: YOUTUBE_DRY_RUN_CONFIRMATIONS['restore-all-false'],
    deploymentMessage: buildYouTubeDryRunDeploymentMessage(
      'restore-all-false',
      repositoryHead,
    ),
    command: [
      'npx',
      'wrangler',
      'deploy',
      '--strict',
      '--config',
      safeConfigPath,
      '--message',
      buildYouTubeDryRunDeploymentMessage('restore-all-false', repositoryHead),
    ],
  });
}

export function buildYouTubeDryRunPhasePlan(input = {}) {
  const phase = requirePhase(input.phase ?? 'plan');
  const target = input.target ?? {};
  const repositoryHead = requireFullGitSha(
    input.repositoryHead ?? target.repositoryHead,
    'repositoryHead',
  );
  const deployment = ['deploy-safe-baseline', 'deploy-dry-run-gates', 'restore-all-false']
    .includes(phase);
  const configPath = phase === 'deploy-dry-run-gates'
    ? target.activeConfigPath
    : target.safeConfigPath;
  const command = deployment
    ? [
      'npx', 'wrangler', 'deploy', '--strict', '--config', requireText(configPath, 'configPath'),
      '--message', buildYouTubeDryRunDeploymentMessage(phase, repositoryHead),
    ]
    : null;
  return deepFreeze({
    contractVersion: YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
    phase,
    planOnly: phase === 'plan',
    confirmation: YOUTUBE_DRY_RUN_CONFIRMATIONS[phase] ?? null,
    evidenceFile: EVIDENCE_PHASE_FILES[phase],
    command,
    remoteAction: deployment
      ? 'worker_deployment'
      : phase === 'send-one-dry-run'
        ? 'one_queue_message'
        : phase.includes('snapshot') || phase.includes('verify')
          ? 'read_only_verification'
          : 'none',
  });
}

export async function executeYouTubeDryRunOperatorPhase(input = {}, dependencies = {}) {
  const phase = requirePhase(input.phase ?? 'plan');
  if (phase === 'plan') {
    return buildYouTubeDryRunPhasePlan(input);
  }
  assertYouTubeDryRunConfirmation(phase, input.env);
  validateYouTubeDryRunRepositoryState({
    observedHead: input.repositoryHead,
    expectedHead: input.target?.repositoryHead,
    workingTreeClean: input.workingTreeClean,
  });
  if (typeof dependencies.readPriorEvidence === 'function') {
    const prior = await dependencies.readPriorEvidence(PRIOR_PHASE.get(phase));
    validateYouTubeDryRunEvidenceChain(phase, prior, {
      repositoryHead: input.repositoryHead,
      targetFingerprint: input.target.targetFingerprint,
      operationId: input.target.operationId,
    });
  }
  let originatedQueueSends = 0;
  try {
    let data;
    if (phase === 'send-one-dry-run') {
      const job = buildYouTubeDryRunJob(input.target);
      if (typeof dependencies.sendQueueMessage !== 'function') {
        throw operatorError(
          'send-one-dry-run requires an injected Queue sender',
          'YOUTUBE_DRY_RUN_QUEUE_SENDER_REQUIRED',
        );
      }
      if (typeof dependencies.writeQueueSendAttempt !== 'function') {
        throw operatorError(
          'send-one-dry-run requires a durable one-send marker',
          'YOUTUBE_DRY_RUN_QUEUE_SEND_MARKER_REQUIRED',
        );
      }
      await dependencies.writeQueueSendAttempt(createYouTubeDryRunEvidence({
        phase,
        repositoryHead: input.repositoryHead,
        targetFingerprint: input.target.targetFingerprint,
        operationId: input.target.operationId,
        createdAt: input.createdAt,
        data: {
          queueSendCommandCount: 1,
          status: 'attempt_started_no_automatic_resend',
          payloadFingerprint: sha256(stableJson(job)),
        },
      }));
      originatedQueueSends += 1;
      const result = await dependencies.sendQueueMessage(job);
      data = {
        queueSendCommandCount: originatedQueueSends,
        accepted: result?.accepted === true,
        payloadFingerprint: sha256(stableJson(job)),
      };
    } else if (phase === 'verify-dry-run') {
      if (typeof dependencies.verifyDryRun !== 'function') {
        throw operatorError(
          'verify-dry-run requires an injected read-only verifier',
          'YOUTUBE_DRY_RUN_VERIFIER_REQUIRED',
        );
      }
      data = {
        ...(await dependencies.verifyDryRun()),
        queueSendCommandCount: 0,
      };
    } else if (typeof dependencies.runPhase === 'function') {
      data = await dependencies.runPhase(buildYouTubeDryRunPhasePlan(input));
    } else {
      data = buildYouTubeDryRunPhasePlan(input);
    }
    const evidence = createYouTubeDryRunEvidence({
      phase,
      repositoryHead: input.repositoryHead,
      targetFingerprint: input.target.targetFingerprint,
      operationId: input.target.operationId,
      createdAt: input.createdAt,
      data,
    });
    await dependencies.writeEvidence?.(phase, evidence);
    return evidence;
  } catch (cause) {
    if (POST_ACTIVATION_PHASES.has(phase)) {
      const emergencyRestore = buildEmergencyRestoreInstruction({
        repositoryHead: input.repositoryHead,
        safeConfigPath: input.target.safeConfigPath,
        reasonCode: cause?.code,
      });
      await dependencies.writeEmergencyRestore?.(emergencyRestore);
      cause.emergencyRestore = emergencyRestore;
    }
    throw cause;
  }
}

export function sanitizeEvidenceValue(value, key = '') {
  if (isForbiddenEvidenceKey(key)) return '[REDACTED]';
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => sanitizeEvidenceValue(item)));
  }
  if (typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([name, nested]) => [
        name,
        sanitizeEvidenceValue(nested, name),
      ]),
    ));
  }
  if (typeof value === 'string' && looksLikeSecret(value)) return '[REDACTED]';
  return value;
}

export function assertEvidenceSafe(value) {
  const text = JSON.stringify(value);
  if (/(?:Bearer\s+[A-Za-z0-9._~-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu.test(text)
    || containsUnredactedForbiddenEvidence(value)) {
    throw operatorError(
      'YouTube dry-run evidence contains Secret-like material',
      'YOUTUBE_DRY_RUN_EVIDENCE_UNSAFE',
    );
  }
  return true;
}

function containsUnredactedForbiddenEvidence(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsUnredactedForbiddenEvidence);
  return Object.entries(value).some(([key, nested]) => (
    (isForbiddenEvidenceKey(key) && nested !== '[REDACTED]' && nested !== null)
    || containsUnredactedForbiddenEvidence(nested)
  ));
}

export function evidenceFileForPhase(phase) {
  return EVIDENCE_PHASE_FILES[requirePhase(phase)];
}

function confirmation(envName, value) {
  return Object.freeze({ envName, value });
}

function normalizeFlagWindow(text) {
  let normalized = requireText(text, 'configText');
  for (const flag of TRUE_DURING_DRY_RUN) {
    normalized = normalized.replace(
      new RegExp(`("${escapeRegExp(flag)}"\\s*:\\s*)(?:"(?:true|false)"|true|false)`, 'gu'),
      '$1"__YOUTUBE_DRY_RUN_WINDOW__"',
    );
  }
  return normalized;
}

function requireConfigString(text, name, expected) {
  const observed = readConfigString(text, name);
  if (observed !== expected) throw unsafeConfig(`${name} must equal ${expected}`, name);
  return observed;
}

function requireConfigStringValue(text, name, expected) {
  const matches = [...text.matchAll(new RegExp(
    `"${escapeRegExp(name)}"\\s*:\\s*"([^"]+)"`,
    'gu',
  ))].map((match) => match[1]);
  if (!matches.includes(expected)) {
    throw unsafeConfig(`${name} must include ${expected}`, name);
  }
  return expected;
}

function requireConfigNumberOccurrences(text, name, expected, count) {
  const pattern = new RegExp(
    `"${escapeRegExp(name)}"\\s*:\\s*${expected}(?:\\s*[,}\\]])`,
    'gu',
  );
  if ([...text.matchAll(pattern)].length !== count) {
    throw unsafeConfig(`${name}=${expected} must occur ${count} time(s)`, name);
  }
}

function requireConfigBoolean(text, name, expected) {
  const pattern = new RegExp(
    `"${escapeRegExp(name)}"\\s*:\\s*(?:"(true|false)"|(true|false))`,
    'u',
  );
  const match = text.match(pattern);
  const observed = match?.[1] ?? match?.[2];
  if (observed !== String(expected)) {
    throw unsafeConfig(`${name} must equal ${expected}`, name);
  }
}

function readConfigString(text, name) {
  const match = text.match(new RegExp(
    `"${escapeRegExp(name)}"\\s*:\\s*"([^"]+)"`,
    'u',
  ));
  return match?.[1] ?? null;
}

function readConfigArrayStrings(text, name, options = {}) {
  const match = text.match(new RegExp(
    `"${escapeRegExp(name)}"\\s*:\\s*\\[([\\s\\S]*?)\\]`,
    'u',
  ));
  if (!match) {
    if (options.optional) return Object.freeze([]);
    throw unsafeConfig(`Missing ${name}`, name);
  }
  return Object.freeze([...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]));
}

function readOptionalConfigBoolean(text, name) {
  const match = text.match(new RegExp(
    `"${escapeRegExp(name)}"\\s*:\\s*(?:"(true|false)"|(true|false))`,
    'u',
  ));
  if (!match) return null;
  return (match[1] ?? match[2]) === 'true';
}

function isRealMapping(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && !/^(?:replace-with-|placeholder|example|changeme|todo|none|null)/iu.test(value.trim());
}

function unsafeConfig(message, fieldName) {
  return operatorError(message, 'YOUTUBE_DRY_RUN_CONFIG_UNSAFE', { fieldName });
}

function fingerprintTarget(target) {
  return sha256(stableJson({
    contractVersion: YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
    repositoryHead: target.repositoryHead,
    workerName: target.workerName,
    databaseName: target.databaseName,
    mainQueueName: target.mainQueueName,
    dlqName: target.dlqName,
    channelIdHash: sha256(target.channelId),
    connectorAccountKey: target.connectorAccountKey,
    operationId: target.operationId,
    generation: target.generation,
  }));
}

function bangkokDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function sqlText(value) {
  return requireText(value, 'sqlValue').replaceAll("'", "''");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function requirePhase(value) {
  const phase = requireText(value, 'phase');
  if (!YOUTUBE_DRY_RUN_OPERATOR_PHASES.includes(phase)) {
    throw operatorError('Unknown YouTube dry-run operator phase', 'YOUTUBE_DRY_RUN_OPERATOR_PHASE_INVALID');
  }
  return phase;
}

function requireSafeOperationId(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SAFE_OPERATION_ID.test(text)) {
    throw operatorError(
      `${fieldName} must be a safe identifier`,
      'YOUTUBE_DRY_RUN_OPERATION_ID_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireFullGitSha(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!FULL_GIT_SHA.test(text)) {
    throw operatorError(
      `${fieldName} must be a full Git SHA`,
      'YOUTUBE_DRY_RUN_GIT_SHA_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!VERSION_ID.test(text)) {
    throw operatorError(
      `${fieldName} must be a Worker Version ID`,
      'YOUTUBE_DRY_RUN_VERSION_ID_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError(
      `${fieldName} must be a SHA-256 fingerprint`,
      'YOUTUBE_DRY_RUN_FINGERPRINT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < Date.UTC(2000, 0, 1)) {
    throw operatorError(
      `${fieldName} must be a valid timestamp`,
      'YOUTUBE_DRY_RUN_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return timestamp;
}

function requireIsoTimestamp(value, fieldName) {
  const timestamp = requireTimestamp(value, fieldName);
  return new Date(timestamp).toISOString();
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'YOUTUBE_DRY_RUN_TARGET_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'YOUTUBE_DRY_RUN_VALUE_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function optionalStableCode(value) {
  const code = optionalText(value)?.toUpperCase() ?? '';
  return /^[A-Z][A-Z0-9_]{0,159}$/u.test(code) ? code : null;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError(
      `${fieldName} must be a non-negative integer`,
      'YOUTUBE_DRY_RUN_COUNT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function isForbiddenEvidenceKey(key) {
  return /(?:secret|token|authorization|cookie|raw(?:Body|Response|Payload)|credential)/iu.test(key);
}

function looksLikeSecret(value) {
  return /^Bearer\s+/iu.test(value)
    || /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----)/u.test(value);
}

function evidenceError(fieldName) {
  return operatorError(
    `YouTube dry-run evidence mismatch: ${fieldName}`,
    'YOUTUBE_DRY_RUN_EVIDENCE_CHAIN_MISMATCH',
    { fieldName },
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
