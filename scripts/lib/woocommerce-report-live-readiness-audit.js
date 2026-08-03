import {
  REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  assertReportRuntimeFinalizerEvidence,
  assertWooCommerceReportRuntimeCloseoutPreflight,
} from './report-runtime-closeout-operator.js';

export const WOOCOMMERCE_REPORT_LIVE_READINESS_CONTRACT_VERSION =
  'woocommerce_report_live_readiness_audit_v1';
export const WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION =
  'RUN_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT';
export const WOOCOMMERCE_REPORT_REQUIRED_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT = 58;
export const WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD = Object.freeze({
  fieldId: 'fldMlTUP3Z',
  fieldName: 'window_days',
  optionNames: Object.freeze(['1', '3', '7', '30']),
});

const VALID_DATA_STATUSES = new Set(['complete', 'partial', 'revisable', 'no_data_confirmed']);

export function parseWooCommerceReportLiveReadinessArgs(argv = []) {
  const unknown = argv.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) throw auditError(
    `Unsupported WooCommerce Report readiness arguments: ${unknown.join(', ')}`,
    'WOOCOMMERCE_REPORT_LIVE_READINESS_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertWooCommerceReportLiveReadinessConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT
    !== WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION) {
    throw auditError(
      `Execution requires CONFIRM_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT=${WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION}`,
      'WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assessWooCommerceReportLiveReadiness(input = {}) {
  const blockers = [];
  const warnings = [];
  const requiredActions = [];

  assessRepository(input.repository, blockers);
  assessFinalizer(input.finalizerEvidence, input.repository, blockers);
  assessConfig(input.config, blockers);
  assessD1(input.d1Preflight, input.pendingMigrations, blockers);
  assessRemoteWorker(input.remoteWorker, blockers);
  assessLarkSchema(input.larkSchema, blockers);

  const windows = WOOCOMMERCE_REPORT_REQUIRED_WINDOWS.map((windowDays) => assessWindow({
    windowDays,
    d1: findWindow(input.d1Windows, windowDays),
    lark: findWindow(input.larkWindows, windowDays),
    blockers,
    warnings,
    requiredActions,
  }));

  const decision = blockers.length === 0
    ? 'READY_FOR_CONTROLLED_MATERIALIZATION'
    : 'BLOCKED';
  return Object.freeze({
    ok: blockers.length === 0,
    contractVersion: WOOCOMMERCE_REPORT_LIVE_READINESS_CONTRACT_VERSION,
    decision,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    requiredActions: Object.freeze(requiredActions),
    windows: Object.freeze(windows),
    remoteMutationCount: 0,
    production: 'BLOCKED',
  });
}

export function safeWooCommerceReportReadinessEvidence(value) {
  if (Array.isArray(value)) return value.map(safeWooCommerceReportReadinessEvidence);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|authorization|cookie|password|consumer_key|consumer_secret|queueId|databaseId|tableId)/iu.test(key)) {
      continue;
    }
    output[key] = safeWooCommerceReportReadinessEvidence(nested);
  }
  return output;
}

function assessRepository(repository, blockers) {
  if (repository?.branch !== 'main'
    || repository?.clean !== true
    || !isFullSha(repository?.head)
    || repository?.head !== repository?.originMainHead) {
    addBlocker(blockers, 'REPOSITORY_NOT_CLEAN_CURRENT_MAIN', {
      branch: repository?.branch ?? null,
      clean: repository?.clean === true,
      headMatchesOriginMain: repository?.head === repository?.originMainHead,
    });
  }
}

function assessFinalizer(finalizerEvidence, repository, blockers) {
  try {
    assertReportRuntimeFinalizerEvidence(finalizerEvidence ?? {});
  } catch (error) {
    addBlocker(blockers, 'REPORT_FINALIZER_EVIDENCE_INVALID', {
      sourceCode: error?.code ?? null,
      observedCanonicalActive: finiteOrNull(finalizerEvidence?.settings?.canonicalActive),
      expectedCanonicalActive: REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
      observedActiveLegacySettings: finiteOrNull(finalizerEvidence?.settings?.activeLegacySettings),
      evidenceHeadMatchesCurrent: finalizerEvidence?.repository?.head === repository?.head,
    });
    return;
  }
  if (finalizerEvidence?.repository?.head !== repository?.head) {
    addBlocker(blockers, 'REPORT_FINALIZER_HEAD_MISMATCH', {
      headMatches: false,
    });
  }
}

