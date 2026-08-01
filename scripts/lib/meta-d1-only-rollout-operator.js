import { createHash } from 'node:crypto';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_D1_ONLY_OPERATOR_CONTRACT_VERSION = 'meta-d1-only-rollout-v1';
export const META_D1_ONLY_OPERATOR_PHASES = Object.freeze([
  'plan', 'preflight', 'backup', 'deploy-safe-baseline', 'verify-safe-baseline',
  'deploy-d1-only-gates', 'verify-d1-only-deployment', 'snapshot-before',
  'send-one-d1-only', 'verify-d1-only', 'resend-same-operation',
  'verify-idempotent-rerun', 'restore-all-false', 'verify-restore', 'summary',
]);
export const META_D1_ONLY_CONFIRMATIONS = deepFreeze({
  preflight: confirmation('CONFIRM_META_D1_ONLY_PREFLIGHT', 'PREFLIGHT_META_D1_ONLY_ROLLOUT'),
  backup: confirmation('CONFIRM_META_D1_ONLY_BACKUP', 'BACKUP_META_D1_ONLY_STATE'),
  'deploy-safe-baseline': confirmation('CONFIRM_META_D1_ONLY_DEPLOY_SAFE', 'DEPLOY_META_D1_ONLY_SAFE_BASELINE'),
  'verify-safe-baseline': confirmation('CONFIRM_META_D1_ONLY_VERIFY_SAFE', 'VERIFY_META_D1_ONLY_SAFE_BASELINE'),
  'deploy-d1-only-gates': confirmation('CONFIRM_META_D1_ONLY_DEPLOY_ACTIVE', 'DEPLOY_META_D1_ONLY_GATES'),
  'verify-d1-only-deployment': confirmation('CONFIRM_META_D1_ONLY_VERIFY_ACTIVE', 'VERIFY_META_D1_ONLY_DEPLOYMENT'),
  'snapshot-before': confirmation('CONFIRM_META_D1_ONLY_SNAPSHOT', 'SNAPSHOT_META_D1_ONLY_BASELINE'),
  'send-one-d1-only': confirmation('CONFIRM_META_D1_ONLY_SEND', 'SEND_ONE_META_D1_ONLY_OPERATION'),
  'verify-d1-only': confirmation('CONFIRM_META_D1_ONLY_VERIFY', 'VERIFY_META_D1_ONLY_OPERATION'),
  'resend-same-operation': confirmation('CONFIRM_META_D1_ONLY_RESEND', 'RESEND_SAME_META_D1_ONLY_OPERATION'),
  'verify-idempotent-rerun': confirmation('CONFIRM_META_D1_ONLY_VERIFY_RERUN', 'VERIFY_META_D1_ONLY_IDEMPOTENT_RERUN'),
  'restore-all-false': confirmation('CONFIRM_META_D1_ONLY_RESTORE', 'RESTORE_META_D1_ONLY_ALL_FALSE'),
  'verify-restore': confirmation('CONFIRM_META_D1_ONLY_VERIFY_RESTORE', 'VERIFY_META_D1_ONLY_RESTORE'),
  summary: confirmation('CONFIRM_META_D1_ONLY_SUMMARY', 'SUMMARIZE_META_D1_ONLY_ROLLOUT'),
});
export const META_D1_ONLY_TARGETS = deepFreeze({
  facebook: { connectorKey: 'facebook', connectorFlag: 'MKT_CONNECTOR_FACEBOOK_ENABLED', jobType: JOB_TYPES.FACEBOOK_ORGANIC_SYNC, sourceAccountKey: null, requiredSecretName: 'META_FACEBOOK_PAGE_ACCESS_TOKEN', platform: 'facebook' },
  instagram: { connectorKey: 'instagram', connectorFlag: 'MKT_CONNECTOR_INSTAGRAM_ENABLED', jobType: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC, sourceAccountKey: null, requiredSecretName: 'META_INSTAGRAM_ACCESS_TOKEN', platform: 'instagram' },
  chemistry_k2: { connectorKey: 'meta_ads', connectorFlag: 'MKT_CONNECTOR_META_ADS_ENABLED', jobType: JOB_TYPES.META_ADS_SYNC, sourceAccountKey: 'chemistry_k2', requiredSecretName: 'META_ACCESS_TOKEN', platform: 'meta_ads' },
  chemistry_k3: { connectorKey: 'meta_ads', connectorFlag: 'MKT_CONNECTOR_META_ADS_ENABLED', jobType: JOB_TYPES.META_ADS_SYNC, sourceAccountKey: 'chemistry_k3', requiredSecretName: 'META_ACCESS_TOKEN', platform: 'meta_ads' },
});
export const META_D1_ONLY_REQUIRED_TABLES = Object.freeze([
  'ads_daily_facts', 'ads_entity_state', 'data_coverage_entities', 'data_coverage_runs',
  'organic_account_daily_facts', 'organic_content_observations', 'organic_content_state',
  'queue_operation_attempts', 'sync_generation_fences', 'sync_locks', 'sync_runs',
  'sync_work_phases', 'sync_work_runs', 'sync_work_units',
]);
export const META_D1_ONLY_REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED', 'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_CONNECTOR_INSTAGRAM_ENABLED', 'MKT_CONNECTOR_META_ADS_ENABLED',
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED', 'MKT_CONNECTOR_YOUTUBE_ENABLED',
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED', 'MKT_CONNECTOR_CHATWOOT_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED', 'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED', 'MKT_META_REPORT_READ_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED', 'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED', 'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_YOUTUBE_END_TO_END_ENABLED', 'MKT_YOUTUBE_LARK_WRITE_ENABLED',
  'MKT_YOUTUBE_ANALYTICS_ENABLED', 'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED', 'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
  'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED', 'MKT_CHATWOOT_D1_WRITE_ENABLED',
  'MKT_CHATWOOT_LARK_WRITE_ENABLED', 'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
  'MKT_CHATWOOT_WEBHOOK_ENABLED', 'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED', 'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED', 'MKT_NOTIFICATION_RUNTIME_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED', 'MKT_TIKTOK_AUDIT_HTTP_ENABLED',
  'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED', 'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED', 'MKT_SCHEDULE_YOUTUBE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED', 'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  'MKT_SCHEDULE_CHATWOOT_ENABLED', 'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
]);

