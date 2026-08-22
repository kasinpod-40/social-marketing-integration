import { createHash } from 'node:crypto';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import {
  META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  META_END_TO_END_LARK_TABLES,
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
  buildMetaD1OnlyConfigWindow,
  loadMetaD1OnlyTarget,
  safeMetaD1OnlyTarget,
} from './meta-d1-only-rollout-operator.js';

export const META_LARK_OPERATOR_CONTRACT_VERSION = 'meta-lark-parity-rollout-v1';
export const META_LARK_OPERATOR_PHASES = Object.freeze([
  'plan',
  'lark-preflight',
  'd1-ready',
  'deploy-safe-baseline',
  'verify-safe-baseline',
  'deploy-lark-gates',
  'verify-lark-deployment',
  'snapshot-before',
  'send-lark-continuation',
  'verify-lark',
  'resend-same-operation',
  'verify-idempotent-rerun',
  'restore-all-false',
  'verify-restore',
  'verify-late-completion',
  'summary',
]);

export const META_LARK_CONFIRMATIONS = deepFreeze({
  'lark-preflight': confirmation('CONFIRM_META_LARK_PREFLIGHT', 'READ_ONLY_META_LARK_PREFLIGHT'),
  'd1-ready': confirmation('CONFIRM_META_LARK_D1_READY', 'VERIFY_META_D1_READY_FOR_LARK'),
  'deploy-safe-baseline': confirmation('CONFIRM_META_LARK_DEPLOY_SAFE', 'DEPLOY_META_LARK_SAFE_BASELINE'),
  'verify-safe-baseline': confirmation('CONFIRM_META_LARK_VERIFY_SAFE', 'VERIFY_META_LARK_SAFE_BASELINE'),
  'deploy-lark-gates': confirmation('CONFIRM_META_LARK_DEPLOY_ACTIVE', 'DEPLOY_META_LARK_GATES'),
  'verify-lark-deployment': confirmation('CONFIRM_META_LARK_VERIFY_ACTIVE', 'VERIFY_META_LARK_DEPLOYMENT'),
  'snapshot-before': confirmation('CONFIRM_META_LARK_SNAPSHOT', 'SNAPSHOT_META_LARK_BASELINE'),
  'send-lark-continuation': confirmation('CONFIRM_META_LARK_SEND', 'SEND_META_LARK_CONTINUATION'),
  'verify-lark': confirmation('CONFIRM_META_LARK_VERIFY', 'VERIFY_META_LARK_COMPLETION'),
  'resend-same-operation': confirmation('CONFIRM_META_LARK_RESEND', 'RESEND_SAME_META_LARK_OPERATION'),
  'verify-idempotent-rerun': confirmation('CONFIRM_META_LARK_VERIFY_RERUN', 'VERIFY_META_LARK_IDEMPOTENT_RERUN'),
  'restore-all-false': confirmation('CONFIRM_META_LARK_RESTORE', 'RESTORE_META_LARK_ALL_FALSE'),
  'verify-restore': confirmation('CONFIRM_META_LARK_VERIFY_RESTORE', 'VERIFY_META_LARK_RESTORE'),
  'verify-late-completion': confirmation(
    'CONFIRM_META_LARK_VERIFY_LATE_COMPLETION',
    'VERIFY_META_LARK_LATE_COMPLETION_AFTER_RESTORE',
  ),
  summary: confirmation('CONFIRM_META_LARK_SUMMARY', 'SUMMARIZE_META_LARK_ROLLOUT'),
});

const FULL_SHA = /^[0-9a-f]{40}$/u;
const EXECUTABLE_PHASES = new Set(META_LARK_OPERATOR_PHASES.slice(1));
const D1_PHASE = 'meta_end_to_end_d1_write_v1';
const PREFLIGHT_PHASE = 'meta_end_to_end_destination_preflight_v1';
const LARK_PHASE = 'meta_end_to_end_lark_write_v1';
const COMPLETION_PHASE = 'meta_end_to_end_completion_v1';

export function parseMetaLarkOperatorArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else if (arg.startsWith('--phase=')) phase = arg.slice('--phase='.length);
    else throw operatorError(`Unknown Meta Lark rollout argument: ${arg}`, 'META_LARK_OPERATOR_ARGUMENT_INVALID');
  }
  if (!META_LARK_OPERATOR_PHASES.includes(phase)) {
    throw operatorError(`Unsupported Meta Lark rollout phase: ${phase}`, 'META_LARK_OPERATOR_PHASE_INVALID', { phase });
  }
  if (phase === 'plan' && execute) {
    throw operatorError('Meta Lark plan does not accept --execute', 'META_LARK_OPERATOR_PLAN_EXECUTE_INVALID');
  }
  return Object.freeze({ phase, execute });
}