function assessConfig(config, blockers) {
  const expectedActive = [...WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS].sort();
  const observedActive = Array.isArray(config?.activeTrueFlags)
    ? [...config.activeTrueFlags].sort()
    : [];
  if (config?.valid !== true
    || !Array.isArray(config?.safeTrueFlags)
    || config.safeTrueFlags.length !== 0
    || JSON.stringify(observedActive) !== JSON.stringify(expectedActive)
    || config?.tableMappingsReady !== true) {
    addBlocker(blockers, 'REPORT_CONFIG_NOT_READY', {
      sourceCode: config?.errorCode ?? null,
      configValid: config?.valid === true,
      safeTrueFlagCount: Array.isArray(config?.safeTrueFlags) ? config.safeTrueFlags.length : null,
      activeFlagsMatch: JSON.stringify(observedActive) === JSON.stringify(expectedActive),
      tableMappingsReady: config?.tableMappingsReady === true,
    });
  }
}

function assessD1(d1Preflight, pendingMigrations, blockers) {
  try {
    assertWooCommerceReportRuntimeCloseoutPreflight(d1Preflight ?? {});
  } catch (error) {
    addBlocker(blockers, 'WOOCOMMERCE_D1_REPORT_SOURCE_NOT_READY', {
      sourceCode: error?.code ?? null,
      coverageStatus: d1Preflight?.coverage_status ?? null,
      coverageScopeMode: d1Preflight?.coverage_scope_mode ?? null,
      dailyFactCount: Number(d1Preflight?.daily_fact_count ?? 0),
      orderStateCount: Number(d1Preflight?.order_state_count ?? 0),
    });
  }
  if (!Array.isArray(pendingMigrations) || pendingMigrations.length > 0) {
    addBlocker(blockers, 'PENDING_D1_MIGRATIONS', {
      pendingMigrationCount: Array.isArray(pendingMigrations) ? pendingMigrations.length : null,
      pendingMigrations: Array.isArray(pendingMigrations) ? [...pendingMigrations] : [],
    });
  }
}

function assessRemoteWorker(remoteWorker, blockers) {
  if (remoteWorker?.verified !== true
    || !Array.isArray(remoteWorker?.trueFlags)
    || remoteWorker.trueFlags.length !== 0
    || remoteWorker?.d1BindingMatches !== true
    || remoteWorker?.queueBindingMatches !== true
    || remoteWorker?.tableMappingsMatch !== true) {
    addBlocker(blockers, 'REMOTE_WORKER_NOT_ALL_FALSE_OR_TARGET_DRIFT', {
      verified: remoteWorker?.verified === true,
      trueFlagCount: Array.isArray(remoteWorker?.trueFlags) ? remoteWorker.trueFlags.length : null,
      d1BindingMatches: remoteWorker?.d1BindingMatches === true,
      queueBindingMatches: remoteWorker?.queueBindingMatches === true,
      tableMappingsMatch: remoteWorker?.tableMappingsMatch === true,
    });
  }
}

function assessLarkSchema(larkSchema, blockers) {
  if (larkSchema?.tablesReady !== true || larkSchema?.stableKeyFieldsReady !== true) {
    addBlocker(blockers, 'LARK_REPORT_SCHEMA_NOT_READY', {
      tablesReady: larkSchema?.tablesReady === true,
      stableKeyFieldsReady: larkSchema?.stableKeyFieldsReady === true,
    });
  }
  const field = larkSchema?.windowField ?? {};
  const optionNames = Array.isArray(field.optionNames) ? field.optionNames.map(String) : [];
  if (field.fieldId !== WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.fieldId
    || field.fieldName !== WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.fieldName
    || JSON.stringify(optionNames) !== JSON.stringify(WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.optionNames)
    || field.optionIdsUnique !== true) {
    addBlocker(blockers, 'LARK_WINDOW_FIELD_IDENTITY_OR_OPTIONS_DRIFT', {
      fieldIdMatches: field.fieldId === WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.fieldId,
      fieldNameMatches: field.fieldName === WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.fieldName,
      optionsMatch: JSON.stringify(optionNames)
        === JSON.stringify(WOOCOMMERCE_REPORT_EXPECTED_WINDOW_FIELD.optionNames),
      optionIdsUnique: field.optionIdsUnique === true,
    });
  }
}