const FULL_SHA = /^[0-9a-f]{40}$/u;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/u;
const SAFE_TARGET_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const EXECUTABLE_PHASES = new Set(META_D1_ONLY_OPERATOR_PHASES.filter((phase) => phase !== 'plan'));
const EVIDENCE_FILES = deepFreeze(Object.fromEntries(META_D1_ONLY_OPERATOR_PHASES.map((phase) => [phase, `${phase}.json`])));
const CONTINUATION_PHASES = new Set([
  'verify-idempotent-rerun',
  'restore-all-false',
  'verify-restore',
  'summary',
]);
const CONTINUATION_ALLOWED_PATHS = new Set([
  'CHANGELOG.md',
  'PROJECT_BRAIN.md',
  'docs/current-task.md',
  'docs/project-brain/meta-facebook-page-token-runtime-hotfix-2026-07-28.md',
  'scripts/lib/meta-d1-only-rollout-operator.js',
  'scripts/lib/meta-lark-parity-rollout-operator.js',
  'scripts/meta-d1-only-rollout-operator.mjs',
  'scripts/meta-lark-parity-rollout-operator.mjs',
  'tests/application/meta-d1-only-rollout-operator.test.js',
  'tests/application/meta-lark-parity-rollout-operator.test.js',
]);
const RESTORE_REUSE_PHASES = Object.freeze([
  'plan',
  'preflight',
  'backup',
  'deploy-safe-baseline',
  'verify-safe-baseline',
  'deploy-d1-only-gates',
  'verify-d1-only-deployment',
  'snapshot-before',
  'send-one-d1-only',
  'verify-d1-only',
  'resend-same-operation',
  'restore-all-false',
  'verify-restore',
]);
const D1_PHASE = 'meta_end_to_end_d1_write_v1';
const LARK_PHASE = 'meta_end_to_end_lark_write_v1';
const COMPLETION_PHASE = 'meta_end_to_end_completion_v1';

export function parseMetaD1OnlyOperatorArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') { execute = true; continue; }
    if (arg.startsWith('--phase=')) { phase = arg.slice('--phase='.length); continue; }
    throw operatorError(`Unknown Meta D1-only rollout argument: ${arg}`, 'META_D1_ONLY_OPERATOR_ARGUMENT_INVALID');
  }
  if (!META_D1_ONLY_OPERATOR_PHASES.includes(phase)) throw operatorError(`Unsupported Meta D1-only rollout phase: ${phase}`, 'META_D1_ONLY_OPERATOR_PHASE_INVALID', { phase });
  if (phase === 'plan' && execute) throw operatorError('Plan phase does not accept --execute', 'META_D1_ONLY_OPERATOR_PLAN_EXECUTE_INVALID');
  return Object.freeze({ phase, execute });
}

export function assertMetaD1OnlyConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const expected = META_D1_ONLY_CONFIRMATIONS[phase];
  if (env?.[expected.envName] !== expected.value) throw operatorError(`Meta D1-only rollout requires ${expected.envName}=${expected.value}`, 'META_D1_ONLY_OPERATOR_CONFIRMATION_REQUIRED', { phase, envName: expected.envName });
  return true;
}

export function validateMetaD1OnlyContinuationRepositoryState(input = {}, env = {}) {
  const phase = requirePhase(input.phase);
  const targetRepositoryHead = requireFullSha(
    input.targetRepositoryHead,
    'targetRepositoryHead',
  );
  const operatorRepositoryHead = requireFullSha(
    input.operatorRepositoryHead,
    'operatorRepositoryHead',
  );
  if (input.clean !== true) {
    throw operatorError(
      'Meta D1-only continuation requires a clean Working Tree',
      'META_D1_ONLY_CONTINUATION_REPOSITORY_INVALID',
    );
  }
  if (targetRepositoryHead === operatorRepositoryHead) {
    return deepFreeze({
      continuedAcrossRepositoryHead: false,
      targetRepositoryHead,
      operatorRepositoryHead,
      changedPathCount: 0,
    });
  }
  const continuedFrom = requireFullSha(
    env.MKT_META_D1_ONLY_CONTINUATION_FROM_HEAD,
    'MKT_META_D1_ONLY_CONTINUATION_FROM_HEAD',
  );
  const expectedOperator = requireFullSha(
    env.MKT_META_D1_ONLY_CONTINUATION_OPERATOR_HEAD,
    'MKT_META_D1_ONLY_CONTINUATION_OPERATOR_HEAD',
  );
  const changedPaths = Array.isArray(input.changedPaths)
    ? input.changedPaths.map((path) => requireText(path, 'changedPath'))
    : [];
  const unsafePaths = changedPaths.filter((path) => !CONTINUATION_ALLOWED_PATHS.has(path));
  if (!CONTINUATION_PHASES.has(phase)
    || continuedFrom !== targetRepositoryHead
    || expectedOperator !== operatorRepositoryHead
    || input.targetIsAncestor !== true
    || changedPaths.length === 0
    || unsafePaths.length > 0) {
    throw operatorError(
      'Meta D1-only continuation repository boundary is not approved',
      'META_D1_ONLY_CONTINUATION_REPOSITORY_INVALID',
      { phase, unsafePaths },
    );
  }
  return deepFreeze({
    continuedAcrossRepositoryHead: true,
    targetRepositoryHead,
    operatorRepositoryHead,
    changedPathCount: changedPaths.length,
    changedPathFingerprint: sha256(stableJson([...changedPaths].sort())),
  });
}