export function assertMetaLarkConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const expected = META_LARK_CONFIRMATIONS[phase];
  if (env?.[expected.envName] !== expected.value) {
    throw operatorError(
      `Meta Lark rollout requires ${expected.envName}=${expected.value}`,
      'META_LARK_OPERATOR_CONFIRMATION_REQUIRED',
      { phase, envName: expected.envName },
    );
  }
  return true;
}

export function loadMetaLarkTarget(env = {}) {
  const base = loadMetaD1OnlyTarget({
    ...env,
    MKT_META_D1_ONLY_TARGET: env.MKT_META_LARK_TARGET,
    MKT_META_D1_ONLY_REPOSITORY_HEAD: env.MKT_META_LARK_REPOSITORY_HEAD,
    MKT_META_D1_ONLY_OPERATION_ID: env.MKT_META_LARK_OPERATION_ID,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: env.MKT_META_LARK_ORIGINAL_REQUESTED_AT,
    MKT_META_D1_ONLY_PERIOD_START: env.MKT_META_LARK_PERIOD_START,
    MKT_META_D1_ONLY_PERIOD_END: env.MKT_META_LARK_PERIOD_END,
    MKT_META_D1_ONLY_ACCOUNT_KEY: env.MKT_META_LARK_ACCOUNT_KEY,
    MKT_META_D1_ONLY_WORKER_NAME: env.MKT_META_LARK_WORKER_NAME,
    MKT_META_D1_ONLY_DATABASE_NAME: env.MKT_META_LARK_DATABASE_NAME,
    MKT_META_D1_ONLY_MAIN_QUEUE: env.MKT_META_LARK_MAIN_QUEUE,
    MKT_META_D1_ONLY_DLQ: env.MKT_META_LARK_DLQ,
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: env.MKT_META_LARK_EXPECTED_ACTIVE_VERSION,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: env.MKT_META_LARK_WRANGLER_CONFIG,
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY: env.MKT_META_LARK_READ_ONLY_SUMMARY,
    MKT_META_D1_ONLY_QUEUE_ID: env.MKT_META_LARK_QUEUE_ID,
    MKT_META_D1_ONLY_TERMINAL_RECOVERY: env.MKT_META_LARK_TERMINAL_RECOVERY,
  });
  const target = {
    ...base,
    contractVersion: META_LARK_OPERATOR_CONTRACT_VERSION,
    d1SummaryPath: requireText(env.MKT_META_LARK_D1_SUMMARY, 'MKT_META_LARK_D1_SUMMARY'),
    expectedLarkTableCount: expectedLarkContracts(base.connectorKey).length,
    orphanedRunningRecovery: env.MKT_META_LARK_ORPHANED_RUNNING_RECOVERY === 'true',
  };
  return deepFreeze({
    ...target,
    targetFingerprint: sha256(stableJson({
      contractVersion: META_LARK_OPERATOR_CONTRACT_VERSION,
      target: safeMetaLarkTarget(target),
    })),
  });
}

export function safeMetaLarkTarget(target = {}) {
  return deepFreeze({
    ...safeMetaD1OnlyTarget(target),
    contractVersion: META_LARK_OPERATOR_CONTRACT_VERSION,
    d1SummaryPath: requireText(target.d1SummaryPath, 'd1SummaryPath'),
    expectedLarkTableCount: positiveInteger(target.expectedLarkTableCount, 'expectedLarkTableCount'),
    orphanedRunningRecovery: target.orphanedRunningRecovery === true,
  });
}

export function buildMetaLarkConfigWindow(safeText, target = {}) {
  const d1Window = buildMetaD1OnlyConfigWindow(safeText, target);
  const activeText = replaceJsoncBoolean(
    d1Window.activeText,
    'MKT_META_LARK_WRITE_ENABLED',
    true,
  );
  const activeTrueFlags = Object.freeze([
    ...d1Window.activeTrueFlags,
    'MKT_META_LARK_WRITE_ENABLED',
  ].sort());
  const observed = extractJsoncTrueFlags(activeText);
  if (JSON.stringify(observed) !== JSON.stringify(activeTrueFlags)) {
    throw operatorError(
      'Meta Lark active config contains an unapproved true flag',
      'META_LARK_ACTIVE_CONFIG_UNAPPROVED_FLAG',
      { trueFlags: observed },
    );
  }
  requireJsoncBoolean(activeText, 'MKT_META_REPORT_READ_ENABLED', false);
  return deepFreeze({
    safeText: d1Window.safeText,
    activeText,
    safeSha256: d1Window.safeSha256,
    activeSha256: sha256(activeText),
    safeTrueFlags: d1Window.safeTrueFlags,
    activeTrueFlags,
    bindingFingerprint: d1Window.bindingFingerprint,
  });
}