function assessWindow({ windowDays, d1, lark, blockers, warnings, requiredActions }) {
  const d1Count = Number(d1?.materializationCount ?? 0);
  const larkSnapshots = Number(lark?.snapshotCount ?? 0);
  const larkMetrics = Number(lark?.metricCount ?? 0);
  const duplicateMetricKeys = Number(lark?.duplicateMetricKeys ?? 0);
  const payloadMetricCount = Number(d1?.payloadMetricCount ?? 0);
  const dataStatus = d1?.dataStatus ?? null;

  if (d1Count === 0 && larkSnapshots === 0 && larkMetrics === 0) {
    requiredActions.push(Object.freeze({ windowDays, action: 'create_materialization' }));
    return Object.freeze({
      windowDays,
      state: 'missing',
      action: 'create_materialization',
      expectedMetricCount: WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT,
    });
  }

  if (d1Count === 0 && (larkSnapshots > 0 || larkMetrics > 0)) {
    addBlocker(blockers, 'LARK_ORPHAN_REPORT_ROWS', { windowDays, larkSnapshots, larkMetrics });
    return Object.freeze({ windowDays, state: 'blocked_orphan_lark', action: 'manual_review' });
  }
  if (d1Count !== 1) {
    addBlocker(blockers, 'D1_REPORT_IDENTITY_COUNT_INVALID', { windowDays, materializationCount: d1Count });
  }
  if (!VALID_DATA_STATUSES.has(String(dataStatus))) {
    addBlocker(blockers, 'D1_REPORT_DATA_STATUS_INVALID', { windowDays, dataStatus });
  }
  if (duplicateMetricKeys !== 0) {
    addBlocker(blockers, 'LARK_DUPLICATE_REPORT_METRIC_KEYS', { windowDays, duplicateMetricKeys });
  }
  if (larkSnapshots > 1) {
    addBlocker(blockers, 'LARK_DUPLICATE_REPORT_SNAPSHOTS', { windowDays, snapshotCount: larkSnapshots });
  }

  const currentShapeReady = payloadMetricCount === WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT
    && larkSnapshots === 1
    && larkMetrics === WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT
    && lark?.parity === true;
  if (!currentShapeReady && d1Count === 1 && duplicateMetricKeys === 0 && larkSnapshots <= 1) {
    const action = payloadMetricCount === 13 || larkMetrics === 13
      ? 'refresh_legacy_13_to_58'
      : 'refresh_or_repair_materialization';
    requiredActions.push(Object.freeze({
      windowDays,
      action,
      payloadMetricCount,
      larkMetricCount: larkMetrics,
    }));
    warnings.push(Object.freeze({
      code: 'WINDOW_REQUIRES_CONTROLLED_REFRESH',
      windowDays,
      payloadMetricCount,
      larkMetricCount: larkMetrics,
      parity: lark?.parity === true,
    }));
    return Object.freeze({
      windowDays,
      state: 'refresh_required',
      action,
      payloadMetricCount,
      larkMetricCount: larkMetrics,
      parity: lark?.parity === true,
    });
  }

  return Object.freeze({
    windowDays,
    state: currentShapeReady ? 'ready_reusable' : 'blocked',
    action: currentShapeReady ? 'reuse_or_idempotent_verify' : 'manual_review',
    payloadMetricCount,
    larkMetricCount: larkMetrics,
    parity: lark?.parity === true,
  });
}

function findWindow(values, windowDays) {
  return Array.isArray(values)
    ? values.find((value) => Number(value?.windowDays) === windowDays) ?? null
    : null;
}

function addBlocker(blockers, code, details = {}) {
  blockers.push(Object.freeze({ code, details: Object.freeze({ ...details }) }));
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/iu.test(value);
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceReportLiveReadinessAuditError';
  error.code = code;
  error.details = details;
  return error;
}