export function validateMetaD1OnlyReusableRestoreSequence(evidence = [], target = {}) {
  const validated = validateMetaD1OnlyEvidenceSequence(evidence, target);
  const phases = validated.map((item) => item.phase);
  if (JSON.stringify(phases) !== JSON.stringify(RESTORE_REUSE_PHASES)) {
    throw operatorError(
      'Meta D1-only reusable restore evidence sequence is incomplete',
      'META_D1_ONLY_REUSABLE_RESTORE_INVALID',
    );
  }
  const restore = validated.at(-2);
  const verification = validated.at(-1);
  const deploymentVersionId = requireVersionId(
    restore?.data?.deploymentVersionId,
    'restore.data.deploymentVersionId',
  );
  if (restore?.data?.mode !== 'safe'
    || verification?.data?.mode !== 'safe'
    || verification?.data?.activeVersion !== deploymentVersionId
    || !Array.isArray(verification?.data?.expectedTrueFlags)
    || verification.data.expectedTrueFlags.length !== 0) {
    throw operatorError(
      'Meta D1-only reusable restore does not prove an active all-false deployment',
      'META_D1_ONLY_REUSABLE_RESTORE_INVALID',
    );
  }
  return deepFreeze({
    deploymentVersionId,
    restoreEvidenceSha256: restore.evidenceSha256,
    verificationEvidenceSha256: verification.evidenceSha256,
  });
}

export function loadMetaD1OnlyTarget(env = {}) {
  const targetKey = requireTargetKey(env.MKT_META_D1_ONLY_TARGET);
  const definition = META_D1_ONLY_TARGETS[targetKey];
  const repositoryHead = requireFullSha(env.MKT_META_D1_ONLY_REPOSITORY_HEAD, 'MKT_META_D1_ONLY_REPOSITORY_HEAD');
  const operationId = requireOperationId(env.MKT_META_D1_ONLY_OPERATION_ID, 'MKT_META_D1_ONLY_OPERATION_ID');
  const originalRequestedAt = requireTimestamp(env.MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT, 'MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT');
  const periodStart = requireDate(env.MKT_META_D1_ONLY_PERIOD_START, 'MKT_META_D1_ONLY_PERIOD_START');
  const periodEnd = requireDate(env.MKT_META_D1_ONLY_PERIOD_END, 'MKT_META_D1_ONLY_PERIOD_END');
  if (periodStart > periodEnd) throw operatorError('Meta D1-only periodStart must not be after periodEnd', 'META_D1_ONLY_PERIOD_INVALID');
  const workKey = definition.sourceAccountKey ? `meta_ads:${definition.sourceAccountKey}:${operationId}` : `${definition.connectorKey}:${operationId}`;
  const operationScope = definition.sourceAccountKey ?? definition.connectorKey;
  const syncRunId = `meta:${definition.connectorKey}:${operationScope}:${operationId}`;
  const base = {
    contractVersion: META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
    environment: requireExact(env.MKT_ENV, 'development', 'MKT_ENV'),
    customerProfile: requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE'),
    customerKey: requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY'),
    accountKey: requireExact(env.MKT_META_D1_ONLY_ACCOUNT_KEY, 'chemistry_k', 'MKT_META_D1_ONLY_ACCOUNT_KEY'),
    workerName: requireExact(env.MKT_META_D1_ONLY_WORKER_NAME, 'social-mkt-sync-worker', 'MKT_META_D1_ONLY_WORKER_NAME'),
    databaseName: requireExact(env.MKT_META_D1_ONLY_DATABASE_NAME, 'social-mkt-state-dev', 'MKT_META_D1_ONLY_DATABASE_NAME'),
    mainQueueName: requireExact(env.MKT_META_D1_ONLY_MAIN_QUEUE, 'social-mkt-sync-jobs', 'MKT_META_D1_ONLY_MAIN_QUEUE'),
    dlqName: requireExact(env.MKT_META_D1_ONLY_DLQ, 'social-mkt-sync-dlq', 'MKT_META_D1_ONLY_DLQ'),
    targetKey,
    connectorKey: definition.connectorKey,
    connectorFlag: definition.connectorFlag,
    sourceAccountKey: definition.sourceAccountKey,
    requiredSecretName: definition.requiredSecretName,
    platform: definition.platform,
    jobType: definition.jobType,
    repositoryHead,
    expectedActiveVersion: requireVersionId(env.MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION, 'MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION'),
    wranglerConfigPath: requireText(env.MKT_META_D1_ONLY_WRANGLER_CONFIG, 'MKT_META_D1_ONLY_WRANGLER_CONFIG'),
    readOnlySummaryPath: requireText(env.MKT_META_D1_ONLY_READ_ONLY_SUMMARY, 'MKT_META_D1_ONLY_READ_ONLY_SUMMARY'),
    operationId,
    originalRequestedAt,
    generation: originalRequestedAt,
    periodStart,
    periodEnd,
    workKey,
    syncRunId,
    accountId: optionalText(env.CLOUDFLARE_ACCOUNT_ID),
    queueId: optionalText(env.MKT_META_D1_ONLY_QUEUE_ID),
    terminalRecovery: env.MKT_META_D1_ONLY_TERMINAL_RECOVERY
      === 'RECOVER_EXACT_FAILED_META_OPERATION',
  };
  return deepFreeze({ ...base, targetFingerprint: sha256(stableJson(safeTarget(base))) });
}