export function buildMetaLarkContinuationJob(target = {}) {
  return createStableQueueOperationBody({
    schemaVersion: 1,
    type: target.jobType,
    trigger: 'manual_uat',
    dryRun: false,
    periodStart: target.periodStart,
    periodEnd: target.periodEnd,
    ...(target.sourceAccountKey ? { sourceAccountKey: target.sourceAccountKey } : {}),
  }, {
    operationId: target.operationId,
    originalRequestedAt: target.originalRequestedAt,
  });
}

export function validateMetaLarkInventory(input = {}) {
  const tableIds = requireObject(input.tableIds, 'tableIds');
  const remoteTables = Array.isArray(input.remoteTables) ? input.remoteTables : [];
  const fieldsByKey = requireObject(input.fieldsByKey, 'fieldsByKey');
  const remoteIds = new Set(remoteTables.map(normalizeRemoteTableId).filter(Boolean));
  const seenIds = new Set();
  const missingTables = [];
  const missingKeyFields = [];
  const fieldCounts = {};

  for (const contract of META_END_TO_END_LARK_TABLES) {
    const tableId = requireText(tableIds[contract.tableKey], `tableIds.${contract.tableKey}`);
    if (seenIds.has(tableId)) {
      throw operatorError(
        'Meta Lark table IDs must be unique',
        'META_LARK_PREFLIGHT_DUPLICATE_TABLE_ID',
        { tableKey: contract.tableKey },
      );
    }
    seenIds.add(tableId);
    if (!remoteIds.has(tableId)) missingTables.push(contract.tableKey);
    const fields = Array.isArray(fieldsByKey[contract.tableKey]) ? fieldsByKey[contract.tableKey] : [];
    fieldCounts[contract.tableKey] = fields.length;
    if (!fields.some((field) => normalizeFieldName(field) === contract.keyField)) {
      missingKeyFields.push(`${contract.tableKey}.${contract.keyField}`);
    }
  }

  if (missingTables.length > 0 || missingKeyFields.length > 0) {
    throw operatorError(
      'Meta Lark destination inventory is incomplete',
      'META_LARK_PREFLIGHT_INCOMPLETE',
      { missingTables, missingKeyFields },
    );
  }
  return deepFreeze({
    tableCount: META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.length,
    allTablesPresent: true,
    allStableKeyFieldsPresent: true,
    tableIdFingerprint: sha256(stableJson([...seenIds].sort())),
    fieldCountFingerprint: sha256(stableJson(fieldCounts)),
    fieldCounts,
  });
}

export function validateMetaD1OnlySummaryForLark(value = {}, target = {}) {
  const valid = value?.phase === 'summary'
    && value?.status === 'passed'
    && value?.contractVersion === META_D1_ONLY_OPERATOR_CONTRACT_VERSION
    && value?.targetKey === target.targetKey
    && value?.operationId === target.operationId
    && value?.data?.accepted === true
    && value?.data?.d1OnlyVerified === true
    && value?.data?.idempotentRerunVerified === true
    && value?.data?.restoredAllFalse === true
    && Number(value?.data?.larkMutationCount) === 0
    && Number(value?.data?.scheduleActivationCount) === 0
    && value?.productionAllowed === false;
  if (!valid) {
    throw operatorError(
      'Meta D1-only summary is not accepted for Lark continuation',
      'META_LARK_D1_SUMMARY_INVALID',
    );
  }
  return deepFreeze({
    d1SummarySha256: sha256(stableJson(value)),
    d1EvidenceChainHeadSha256: requireFingerprint(
      value?.data?.evidenceChainHeadSha256,
      'data.evidenceChainHeadSha256',
    ),
    targetKey: value.targetKey,
    operationId: value.operationId,
  });
}

export function validateMetaLarkD1ReadyBoundary(snapshotInput = {}, target = {}) {
  const snapshot = normalizeMetaLarkSnapshot(snapshotInput);
  const normalStatus = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === null;
  const terminalRecovery = target.terminalRecovery === true
    && snapshot.syncRunStatus === 'failed'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === 'LARK_PREFLIGHT_FAILED';
  const orphanedRunningRecovery = target.orphanedRunningRecovery === true
    && snapshot.syncRunStatus === 'running'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt === null
    && snapshot.syncRunErrorCode === null
    && snapshot.observedAt - snapshot.syncRunStartedAt >= 16 * 60 * 1000
    && snapshot.syncRunUpdatedAt !== null
    && snapshot.observedAt - snapshot.syncRunUpdatedAt >= 16 * 60 * 1000
    && snapshot.queueOperationAttempts === 1
    && snapshot.mainQueueAttempts > 0
    && snapshot.queueOperationUpdatedAt !== null
    && snapshot.observedAt - snapshot.queueOperationUpdatedAt >= 16 * 60 * 1000;
  const ready = (normalStatus || terminalRecovery || orphanedRunningRecovery)
    && snapshot.d1PhaseComplete
    && !snapshot.preflightPhaseComplete
    && !snapshot.larkPhaseComplete
    && !snapshot.completionPhaseComplete
    && snapshot.activeLockCount === 0
    && snapshot.coverageRunCount > 0
    && snapshot.invalidCoverageCount === 0
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.workCompletedAt === null;
  if (!ready) {
    throw operatorError(
      'Meta target has not reached the accepted D1-only boundary',
      'META_LARK_D1_BOUNDARY_INVALID',
    );
  }
  return deepFreeze({
    accepted: true,
    terminalRecovery,
    orphanedRunningRecovery,
    snapshot,
  });
}

