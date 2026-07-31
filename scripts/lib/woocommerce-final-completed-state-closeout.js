import { createHash } from 'node:crypto';
import {
  createWooCommerceLarkSchemaContract,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';

export const WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION =
  'woocommerce_completed_state_closeout_v1';
export const WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONFIRMATION =
  'CLOSE_WOO_FINAL_FULL_011368480910_FROM_COMPLETED_STATE_ONLY';
export const WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID =
  'woo-final-full-011368480910';
export const WOOCOMMERCE_COMPLETED_STATE_WORK_KEY =
  `woocommerce:${WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID}`;
export const WOOCOMMERCE_COMPLETED_STATE_HISTORY_START =
  '2026-01-01T00:00:00.000Z';

const HISTORY_START_MS = Date.parse(WOOCOMMERCE_COMPLETED_STATE_HISTORY_START);
const COMPLETION_SCHEMA = 'woocommerce_commerce_reconciliation_v1';
const DATASET_KEYS = Object.freeze([
  'store',
  'orders',
  'products',
  'categories',
  'customers',
  'coupons',
]);

// Customer and Coupon Raw rows from the replaced pre-2026 scope are intentionally retained.
// They cannot be compared with the bounded 2026 Source counters. The four datasets below are
// current-snapshot or exact cleaned-range inventories and may be cross-checked at initial admission.
const FULL_SOURCE_PARITY_FIELDS = Object.freeze({
  store: 'raw_commerce_stores',
  orders: 'raw_commerce_orders',
  products: 'raw_commerce_products',
  categories: 'raw_commerce_categories',
});

export function parseWooCommerceCompletedStateCloseoutArgs(argv = []) {
  const unknown = argv.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw closeoutError(
      `Unsupported WooCommerce completed-state closeout arguments: ${unknown.join(', ')}`,
      'WOOCOMMERCE_COMPLETED_STATE_ARGUMENT_INVALID',
      { arguments: unknown },
    );
  }
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertWooCommerceCompletedStateCloseoutConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT
    !== WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONFIRMATION) {
    throw closeoutError(
      'WooCommerce completed-state closeout requires the exact confirmation value',
      'WOOCOMMERCE_COMPLETED_STATE_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function selectWooCommerceCompletedState(input = {}) {
  const operationId = requireOperationId(
    input.operationId ?? WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
  );
  const snapshot = normalizeWooCommerceFinalSnapshot(input.snapshot);
  const fullReconciliation = input.fullReconciliation !== false;
  const requireCurrentSourceParity = input.requireCurrentSourceParity !== false;
  const requestedAt = requireTimestamp(
    snapshot.queueOriginalRequestedAt,
    'queueOriginalRequestedAt',
  );
  const completion = requireObject(snapshot.completion, 'completion');
  const sourceScope = requireObject(completion.sourceScope, 'completion.sourceScope');
  const datasets = requireObject(completion.datasets, 'completion.datasets');
  const totals = requireObject(completion.totals, 'completion.totals');
  const observedDatasetKeys = Object.keys(datasets).sort();
  const expectedDatasetKeys = [...DATASET_KEYS].sort();
  const datasetKeySetExact = stableJson(observedDatasetKeys)
    === stableJson(expectedDatasetKeys);
  const exactFullIdentity = !fullReconciliation
    || operationId === WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID;
  const generationsAgree = snapshot.queueGeneration === requestedAt
    && snapshot.workGeneration === requestedAt
    && snapshot.workRequestedAt === requestedAt
    && Number(completion.generation) === requestedAt;
  const scopeMatches = Number(sourceScope.orderCreatedAfter) === HISTORY_START_MS
    && Number(sourceScope.orderCreatedBefore) === requestedAt
    && completion.scopeMode === 'report_range'
    && (fullReconciliation
      ? sourceScope.modifiedAfter === null
        && sourceScope.incrementalBoundary === null
      : Number.isSafeInteger(Number(sourceScope.modifiedAfter))
        && optionalText(sourceScope.incrementalBoundary) !== null);
  const identityMatches = completion.schemaVersion === COMPLETION_SCHEMA
    && completion.workKey === `woocommerce:${operationId}`;
  const phaseRetiredAfterCompletion = snapshot.phaseComplete === false
    && snapshot.state === null;
  const datasetSummary = validateDatasets({
    datasets,
    counts: snapshot.counts,
    fullReconciliation,
    requireCurrentSourceParity,
  });
  const completionValid = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === null
    && snapshot.workLifecycleStatus === 'completed'
    && snapshot.workCompletedAt !== null
    && phaseRetiredAfterCompletion
    && snapshot.activeLockCount === 0
    && snapshot.queueOperationAttempts >= 1
    && snapshot.coverageRunCount === DATASET_KEYS.length
    && snapshot.invalidCoverageCount === 0
    && exactFullIdentity
    && generationsAgree
    && scopeMatches
    && identityMatches
    && datasetKeySetExact
    && nonNegativeInteger(totals.failedRows, 'completion.totals.failedRows') === 0
    && nonNegativeInteger(completion.failed, 'completion.failed') === 0
    && datasetSummary.failedRows === 0;

  if (!completionValid) {
    throw closeoutError(
      'WooCommerce completed durable state does not satisfy the exact closeout contract',
      'WOOCOMMERCE_COMPLETED_STATE_INVALID',
      {
        operationId,
        syncRunStatus: snapshot.syncRunStatus,
        workLifecycleStatus: snapshot.workLifecycleStatus,
        phaseRetiredAfterCompletion,
        activeLockCount: snapshot.activeLockCount,
        queueOperationAttempts: snapshot.queueOperationAttempts,
        coverageRunCount: snapshot.coverageRunCount,
        invalidCoverageCount: snapshot.invalidCoverageCount,
        exactFullIdentity,
        generationsAgree,
        scopeMatches,
        identityMatches,
        datasetKeySetExact,
        fullReconciliation,
        requireCurrentSourceParity,
      },
    );
  }

  return Object.freeze({
    operationId,
    requestedAt,
    priorQueueAttempts: snapshot.queueOperationAttempts,
    fullReconciliation,
    reusedCompletedOperation: true,
    snapshot,
    completion,
    datasetSummary,
    completionFingerprint: completedStateFingerprint({ operationId, snapshot }),
  });
}

export function classifyWooCommerceCompletedStatePoll(input = {}) {
  const snapshot = normalizeWooCommerceFinalSnapshot(input.snapshot);
  const minimumQueueAttempts = nonNegativeInteger(
    input.minimumQueueAttempts ?? 0,
    'minimumQueueAttempts',
  );
  const terminalFailure = snapshot.syncRunStatus === 'failed'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode !== null
    && snapshot.syncRunRetryable === false
    && snapshot.activeLockCount === 0
    && snapshot.queueOperationAttempts >= minimumQueueAttempts;
  if (terminalFailure) {
    return Object.freeze({
      complete: false,
      terminalFailure: true,
      pendingAdmission: false,
      pendingExecution: false,
      snapshot,
    });
  }

  // Cloudflare Queue acceptance and D1 visibility are not atomic. Keep the temporary UAT window
  // active while the exact operation has not reached durable admission instead of interpreting
  // missing Queue/Sync/Work fields as an invalid completed-state timestamp.
  const pendingAdmission = snapshot.queueOperationAttempts < minimumQueueAttempts
    || (snapshot.queueOriginalRequestedAt === null
      && snapshot.queueGeneration === null
      && snapshot.syncRunStatus === null
      && snapshot.workLifecycleStatus === null
      && snapshot.completion === null);
  const pendingExecution = pendingAdmission
    || snapshot.syncRunStatus === null
    || snapshot.syncRunStatus === 'running'
    || snapshot.workLifecycleStatus === null
    || snapshot.workLifecycleStatus === 'active'
    || snapshot.completion === null;
  if (pendingExecution) {
    return Object.freeze({
      complete: false,
      terminalFailure: false,
      pendingAdmission,
      pendingExecution: true,
      snapshot,
    });
  }

  try {
    const selected = selectWooCommerceCompletedState(input);
    if (selected.priorQueueAttempts < minimumQueueAttempts) {
      return Object.freeze({
        complete: false,
        terminalFailure: false,
        pendingAdmission: true,
        pendingExecution: true,
        snapshot,
      });
    }
    return Object.freeze({
      complete: true,
      terminalFailure: false,
      pendingAdmission: false,
      pendingExecution: false,
      snapshot,
      selected,
    });
  } catch (error) {
    if (![
      'WOOCOMMERCE_COMPLETED_STATE_INVALID',
      'WOOCOMMERCE_COMPLETED_STATE_DATASET_INCOMPLETE',
      'WOOCOMMERCE_COMPLETED_STATE_SOURCE_COUNT_DRIFT',
    ].includes(error?.code)) throw error;
    return Object.freeze({
      complete: false,
      terminalFailure: false,
      pendingAdmission: false,
      pendingExecution: false,
      snapshot,
    });
  }
}

export function compareWooCommerceCompletedStateReplay(beforeInput, afterInput) {
  const before = selectWooCommerceCompletedState(beforeInput);
  const after = selectWooCommerceCompletedState(afterInput);
  const businessCountsMatch = stableJson(before.snapshot.counts)
    === stableJson(after.snapshot.counts);
  const coverageMatches = before.snapshot.coverageRunCount
      === after.snapshot.coverageRunCount
    && before.snapshot.invalidCoverageCount
      === after.snapshot.invalidCoverageCount;
  if (before.operationId !== after.operationId
    || after.priorQueueAttempts < before.priorQueueAttempts + 1
    || before.completionFingerprint !== after.completionFingerprint
    || !businessCountsMatch
    || !coverageMatches) {
    throw closeoutError(
      'WooCommerce completed-state replay changed durable completion or missed the Queue attempt',
      'WOOCOMMERCE_COMPLETED_STATE_REPLAY_INVALID',
      {
        operationIdMatches: before.operationId === after.operationId,
        beforeQueueAttempts: before.priorQueueAttempts,
        afterQueueAttempts: after.priorQueueAttempts,
        completionFingerprintMatches:
          before.completionFingerprint === after.completionFingerprint,
        businessCountsMatch,
        coverageMatches,
      },
    );
  }
  return Object.freeze({
    accepted: true,
    operationId: before.operationId,
    queueAttemptObserved: true,
    durableCompletionUnchanged: true,
    businessCountDrift: false,
    coverageDrift: false,
  });
}

export function validateWooCommerceCompletedStateRemotePreflight(row = {}) {
  const activeWork = nonNegativeInteger(row.active_work, 'active_work');
  const activeLocks = nonNegativeInteger(row.active_locks, 'active_locks');
  const activeQueueOperations = nonNegativeInteger(
    row.active_queue_operations ?? 0,
    'active_queue_operations',
  );
  const oldRows = [
    'old_raw_order_items',
    'old_raw_refunds',
    'old_raw_orders',
    'old_order_status_observations',
    'old_order_line_facts',
    'old_order_state',
    'old_daily',
    'old_product_daily',
  ].reduce((sum, field) => sum + nonNegativeInteger(row[field] ?? 0, field), 0);
  if (activeWork !== 0 || activeLocks !== 0 || activeQueueOperations !== 0 || oldRows !== 0) {
    throw closeoutError(
      'WooCommerce completed-state closeout requires zero active reliability state and zero pre-2026 rows',
      'WOOCOMMERCE_COMPLETED_STATE_REMOTE_PREFLIGHT_INVALID',
      { activeWork, activeLocks, activeQueueOperations, oldRows },
    );
  }
  return Object.freeze({ activeWork, activeLocks, activeQueueOperations, oldRows });
}

export function validateWooCommerceCompletedStateLarkTables(input = {}) {
  const env = requireObject(input.env, 'env');
  const liveTables = requireArray(input.liveTables, 'liveTables');
  const byId = new Map(liveTables.map((table) => [table.tableId, table]));
  const tableIds = {};
  for (const contract of createWooCommerceLarkSchemaContract()) {
    const tableId = requireText(env[contract.envName], contract.envName);
    if (!byId.has(tableId)) {
      throw closeoutError(
        'WooCommerce completed-state closeout cannot resolve a configured Lark table',
        'WOOCOMMERCE_COMPLETED_STATE_LARK_TABLE_INVALID',
        { tableKey: contract.tableKey },
      );
    }
    tableIds[contract.tableKey] = tableId;
  }
  if (new Set(Object.values(tableIds)).size !== Object.keys(tableIds).length) {
    throw closeoutError(
      'WooCommerce completed-state closeout found duplicate Lark table bindings',
      'WOOCOMMERCE_COMPLETED_STATE_LARK_TABLE_DUPLICATE',
    );
  }
  return Object.freeze(tableIds);
}

export function completedStateFingerprint(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const snapshot = normalizeWooCommerceFinalSnapshot(input.snapshot);
  return sha256(stableJson({
    operationId,
    workLifecycleStatus: snapshot.workLifecycleStatus,
    workGeneration: snapshot.workGeneration,
    workRequestedAt: snapshot.workRequestedAt,
    completion: snapshot.completion,
    queueGeneration: snapshot.queueGeneration,
    queueOriginalRequestedAt: snapshot.queueOriginalRequestedAt,
    coverageRunCount: snapshot.coverageRunCount,
    invalidCoverageCount: snapshot.invalidCoverageCount,
  }));
}

export function sanitizeWooCommerceCompletedStateEvidence(value) {
  return sanitize(value);
}

function validateDatasets(input) {
  let sourceRows = 0;
  let d1Rows = 0;
  let derivedRows = 0;
  let larkRows = 0;
  let failedRows = 0;
  for (const key of DATASET_KEYS) {
    const dataset = requireObject(input.datasets[key], `completion.datasets.${key}`);
    const expected = nonNegativeInteger(dataset.expectedRows, `${key}.expectedRows`);
    const observed = nonNegativeInteger(dataset.sourceRows, `${key}.sourceRows`);
    if (input.fullReconciliation && expected !== observed) {
      throw closeoutError(
        'WooCommerce completed-state dataset is incomplete',
        'WOOCOMMERCE_COMPLETED_STATE_DATASET_INCOMPLETE',
        { dataset: key, expectedRows: expected, sourceRows: observed },
      );
    }
    const d1 = nonNegativeInteger(dataset.d1Rows ?? 0, `${key}.d1Rows`);
    const derived = nonNegativeInteger(dataset.derivedRows ?? 0, `${key}.derivedRows`);
    const lark = nonNegativeInteger(dataset.larkRows ?? 0, `${key}.larkRows`);
    const failed = nonNegativeInteger(dataset.failedRows ?? 0, `${key}.failedRows`);
    const d1CountField = FULL_SOURCE_PARITY_FIELDS[key] ?? null;
    if (input.fullReconciliation && input.requireCurrentSourceParity && d1CountField) {
      const currentCount = nonNegativeInteger(input.counts[d1CountField], d1CountField);
      if (currentCount !== observed) {
        throw closeoutError(
          'WooCommerce completed-state Source rows differ from current D1 Raw counts',
          'WOOCOMMERCE_COMPLETED_STATE_SOURCE_COUNT_DRIFT',
          { dataset: key, sourceRows: observed, d1RawRows: currentCount },
        );
      }
    }
    sourceRows += observed;
    d1Rows += d1;
    derivedRows += derived;
    larkRows += lark;
    failedRows += failed;
  }
  return Object.freeze({
    datasetCount: DATASET_KEYS.length,
    sourceRows,
    d1Rows,
    derivedRows,
    larkRows,
    failedRows,
  });
}

function requireOperationId(value) {
  const operationId = requireText(value, 'operationId').toLowerCase();
  if (!/^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u.test(operationId)) {
    throw closeoutError(
      'WooCommerce completed-state operation ID is invalid',
      'WOOCOMMERCE_COMPLETED_STATE_OPERATION_INVALID',
    );
  }
  return operationId;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} is invalid`,
      'WOOCOMMERCE_COMPLETED_STATE_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} must be a non-negative integer`,
      'WOOCOMMERCE_COMPLETED_STATE_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw closeoutError(
      `WooCommerce completed-state requires ${fieldName}`,
      'WOOCOMMERCE_COMPLETED_STATE_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} must be an object`,
      'WOOCOMMERCE_COMPLETED_STATE_VALUE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} must be an array`,
      'WOOCOMMERCE_COMPLETED_STATE_VALUE_INVALID',
      { fieldName },
    );
  }
  return value;
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

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|password|authorization|cookie|url|tableId|recordId|payload)/iu.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = sanitize(nested);
    }
  }
  return output;
}

function closeoutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceCompletedStateCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}