export function validateMetaReadOnlySummary(value = {}, target = {}) {
  if (value?.phase !== 'summary' || value?.status !== 'passed' || value?.contractVersion !== 'meta_read_only_validation_v1' || value?.details?.accepted !== true || Number(value?.details?.validationCount) !== 4 || value?.mutationPerformed !== false || Number(value?.businessWrites) !== 0 || Number(value?.queueMessages) !== 0) {
    throw operatorError('Meta read-only summary is missing or not accepted', 'META_D1_ONLY_READ_ONLY_SUMMARY_INVALID');
  }
  const safe = value?.target ?? {};
  if (safe.environment !== target.environment || safe.customerProfile !== target.customerProfile || safe.customerKey !== target.customerKey || safe.executionFlagsEnabled !== false || safe.schedulesEnabled !== false) {
    throw operatorError('Meta read-only summary target does not match the D1-only target', 'META_D1_ONLY_READ_ONLY_TARGET_MISMATCH');
  }
  const validations = Array.isArray(value?.details?.validations) ? value.details.validations : [];
  const expected = new Map([
    ['facebook', ['facebook', null]], ['instagram', ['instagram', null]],
    ['meta-ads-chemistry-k2', ['meta_ads', 'chemistry_k2']],
    ['meta-ads-chemistry-k3', ['meta_ads', 'chemistry_k3']],
  ]);
  for (const [phase, [connectorKey, sourceAccountKey]] of expected) {
    const entry = validations.find((item) => item?.phase === phase);
    if (entry?.connectorKey !== connectorKey || (entry?.sourceAccountKey ?? null) !== sourceAccountKey || entry?.status !== 'identity_validated' || !Number.isSafeInteger(Number(entry?.requestAttempts)) || Number(entry.requestAttempts) < 1) {
      throw operatorError(`Meta read-only summary is incomplete for ${phase}`, 'META_D1_ONLY_READ_ONLY_SUMMARY_INVALID', { phase });
    }
  }
  return deepFreeze({ targetFingerprint: requireFingerprint(value.targetFingerprint, 'targetFingerprint'), summarySha256: sha256(stableJson(value)), validationCount: 4, nextGate: value?.details?.nextGate ?? null });
}

export function buildMetaD1OnlyConfigWindow(safeText, target = {}) {
  const safe = requireText(safeText, 'safeConfigText');
  requireConfigString(safe, 'name', target.workerName);
  requireConfigString(safe, 'MKT_ENV', target.environment);
  requireConfigString(safe, 'MKT_CUSTOMER_PROFILE', target.customerProfile);
  requireConfigString(safe, 'MKT_CONNECTION_CUSTOMER_KEY', target.customerKey);
  requireConfigStringValue(safe, 'binding', 'MKT_STATE_DB');
  requireConfigStringValue(safe, 'database_name', target.databaseName);
  requireConfigStringValue(safe, 'binding', 'MKT_SYNC_QUEUE');
  requireConfigStringValue(safe, 'queue', target.mainQueueName);
  requireConfigStringValue(safe, 'queue', target.dlqName);
  requireConfigStringValue(safe, 'dead_letter_queue', target.dlqName);
  assertMetaSourceMappingConfig(safe, target);
  const safeTrueFlags = extractTrueEnabledFlags(safe);
  if (safeTrueFlags.length !== 0) throw operatorError('Safe Meta D1-only config must have every MKT execution flag false', 'META_D1_ONLY_SAFE_CONFIG_NOT_CLOSED', { trueFlags: safeTrueFlags });
  for (const flag of META_D1_ONLY_REQUIRED_FALSE_FLAGS) requireConfigBoolean(safe, flag, false);
  const activeFlags = Object.freeze([target.connectorFlag, 'MKT_META_SOURCE_READ_ENABLED', 'MKT_META_D1_WRITE_ENABLED'].sort());
  let active = safe;
  for (const flag of activeFlags) active = replaceConfigBoolean(active, flag, true);
  const observedActive = extractTrueEnabledFlags(active);
  if (JSON.stringify(observedActive) !== JSON.stringify(activeFlags)) throw operatorError('Meta D1-only active config contains an unapproved true flag', 'META_D1_ONLY_ACTIVE_CONFIG_UNAPPROVED_FLAG', { trueFlags: observedActive });
  requireConfigBoolean(active, 'MKT_META_LARK_WRITE_ENABLED', false);
  requireConfigBoolean(active, 'MKT_META_REPORT_READ_ENABLED', false);
  for (const flag of META_D1_ONLY_REQUIRED_FALSE_FLAGS) if (!activeFlags.includes(flag)) requireConfigBoolean(active, flag, false);
  if (normalizeApprovedFlagWindow(safe, activeFlags) !== normalizeApprovedFlagWindow(active, activeFlags)) throw operatorError('Meta D1-only config changes fields outside the approved flag window', 'META_D1_ONLY_CONFIG_UNAPPROVED_DIFF');
  return deepFreeze({
    safeText: safe,
    activeText: active,
    safeSha256: sha256(safe),
    activeSha256: sha256(active),
    safeTrueFlags,
    activeTrueFlags: activeFlags,
    bindingFingerprint: sha256(stableJson({ workerName: target.workerName, databaseName: target.databaseName, mainQueueName: target.mainQueueName, dlqName: target.dlqName })),
  });
}