export function validateMetaLarkOrphanedRunningStability(beforeInput = {}, afterInput = {}, target = {}) {
  if (target.orphanedRunningRecovery !== true) {
    throw operatorError(
      'Meta orphaned-running recovery is not explicitly enabled',
      'META_LARK_ORPHANED_RUNNING_RECOVERY_NOT_ENABLED',
    );
  }
  const before = validateMetaLarkD1ReadyBoundary(beforeInput, target);
  const after = validateMetaLarkD1ReadyBoundary(afterInput, target);
  if (!before.orphanedRunningRecovery || !after.orphanedRunningRecovery) {
    throw operatorError(
      'Meta snapshots do not prove an orphaned running invocation',
      'META_LARK_ORPHANED_RUNNING_RECOVERY_INVALID',
    );
  }
  const elapsedMs = after.snapshot.observedAt - before.snapshot.observedAt;
  const stableBefore = { ...before.snapshot, observedAt: 0 };
  const stableAfter = { ...after.snapshot, observedAt: 0 };
  if (elapsedMs < 30_000 || stableJson(stableBefore) !== stableJson(stableAfter)) {
    throw operatorError(
      'Meta orphaned running state changed during the stability window',
      'META_LARK_ORPHANED_RUNNING_PROGRESS_OBSERVED',
      { elapsedMs },
    );
  }
  return deepFreeze({ accepted: true, elapsedMs, snapshot: after.snapshot });
}

export function buildMetaLarkSnapshotSql(target = {}) {
  const workKey = sqlText(requireText(target.workKey, 'workKey'));
  const syncRunId = sqlText(requireText(target.syncRunId, 'syncRunId'));
  const operationId = sqlText(requireText(target.operationId, 'operationId'));
  const platform = sqlText(requireText(target.platform, 'platform'));
  const accountKey = sqlText(requireText(target.accountKey, 'accountKey'));
  const customerKey = sqlText(requireText(target.customerKey, 'customerKey'));
  return compactSql(`
    SELECT
      (SELECT status FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_status,
      (SELECT started_at FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_started_at,
      (SELECT finished_at FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_finished_at,
      (SELECT error_code FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_error_code,
      (SELECT updated_at FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_updated_at,
      (SELECT status FROM sync_work_runs WHERE work_key = ${workKey}) AS work_status,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key = ${workKey}) AS work_lifecycle_status,
      (SELECT completed_at FROM sync_work_runs WHERE work_key = ${workKey}) AS work_completed_at,
      (SELECT completion_json FROM sync_work_runs WHERE work_key = ${workKey}) AS work_completion_json,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${D1_PHASE}') AS d1_phase_complete,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${PREFLIGHT_PHASE}') AS preflight_phase_complete,
      (SELECT state_json FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${PREFLIGHT_PHASE}') AS preflight_state_json,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${LARK_PHASE}') AS lark_phase_complete,
      (SELECT state_json FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${LARK_PHASE}') AS lark_state_json,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${COMPLETION_PHASE}') AS completion_phase_complete,
      (SELECT state_json FROM sync_work_phases WHERE work_key = ${workKey} AND phase = '${COMPLETION_PHASE}') AS completion_state_json,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = ${syncRunId} AND expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_operation_attempts,
      (SELECT COALESCE(MAX(main_queue_attempts), 0) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS main_queue_attempts,
      (SELECT MAX(updated_at) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_operation_updated_at,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${syncRunId}) AS coverage_run_count,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${syncRunId} AND (failed_rows <> 0 OR status NOT IN ('complete', 'no_data_confirmed', 'revisable'))) AS invalid_coverage_count,
      (SELECT COUNT(*) FROM data_coverage_entities WHERE coverage_run_id IN (SELECT coverage_run_id FROM data_coverage_runs WHERE sync_run_id = ${syncRunId})) AS coverage_entity_count,
      (SELECT COUNT(*) FROM organic_content_state WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_organic_state_count,
      (SELECT COUNT(*) FROM organic_content_observations WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_organic_observation_count,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_account_daily_count,
      (SELECT COUNT(*) FROM ads_entity_state WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_ads_entity_count,
      (SELECT COUNT(*) FROM ads_daily_facts WHERE customer_key = ${customerKey} AND platform = ${platform} AND account_key = ${accountKey}) AS target_ads_daily_count,
      (unixepoch('subsec') * 1000) AS observed_at;
  `);
}