export function buildMetaD1OnlyJob(target = {}) {
  return createStableQueueOperationBody({
    schemaVersion: 1,
    type: target.jobType,
    trigger: 'manual_uat',
    dryRun: false,
    d1Only: true,
    periodStart: target.periodStart,
    periodEnd: target.periodEnd,
    ...(target.sourceAccountKey ? { sourceAccountKey: target.sourceAccountKey } : {}),
  }, { operationId: target.operationId, originalRequestedAt: target.originalRequestedAt });
}

export function buildMetaD1OnlySchemaSql() {
  const tableList = META_D1_ONLY_REQUIRED_TABLES.map(sqlText).join(', ');
  return compactSql(`SELECT COUNT(*) AS required_table_count, GROUP_CONCAT(name, ',') AS required_table_names FROM sqlite_master WHERE type = 'table' AND name IN (${tableList});`);
}

export function buildMetaD1OnlySnapshotSql(target = {}) {
  const workKey = sqlText(requireText(target.workKey, 'workKey'));
  const syncRunId = sqlText(requireText(target.syncRunId, 'syncRunId'));
  const operationId = sqlText(requireText(target.operationId, 'operationId'));
  const platform = sqlText(requireText(target.platform, 'platform'));
  const accountKey = sqlText(requireText(target.accountKey, 'accountKey'));
  const customerKey = sqlText(requireText(target.customerKey, 'customerKey'));
  return compactSql(`
    SELECT
      (SELECT status FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_status,
      (SELECT finished_at FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_finished_at,
      (SELECT error_code FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_error_code,
      (SELECT status FROM sync_work_runs WHERE work_key = ${workKey}) AS work_status,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key = ${workKey}) AS work_lifecycle_status,
      (SELECT completed_at FROM sync_work_runs WHERE work_key = ${workKey}) AS work_completed_at,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${D1_PHASE}') AS d1_phase_complete,
      (SELECT state_json FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${D1_PHASE}') AS d1_state_json,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${LARK_PHASE}') AS lark_phase_count,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${COMPLETION_PHASE}') AS completion_phase_count,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = ${syncRunId} AND expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_operation_attempts,
      (SELECT COALESCE(MAX(main_queue_attempts), 0) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS main_queue_attempts,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${syncRunId}) AS coverage_run_count,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${syncRunId} AND (failed_rows <> 0 OR status NOT IN ('complete', 'no_data_confirmed', 'revisable'))) AS invalid_coverage_count,
      (SELECT COUNT(*) FROM data_coverage_entities WHERE coverage_run_id IN (SELECT coverage_run_id FROM data_coverage_runs WHERE sync_run_id = ${syncRunId})) AS coverage_entity_count,
      (SELECT COUNT(*) FROM organic_content_state WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_organic_state_count,
      (SELECT COUNT(*) FROM organic_content_observations WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_organic_observation_count,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_account_daily_count,
      (SELECT COUNT(*) FROM ads_entity_state WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_ads_entity_count,
      (SELECT COUNT(*) FROM ads_daily_facts WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_ads_daily_count,
      (SELECT COUNT(*) FROM organic_content_state WHERE last_sync_run_id = ${syncRunId}) AS operation_organic_state_count,
      (SELECT COUNT(*) FROM organic_content_observations WHERE sync_run_id = ${syncRunId}) AS operation_organic_observation_count,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE sync_run_id = ${syncRunId}) AS operation_account_daily_count,
      (SELECT COUNT(*) FROM ads_entity_state WHERE last_sync_run_id = ${syncRunId}) AS operation_ads_entity_count,
      (SELECT COUNT(*) FROM ads_daily_facts WHERE sync_run_id = ${syncRunId}) AS operation_ads_daily_count;
  `);
}

export function normalizeMetaD1OnlySnapshot(value = {}) {
  if (isNormalizedSnapshot(value)) {
    return deepFreeze({ ...value, targetCounts: deepFreeze({ ...value.targetCounts }), operationCounts: deepFreeze({ ...value.operationCounts }) });
  }
  const d1State = parseNullableJson(value.d1_state_json, 'd1_state_json');
  return deepFreeze({
    syncRunStatus: optionalText(value.sync_run_status),
    syncRunFinishedAt: nullableNumber(value.sync_run_finished_at),
    syncRunErrorCode: optionalText(value.sync_run_error_code),
    workStatus: optionalText(value.work_status),
    workLifecycleStatus: optionalText(value.work_lifecycle_status),
    workCompletedAt: nullableNumber(value.work_completed_at),
    d1PhaseComplete: Number(value.d1_phase_complete ?? 0) === 1,
    d1State,
    larkPhaseCount: count(value.lark_phase_count),
    completionPhaseCount: count(value.completion_phase_count),
    activeLockCount: count(value.active_lock_count),
    queueOperationAttempts: count(value.queue_operation_attempts),
    mainQueueAttempts: count(value.main_queue_attempts),
    coverageRunCount: count(value.coverage_run_count),
    invalidCoverageCount: count(value.invalid_coverage_count),
    coverageEntityCount: count(value.coverage_entity_count),
    targetCounts: deepFreeze({
      organicState: count(value.target_organic_state_count),
      organicObservations: count(value.target_organic_observation_count),
      accountDaily: count(value.target_account_daily_count),
      adsEntities: count(value.target_ads_entity_count),
      adsDaily: count(value.target_ads_daily_count),
    }),
    operationCounts: deepFreeze({
      organicState: count(value.operation_organic_state_count),
      organicObservations: count(value.operation_organic_observation_count),
      accountDaily: count(value.operation_account_daily_count),
      adsEntities: count(value.operation_ads_entity_count),
      adsDaily: count(value.operation_ads_daily_count),
    }),
  });
}

export function classifyMetaD1OnlyCompletion(snapshot = {}) {
  const value = normalizeMetaD1OnlySnapshot(snapshot);
  const complete = value.syncRunStatus === 'success' && value.syncRunFinishedAt !== null && value.syncRunErrorCode === null && value.d1PhaseComplete === true && value.larkPhaseCount === 0 && value.completionPhaseCount === 0 && value.activeLockCount === 0 && value.coverageRunCount > 0 && value.invalidCoverageCount === 0 && value.workLifecycleStatus === 'active' && value.workCompletedAt === null;
  return deepFreeze({ complete, snapshot: value, reason: complete ? 'd1_complete_lark_gate_disabled' : 'incomplete_or_invalid' });
}

export function compareMetaD1OnlySnapshots(beforeInput, afterInput, options = {}) {
  const before = normalizeMetaD1OnlySnapshot(beforeInput);
  const after = normalizeMetaD1OnlySnapshot(afterInput);
  const rerun = options.rerun === true;
  if (after.larkPhaseCount !== 0 || after.completionPhaseCount !== 0) throw operatorError('Meta D1-only execution created a Lark or full-completion phase', 'META_D1_ONLY_LARK_BOUNDARY_VIOLATED');
  if (after.invalidCoverageCount !== 0) throw operatorError('Meta D1-only Coverage contains failed or unaccepted rows', 'META_D1_ONLY_COVERAGE_INVALID');
  if (!rerun) {
    if (!classifyMetaD1OnlyCompletion(after).complete) throw operatorError('Meta D1-only operation has not reached the accepted D1 boundary', 'META_D1_ONLY_COMPLETION_INVALID');
    if (options.terminalRecovery === true) {
      if (after.mainQueueAttempts < before.mainQueueAttempts + 1) throw operatorError('Meta D1-only recovery Queue attempt was not observed', 'META_D1_ONLY_RECOVERY_ATTEMPT_MISSING');
    } else if (after.queueOperationAttempts < before.queueOperationAttempts + 1) throw operatorError('Meta D1-only initial Queue attempt was not observed', 'META_D1_ONLY_QUEUE_ATTEMPT_MISSING');
    return deepFreeze({ accepted: true, rerun: false, before, after, targetCountDelta: subtractCounts(after.targetCounts, before.targetCounts), operationCounts: after.operationCounts, coverageRunCount: after.coverageRunCount, coverageEntityCount: after.coverageEntityCount });
  }
  if (after.mainQueueAttempts < before.mainQueueAttempts + 1) throw operatorError('Meta D1-only rerun Queue attempt was not observed', 'META_D1_ONLY_RERUN_ATTEMPT_MISSING');
  for (const key of Object.keys(before.targetCounts)) if (after.targetCounts[key] !== before.targetCounts[key]) throw operatorError('Meta D1-only rerun changed target Business counts', 'META_D1_ONLY_RERUN_COUNT_DRIFT', { field: key, before: before.targetCounts[key], after: after.targetCounts[key] });
  for (const key of Object.keys(before.operationCounts)) if (after.operationCounts[key] !== before.operationCounts[key]) throw operatorError('Meta D1-only rerun changed operation-scoped Business counts', 'META_D1_ONLY_RERUN_COUNT_DRIFT', { field: key, before: before.operationCounts[key], after: after.operationCounts[key] });
  if (after.coverageRunCount !== before.coverageRunCount || after.coverageEntityCount !== before.coverageEntityCount) throw operatorError('Meta D1-only rerun changed Coverage counts', 'META_D1_ONLY_RERUN_COVERAGE_DRIFT');
  return deepFreeze({ accepted: true, rerun: true, before, after, businessCountDrift: false, coverageCountDrift: false });
}

export function validateMetaD1OnlyTerminalRecoveryBaseline(snapshotInput = {}) {
  const snapshot = normalizeMetaD1OnlySnapshot(snapshotInput);
  const noOperationWrites = Object.values(snapshot.operationCounts).every((count) => count === 0);
  const acceptedPreWriteErrors = new Set([
    'META_PERMANENT_API_ERROR',
    'UNHANDLED_SYNC_ERROR',
  ]);
  const valid = snapshot.syncRunStatus === 'failed'
    && acceptedPreWriteErrors.has(snapshot.syncRunErrorCode)
    && snapshot.workStatus === 'active'
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.workCompletedAt === null
    && snapshot.d1PhaseComplete === false
    && snapshot.larkPhaseCount === 0
    && snapshot.completionPhaseCount === 0
    && snapshot.activeLockCount === 0
    && snapshot.queueOperationAttempts === 1
    && snapshot.mainQueueAttempts >= 3
    && snapshot.coverageRunCount === 0
    && snapshot.invalidCoverageCount === 0
    && noOperationWrites;
  if (!valid) {
    throw operatorError(
      'Meta D1-only terminal recovery baseline is not the exact failed pre-D1 boundary',
      'META_D1_ONLY_TERMINAL_RECOVERY_BASELINE_INVALID',
    );
  }
  return deepFreeze({ accepted: true, snapshot });
}