export function normalizeMetaLarkSnapshot(value = {}) {
  if (isNormalizedSnapshot(value)) {
    return deepFreeze({
      ...value,
      targetCounts: { ...value.targetCounts },
      larkResults: value.larkResults.map((entry) => ({ ...entry })),
    });
  }
  const preflightState = parseNullableJson(value.preflight_state_json, 'preflight_state_json');
  const larkState = parseNullableJson(value.lark_state_json, 'lark_state_json');
  const completionState = parseNullableJson(value.completion_state_json, 'completion_state_json');
  const durableCompletion = parseNullableJson(
    value.work_completion_json,
    'work_completion_json',
  );
  const clearedPhaseCompletion = value.work_lifecycle_status === 'completed'
    && durableCompletion?.schemaVersion === 'meta_end_to_end_reconciliation_v1'
    && durableCompletion?.failed === 0
    && Number(durableCompletion?.d1?.expectedOperations) >= 0
    && Number(durableCompletion?.d1?.processedOperations)
      === Number(durableCompletion?.d1?.expectedOperations)
    && Array.isArray(durableCompletion?.preflight)
    && Array.isArray(durableCompletion?.lark);
  return deepFreeze({
    syncRunStatus: optionalText(value.sync_run_status),
    syncRunStartedAt: nullableNumber(value.sync_run_started_at),
    syncRunFinishedAt: nullableNumber(value.sync_run_finished_at),
    syncRunErrorCode: optionalText(value.sync_run_error_code),
    syncRunUpdatedAt: nullableNumber(value.sync_run_updated_at),
    workStatus: optionalText(value.work_status),
    workLifecycleStatus: optionalText(value.work_lifecycle_status),
    workCompletedAt: nullableNumber(value.work_completed_at),
    d1PhaseComplete: Number(value.d1_phase_complete ?? 0) === 1 || clearedPhaseCompletion,
    preflightPhaseComplete: Number(value.preflight_phase_complete ?? 0) === 1
      || clearedPhaseCompletion,
    preflightSummaries: Array.isArray(preflightState?.summaries)
      ? preflightState.summaries
      : (clearedPhaseCompletion ? durableCompletion.preflight : []),
    larkPhaseComplete: Number(value.lark_phase_complete ?? 0) === 1
      || clearedPhaseCompletion,
    larkResults: Array.isArray(larkState?.results)
      ? larkState.results
      : (clearedPhaseCompletion ? durableCompletion.lark : []),
    completionPhaseComplete: Number(value.completion_phase_complete ?? 0) === 1
      || clearedPhaseCompletion,
    completionReconciliation: completionState?.reconciliation
      ?? (clearedPhaseCompletion ? durableCompletion : null),
    clearedPhaseCompletion,
    completionOperationId: clearedPhaseCompletion ? optionalText(durableCompletion.operationId) : null,
    completionConnectorKey: clearedPhaseCompletion
      ? optionalText(durableCompletion.connectorKey)
      : null,
    activeLockCount: count(value.active_lock_count),
    queueOperationAttempts: count(value.queue_operation_attempts),
    mainQueueAttempts: count(value.main_queue_attempts),
    queueOperationUpdatedAt: nullableNumber(value.queue_operation_updated_at),
    observedAt: nullableNumber(value.observed_at) ?? 0,
    coverageRunCount: count(value.coverage_run_count),
    invalidCoverageCount: count(value.invalid_coverage_count),
    coverageEntityCount: count(value.coverage_entity_count),
    targetCounts: {
      organicState: count(value.target_organic_state_count),
      organicObservations: count(value.target_organic_observation_count),
      accountDaily: count(value.target_account_daily_count),
      adsEntities: count(value.target_ads_entity_count),
      adsDaily: count(value.target_ads_daily_count),
    },
  });
}

export function classifyMetaLarkCompletion(snapshot = {}, target = {}) {
  const value = normalizeMetaLarkSnapshot(snapshot);
  const expectedCount = expectedLarkContracts(target.connectorKey).length;
  const resultsValid = value.larkResults.length === expectedCount
    && value.larkResults.every((result) => {
      const expected = count(result?.expected);
      return expected === count(result?.created) + count(result?.updated) + count(result?.skipped);
    });
  const reconciliationResults = value.completionReconciliation?.lark;
  const durableComplete = value.d1PhaseComplete
    && value.preflightPhaseComplete
    && value.larkPhaseComplete
    && value.completionPhaseComplete
    && value.activeLockCount === 0
    && value.invalidCoverageCount === 0
    && value.workLifecycleStatus === 'completed'
    && value.workCompletedAt !== null
    && (!value.clearedPhaseCompletion
      || (value.completionOperationId === target.operationId
        && value.completionConnectorKey === target.connectorKey))
    && resultsValid
    && Array.isArray(reconciliationResults)
    && reconciliationResults.length === expectedCount;
  const complete = value.syncRunStatus === 'success'
    && value.syncRunFinishedAt !== null
    && value.syncRunErrorCode === null
    && durableComplete;
  return deepFreeze({
    complete,
    durableComplete,
    reason: complete ? 'lark_complete_and_reconciled' : 'incomplete_or_invalid',
    expectedLarkTableCount: expectedCount,
    snapshot: value,
  });
}