export function createMetaD1OnlyEvidence(input = {}) {
  const evidence = {
    phase: requirePhase(input.phase),
    status: 'passed',
    capturedAt: new Date(input.capturedAt ?? Date.now()).toISOString(),
    contractVersion: META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
    repositoryHead: requireFullSha(input.repositoryHead, 'repositoryHead'),
    targetFingerprint: requireFingerprint(input.targetFingerprint, 'targetFingerprint'),
    targetKey: requireTargetKey(input.targetKey),
    operationId: requireOperationId(input.operationId, 'operationId'),
    previousEvidenceSha256: input.previousEvidenceSha256 ? requireFingerprint(input.previousEvidenceSha256, 'previousEvidenceSha256') : null,
    data: sanitizeEvidenceValue(input.data ?? {}),
    remoteMutationPerformed: input.remoteMutationPerformed === true,
    providerRequestMode: optionalText(input.providerRequestMode),
    businessWritesAllowed: input.businessWritesAllowed === true,
    larkWritesAllowed: false,
    scheduleActivationAllowed: false,
    productionAllowed: false,
  };
  return deepFreeze({ ...evidence, evidenceSha256: sha256(stableJson(evidence)) });
}

export function validateMetaD1OnlyEvidenceSequence(evidence = [], target = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0) throw operatorError('Meta D1-only evidence chain is empty', 'META_D1_ONLY_EVIDENCE_MISSING');
  let previous = null;
  for (const item of evidence) {
    if (item?.contractVersion !== META_D1_ONLY_OPERATOR_CONTRACT_VERSION || item?.repositoryHead !== target.repositoryHead || item?.targetFingerprint !== target.targetFingerprint || item?.targetKey !== target.targetKey || item?.operationId !== target.operationId || item?.larkWritesAllowed !== false || item?.scheduleActivationAllowed !== false || item?.productionAllowed !== false) throw operatorError(`Meta D1-only evidence is invalid for phase ${item?.phase ?? 'unknown'}`, 'META_D1_ONLY_EVIDENCE_INVALID');
    const expectedHash = item.evidenceSha256;
    const unsigned = { ...item };
    delete unsigned.evidenceSha256;
    if (expectedHash !== sha256(stableJson(unsigned))) throw operatorError(`Meta D1-only evidence hash is invalid for phase ${item.phase}`, 'META_D1_ONLY_EVIDENCE_HASH_INVALID');
    if ((item.previousEvidenceSha256 ?? null) !== (previous?.evidenceSha256 ?? null)) throw operatorError(`Meta D1-only evidence chain is broken at phase ${item.phase}`, 'META_D1_ONLY_EVIDENCE_CHAIN_INVALID');
    previous = item;
  }
  return Object.freeze([...evidence]);
}

export function evidenceFileForMetaD1OnlyPhase(phase) { return EVIDENCE_FILES[requirePhase(phase)]; }
export function previousMetaD1OnlyPhase(phase) {
  const index = META_D1_ONLY_OPERATOR_PHASES.indexOf(requirePhase(phase));
  return index > 0 ? META_D1_ONLY_OPERATOR_PHASES[index - 1] : null;
}
export function safeMetaD1OnlyTarget(target = {}) { return deepFreeze(safeTarget(target)); }