export function validateMetaLarkCompletedStability(
  beforeInput = {},
  afterInput = {},
  target = {},
  minimumElapsedMs = 5_000,
) {
  const before = classifyMetaLarkCompletion(beforeInput, target);
  const after = classifyMetaLarkCompletion(afterInput, target);
  const elapsedMs = after.snapshot.observedAt - before.snapshot.observedAt;
  const requiredElapsedMs = Math.max(0, Number(minimumElapsedMs) || 0);
  const stableBefore = { ...before.snapshot, observedAt: 0 };
  const stableAfter = { ...after.snapshot, observedAt: 0 };
  if (!before.complete
    || !after.complete
    || elapsedMs < requiredElapsedMs
    || stableJson(stableBefore) !== stableJson(stableAfter)) {
    throw operatorError(
      'Meta completed state changed during the stability window',
      'META_LARK_COMPLETED_PROGRESS_OBSERVED',
      { elapsedMs, requiredElapsedMs },
    );
  }
  return deepFreeze({ accepted: true, elapsedMs, snapshot: after.snapshot });
}

export function classifyMetaLarkPostCompletionOrphan(snapshot = {}, target = {}) {
  const value = normalizeMetaLarkSnapshot(snapshot);
  const durable = classifyMetaLarkCompletion(value, target);
  const latestActivityAt = Math.max(
    value.syncRunUpdatedAt ?? 0,
    value.queueOperationUpdatedAt ?? 0,
  );
  const accepted = target.orphanedRunningRecovery === true
    && durable.durableComplete
    && value.syncRunStatus === 'running'
    && value.syncRunStartedAt !== null
    && value.syncRunFinishedAt === null
    && value.syncRunErrorCode === null
    && value.workCompletedAt !== null
    && value.syncRunStartedAt > value.workCompletedAt
    && value.activeLockCount === 0
    && latestActivityAt > 0
    && value.observedAt - latestActivityAt >= 16 * 60 * 1000;
  return deepFreeze({ accepted, snapshot: value });
}

export function validateMetaLarkPostCompletionOrphanStability(beforeInput = {}, afterInput = {}, target = {}) {
  const before = classifyMetaLarkPostCompletionOrphan(beforeInput, target);
  const after = classifyMetaLarkPostCompletionOrphan(afterInput, target);
  const elapsedMs = after.snapshot.observedAt - before.snapshot.observedAt;
  const stableBefore = { ...before.snapshot, observedAt: 0 };
  const stableAfter = { ...after.snapshot, observedAt: 0 };
  if (!before.accepted
    || !after.accepted
    || elapsedMs < 30_000
    || stableJson(stableBefore) !== stableJson(stableAfter)) {
    throw operatorError(
      'Meta post-completion orphan changed during the stability window',
      'META_LARK_POST_COMPLETION_ORPHAN_PROGRESS_OBSERVED',
      { elapsedMs },
    );
  }
  return deepFreeze({ accepted: true, elapsedMs, snapshot: after.snapshot });
}

export function classifyMetaLarkPollingSnapshot(
  snapshot = {},
  target = {},
  minimumAttempts = 0,
  previousFinishedAt = null,
) {
  const attempts = count(minimumAttempts);
  const value = normalizeMetaLarkSnapshot(snapshot);
  if (value.mainQueueAttempts < attempts) {
    return deepFreeze({ state: 'pending', snapshot: value });
  }
  const newFinishedRunObserved = previousFinishedAt === null
    || (value.syncRunFinishedAt !== null
      && value.syncRunFinishedAt > Number(previousFinishedAt));
  if (newFinishedRunObserved && classifyMetaLarkCompletion(value, target).complete) {
    return deepFreeze({ state: 'complete', snapshot: value });
  }
  const terminalFailureObserved = value.syncRunStatus === 'failed'
    && value.syncRunFinishedAt !== null
    && (previousFinishedAt === null
      || value.syncRunFinishedAt > Number(previousFinishedAt));
  if (terminalFailureObserved) {
    return deepFreeze({
      state: 'terminal_failure',
      errorCode: value.syncRunErrorCode,
      snapshot: value,
    });
  }
  return deepFreeze({ state: 'pending', snapshot: value });
}