function safeTarget(target) {
  return {
    contractVersion: target.contractVersion, environment: target.environment,
    customerProfile: target.customerProfile, customerKey: target.customerKey,
    accountKey: target.accountKey, workerName: target.workerName,
    databaseName: target.databaseName, mainQueueName: target.mainQueueName,
    dlqName: target.dlqName, targetKey: target.targetKey,
    connectorKey: target.connectorKey, sourceAccountKey: target.sourceAccountKey,
    platform: target.platform, jobType: target.jobType,
    repositoryHead: target.repositoryHead, expectedActiveVersion: target.expectedActiveVersion,
    operationId: target.operationId, originalRequestedAt: target.originalRequestedAt,
    generation: target.generation, periodStart: target.periodStart, periodEnd: target.periodEnd,
    workKey: target.workKey, syncRunId: target.syncRunId,
    terminalRecovery: target.terminalRecovery === true,
  };
}
function confirmation(envName, value) { return Object.freeze({ envName, value }); }
function requirePhase(value) {
  if (!META_D1_ONLY_OPERATOR_PHASES.includes(value)) throw operatorError('Meta D1-only phase is invalid', 'META_D1_ONLY_OPERATOR_PHASE_INVALID');
  return value;
}
function requireTargetKey(value) {
  const key = requireText(value, 'MKT_META_D1_ONLY_TARGET').toLowerCase();
  if (!SAFE_TARGET_KEY.test(key) || !META_D1_ONLY_TARGETS[key]) throw operatorError('Meta D1-only target must be facebook, instagram, chemistry_k2 or chemistry_k3', 'META_D1_ONLY_TARGET_INVALID');
  return key;
}
function requireOperationId(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SAFE_OPERATION_ID.test(text)) throw operatorError(`${fieldName} has an unsafe format`, 'META_D1_ONLY_OPERATION_ID_INVALID', { fieldName });
  return text;
}
function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!FULL_SHA.test(text)) throw operatorError(`${fieldName} must be a full Git SHA`, 'META_D1_ONLY_GIT_SHA_INVALID');
  return text;
}
function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!VERSION_ID.test(text)) throw operatorError(`${fieldName} must be a Worker version UUID`, 'META_D1_ONLY_VERSION_INVALID');
  return text;
}
function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{64}$/u.test(text)) throw operatorError(`${fieldName} must be a SHA-256 fingerprint`, 'META_D1_ONLY_FINGERPRINT_INVALID');
  return text;
}
function requireTimestamp(value, fieldName) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) throw operatorError(`${fieldName} must be a valid timestamp`, 'META_D1_ONLY_TIMESTAMP_INVALID');
  return number;
}
function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!DATE_ONLY.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw operatorError(`${fieldName} must be YYYY-MM-DD`, 'META_D1_ONLY_DATE_INVALID');
  return text;
}
function requireExact(value, expected, fieldName) {
  if (value !== expected) throw operatorError(`Meta D1-only rollout requires ${fieldName}=${expected}`, 'META_D1_ONLY_TARGET_INVALID', { fieldName });
  return value;
}
function requireConfigString(text, key, expected) {
  if (readConfigString(text, key) !== expected) throw operatorError(`Meta D1-only config requires ${key}=${expected}`, 'META_D1_ONLY_CONFIG_INVALID', { key });
}
function requireConfigStringValue(text, key, expected) {
  const values = [...text.matchAll(new RegExp(`["']?${escapeRegex(key)}["']?\\s*:\\s*["']([^"']+)["']`, 'gu'))].map((match) => match[1]);
  if (!values.includes(expected)) throw operatorError(`Meta D1-only config requires ${key}=${expected}`, 'META_D1_ONLY_CONFIG_INVALID', { key });
}
function assertMetaSourceMappingConfig(text, target) {
  const apiVersion = readConfigString(text, 'META_GRAPH_API_VERSION');
  if (!/^v\d+\.\d+$/u.test(apiVersion ?? '')) {
    throw operatorError(
      'Meta D1-only config requires a pinned Meta Graph API version',
      'META_D1_ONLY_SOURCE_MAPPING_INVALID',
      { key: 'META_GRAPH_API_VERSION' },
    );
  }
  if (target.connectorKey === 'facebook') {
    requireNonEmptyConfigString(text, 'META_FACEBOOK_PAGE_ID');
    return;
  }
  if (target.connectorKey === 'instagram') {
    requireNonEmptyConfigString(text, 'META_INSTAGRAM_ACCOUNT_ID');
    return;
  }
  const mappings = readConfigString(text, 'META_AD_ACCOUNT_MAPPINGS');
  const expectedKey = target.sourceAccountKey;
  const mappedKeys = String(mappings ?? '')
    .split(',')
    .map((entry) => entry.slice(0, entry.indexOf('=')).trim())
    .filter(Boolean);
  if (!expectedKey || !mappedKeys.includes(expectedKey)) {
    throw operatorError(
      'Meta D1-only config is missing the selected Meta Ads source mapping',
      'META_D1_ONLY_SOURCE_MAPPING_INVALID',
      { key: 'META_AD_ACCOUNT_MAPPINGS', sourceAccountKey: expectedKey ?? null },
    );
  }
}
function requireNonEmptyConfigString(text, key) {
  if (!readConfigString(text, key)) {
    throw operatorError(
      `Meta D1-only config requires ${key}`,
      'META_D1_ONLY_SOURCE_MAPPING_INVALID',
      { key },
    );
  }
}
function readConfigString(text, key) {
  const match = text.match(new RegExp(`["']?${escapeRegex(key)}["']?\\s*:\\s*["']([^"']*)["']`, 'u'));
  return match?.[1] ?? null;
}
function requireConfigBoolean(text, key, expected) {
  if (readConfigBoolean(text, key) !== expected) throw operatorError(`Meta D1-only config requires ${key}=${expected}`, 'META_D1_ONLY_CONFIG_INVALID', { key });
}
function readConfigBoolean(text, key) {
  const match = text.match(new RegExp(`(["']?${escapeRegex(key)}["']?\\s*:\\s*)(?:"(true|false)"|(true|false))`, 'u'));
  if (!match) return null;
  return (match[2] ?? match[3]) === 'true';
}
function replaceConfigBoolean(text, key, expected) {
  const regex = new RegExp(`(["']?${escapeRegex(key)}["']?\\s*:\\s*)(?:"(true|false)"|(true|false))`, 'u');
  if (!regex.test(text)) throw operatorError(`Meta D1-only config is missing ${key}`, 'META_D1_ONLY_CONFIG_INVALID', { key });
  return text.replace(regex, `$1"${expected ? 'true' : 'false'}"`);
}
function extractTrueEnabledFlags(text) {
  return [...text.matchAll(/["']?(MKT_[A-Z0-9_]+_ENABLED)["']?\s*:\s*(?:"true"|true)/gu)].map((match) => match[1]).sort();
}
function normalizeApprovedFlagWindow(text, flags) {
  let normalized = text;
  for (const flag of flags) normalized = replaceConfigBoolean(normalized, flag, false);
  return normalized;
}
function sanitizeEvidenceValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitizeEvidenceValue);
  if (typeof value !== 'object') return value;
  const forbidden = /token|authorization|secret|password|raw(?:Url|Origin|Config|Response)/iu;
  const result = {};
  for (const [key, nested] of Object.entries(value)) if (!forbidden.test(key)) result[key] = sanitizeEvidenceValue(nested);
  return result;
}
function isNormalizedSnapshot(value) {
  return Boolean(value && typeof value === 'object' && typeof value.d1PhaseComplete === 'boolean' && value.targetCounts && typeof value.targetCounts === 'object' && value.operationCounts && typeof value.operationCounts === 'object');
}
function subtractCounts(after, before) { return deepFreeze(Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]))); }
function parseNullableJson(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw operatorError(`${fieldName} is not valid JSON`, 'META_D1_ONLY_SNAPSHOT_INVALID', { fieldName });
  }
}
function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw operatorError('Meta D1-only snapshot count is invalid', 'META_D1_ONLY_SNAPSHOT_INVALID');
  return number;
}
function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function compactSql(sql) { return sql.replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw operatorError(`${fieldName} is required`, 'META_D1_ONLY_VALUE_REQUIRED', { fieldName });
  return value.trim();
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function operatorError(message, code, details = {}) { return permanentError(message, { code, details }); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