export function compareMetaLarkSnapshots(beforeInput, afterInput, target = {}, options = {}) {
  const before = normalizeMetaLarkSnapshot(beforeInput);
  const after = normalizeMetaLarkSnapshot(afterInput);
  if (after.invalidCoverageCount !== 0) {
    throw operatorError('Meta Lark continuation has invalid Coverage', 'META_LARK_COVERAGE_INVALID');
  }
  for (const key of Object.keys(before.targetCounts)) {
    if (after.targetCounts[key] !== before.targetCounts[key]) {
      throw operatorError(
        'Meta Lark continuation changed D1 Business counts',
        'META_LARK_D1_COUNT_DRIFT',
        { field: key, before: before.targetCounts[key], after: after.targetCounts[key] },
      );
    }
  }
  if (after.coverageRunCount !== before.coverageRunCount
    || after.coverageEntityCount !== before.coverageEntityCount) {
    throw operatorError('Meta Lark continuation changed Coverage counts', 'META_LARK_COVERAGE_COUNT_DRIFT');
  }
  if (after.mainQueueAttempts < before.mainQueueAttempts + 1) {
    throw operatorError('Meta Lark Queue attempt was not observed', 'META_LARK_QUEUE_ATTEMPT_MISSING');
  }
  const classified = classifyMetaLarkCompletion(after, target);
  const postCompletionOrphanAccepted = options.postCompletionOrphanVerified === true
    && classifyMetaLarkPostCompletionOrphan(after, target).accepted;
  if (!classified.complete && !postCompletionOrphanAccepted) {
    throw operatorError('Meta Lark continuation has not completed', 'META_LARK_COMPLETION_INVALID');
  }
  if (options.rerun === true) {
    if (sha256(stableJson(after.larkResults)) !== sha256(stableJson(before.larkResults))
      || sha256(stableJson(after.completionReconciliation))
        !== sha256(stableJson(before.completionReconciliation))) {
      throw operatorError('Meta Lark rerun changed reconciliation state', 'META_LARK_RERUN_RECONCILIATION_DRIFT');
    }
    return deepFreeze({
      accepted: true,
      rerun: true,
      larkReconciliationDrift: false,
      d1CountDrift: false,
      coverageCountDrift: false,
      postCompletionOrphanAccepted,
    });
  }
  return deepFreeze({
    accepted: true,
    rerun: false,
    expectedLarkTableCount: classified.expectedLarkTableCount,
    larkResults: after.larkResults,
    d1CountDrift: false,
    coverageCountDrift: false,
    postCompletionOrphanAccepted,
  });
}

export function createMetaLarkEvidence(input = {}) {
  const evidence = {
    phase: requirePhase(input.phase),
    status: 'passed',
    capturedAt: new Date(input.capturedAt ?? Date.now()).toISOString(),
    contractVersion: META_LARK_OPERATOR_CONTRACT_VERSION,
    repositoryHead: requireFullSha(input.repositoryHead, 'repositoryHead'),
    targetFingerprint: requireFingerprint(input.targetFingerprint, 'targetFingerprint'),
    targetKey: requireText(input.targetKey, 'targetKey'),
    operationId: requireText(input.operationId, 'operationId'),
    previousEvidenceSha256: input.previousEvidenceSha256
      ? requireFingerprint(input.previousEvidenceSha256, 'previousEvidenceSha256')
      : null,
    data: sanitizeEvidenceValue(input.data ?? {}),
    remoteMutationPerformed: input.remoteMutationPerformed === true,
    larkWritesAllowed: input.larkWritesAllowed === true,
    providerRequestsAllowed: false,
    scheduleActivationAllowed: false,
    productionAllowed: false,
  };
  return deepFreeze({ ...evidence, evidenceSha256: sha256(stableJson(evidence)) });
}

export function validateMetaLarkEvidenceSequence(evidence = [], target = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw operatorError('Meta Lark evidence chain is empty', 'META_LARK_EVIDENCE_MISSING');
  }
  let previous = null;
  for (const item of evidence) {
    if (item?.contractVersion !== META_LARK_OPERATOR_CONTRACT_VERSION
      || item?.repositoryHead !== target.repositoryHead
      || item?.targetFingerprint !== target.targetFingerprint
      || item?.targetKey !== target.targetKey
      || item?.operationId !== target.operationId
      || item?.providerRequestsAllowed !== false
      || item?.scheduleActivationAllowed !== false
      || item?.productionAllowed !== false) {
      throw operatorError('Meta Lark evidence does not match the target', 'META_LARK_EVIDENCE_INVALID');
    }
    const unsigned = { ...item };
    delete unsigned.evidenceSha256;
    if (item.evidenceSha256 !== sha256(stableJson(unsigned))) {
      throw operatorError('Meta Lark evidence hash is invalid', 'META_LARK_EVIDENCE_HASH_INVALID');
    }
    if ((item.previousEvidenceSha256 ?? null) !== (previous?.evidenceSha256 ?? null)) {
      throw operatorError('Meta Lark evidence chain is broken', 'META_LARK_EVIDENCE_CHAIN_INVALID');
    }
    previous = item;
  }
  return Object.freeze([...evidence]);
}

export function previousMetaLarkPhase(phase) {
  const index = META_LARK_OPERATOR_PHASES.indexOf(requirePhase(phase));
  return index > 0 ? META_LARK_OPERATOR_PHASES[index - 1] : null;
}

export function evidenceFileForMetaLarkPhase(phase) {
  return `${requirePhase(phase)}.json`;
}

export function expectedLarkContracts(connectorKey) {
  if (connectorKey === 'meta_ads') {
    const historicalTableKeys = new Set(META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS);
    return Object.freeze(META_END_TO_END_LARK_TABLES.filter(
      (contract) => historicalTableKeys.has(contract.tableKey),
    ));
  }
  const organic = connectorKey === 'facebook' || connectorKey === 'instagram';
  const prefixes = organic
    ? ['raw.organic', 'canonical.accounts', 'canonical.accountDaily', 'canonical.content']
    : [];
  return Object.freeze(META_END_TO_END_LARK_TABLES.filter(
    (contract) => prefixes.some((prefix) => contract.path.startsWith(prefix)),
  ));
}

function confirmation(envName, value) {
  return Object.freeze({ envName, value });
}

function replaceJsoncBoolean(text, key, enabled) {
  const regex = new RegExp(
    `(["']?${escapeRegex(key)}["']?\\s*:\\s*)(?:"(true|false)"|(true|false))`,
    'u',
  );
  if (!regex.test(text)) {
    throw operatorError(
      `Meta Lark config is missing ${key}`,
      'META_LARK_CONFIG_FLAG_MISSING',
      { key },
    );
  }
  return text.replace(regex, `$1"${enabled ? 'true' : 'false'}"`);
}

function requireJsoncBoolean(text, key, expected) {
  const regex = new RegExp(
    `["']?${escapeRegex(key)}["']?\\s*:\\s*(?:"(true|false)"|(true|false))`,
    'u',
  );
  const match = text.match(regex);
  const observed = match ? (match[1] ?? match[2]) === 'true' : null;
  if (observed !== expected) {
    throw operatorError(
      `Meta Lark config requires ${key}=${expected}`,
      'META_LARK_CONFIG_FLAG_INVALID',
      { key },
    );
  }
}

function extractJsoncTrueFlags(text) {
  return Object.freeze([
    ...text.matchAll(/["']?(MKT_[A-Z0-9_]+_ENABLED)["']?\s*:\s*(?:"true"|true)/gu),
  ].map((match) => match[1]).sort());
}

function normalizeRemoteTableId(table) {
  return optionalText(table?.tableId ?? table?.table_id ?? table?.id);
}

function normalizeFieldName(field) {
  return optionalText(field?.fieldName ?? field?.field_name ?? field?.name);
}

function isNormalizedSnapshot(value) {
  return Boolean(value && typeof value === 'object'
    && typeof value.d1PhaseComplete === 'boolean'
    && value.targetCounts
    && Array.isArray(value.larkResults));
}

function sanitizeEvidenceValue(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidenceValue(item, key));
  if (typeof value !== 'object') {
    return /token|secret|authorization|password|cookie/iu.test(key) ? '[REDACTED]' : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitizeEvidenceValue(nestedValue, nestedKey),
  ]));
}

function parseNullableJson(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw operatorError(`${fieldName} contains invalid JSON`, 'META_LARK_SNAPSHOT_INVALID', { fieldName });
  }
}

function requirePhase(value) {
  const phase = requireText(value, 'phase');
  if (!META_LARK_OPERATOR_PHASES.includes(phase)) {
    throw operatorError('Meta Lark phase is invalid', 'META_LARK_OPERATOR_PHASE_INVALID', { phase });
  }
  return phase;
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!FULL_SHA.test(text)) {
    throw operatorError(`${fieldName} must be a full SHA`, 'META_LARK_INPUT_INVALID', { fieldName });
  }
  return text;
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError(`${fieldName} must be a SHA-256 fingerprint`, 'META_LARK_INPUT_INVALID', { fieldName });
  }
  return text;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw operatorError(`${fieldName} must be an object`, 'META_LARK_INPUT_INVALID');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`${fieldName} is required`, 'META_LARK_INPUT_INVALID', { fieldName });
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw operatorError(`${fieldName} must be a positive integer`, 'META_LARK_INPUT_INVALID', { fieldName });
  }
  return number;
}

function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError('Meta Lark snapshot count is invalid', 'META_LARK_SNAPSHOT_INVALID');
  }
  return number;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
