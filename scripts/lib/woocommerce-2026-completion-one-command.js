export const WOOCOMMERCE_2026_COMPLETION_CONFIRMATION =
  'EXECUTE_WOOCOMMERCE_2026_COMPLETION';
export const WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER =
  'MKT_WOOCOMMERCE_2026_COMPLETION_SEALED';
export const WOOCOMMERCE_2026_COMPLETION_SEALED_ROOT =
  'MKT_WOOCOMMERCE_2026_COMPLETION_SEALED_ROOT';
export const WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD =
  'MKT_WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD';
export const WOOCOMMERCE_2026_COMPLETION_SEALED_VALUE = '1';
export const WOOCOMMERCE_2026_COMPLETION_CONTRACT_VERSION =
  'woocommerce_2026_completion_one_command_v1';
export const WOOCOMMERCE_2026_HISTORY_START =
  '2026-01-01T00:00:00.000Z';

const SHA_40 = /^[0-9a-f]{40}$/u;
const REQUIRED_ZERO_CLEANUP_FIELDS = Object.freeze([
  'old_raw_order_items',
  'old_raw_refunds',
  'old_raw_orders',
  'old_order_status_observations',
  'old_order_line_facts',
  'old_order_state',
  'old_daily',
  'old_product_daily',
]);

export function parseWooCommerce2026CompletionArgs(argv = []) {
  const unknown = argv.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) throw completionError(
    `Unsupported WooCommerce completion arguments: ${unknown.join(', ')}`,
    'WOOCOMMERCE_2026_COMPLETION_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertWooCommerce2026CompletionConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_2026_COMPLETION
    !== WOOCOMMERCE_2026_COMPLETION_CONFIRMATION) {
    throw completionError(
      `Execution requires CONFIRM_WOOCOMMERCE_2026_COMPLETION=${WOOCOMMERCE_2026_COMPLETION_CONFIRMATION}`,
      'WOOCOMMERCE_2026_COMPLETION_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function requireWooCommerce2026CompletionHead(value) {
  const head = requireText(value, 'repository head').toLowerCase();
  if (!SHA_40.test(head)) throw completionError(
    'WooCommerce completion requires a full 40-character Git SHA',
    'WOOCOMMERCE_2026_COMPLETION_HEAD_INVALID',
  );
  return head;
}

export function collectEnabledMktFlags(value) {
  const flags = new Map();
  visit(value);
  return Object.freeze([...flags.entries()]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort());

  function visit(node) {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) {
        flags.set(key, booleanLike(nested));
      }
      visit(nested);
    }
    if (typeof node.name === 'string'
      && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(
        node.name,
        booleanLike(node.text ?? node.value ?? node.json ?? node.data),
      );
    }
  }
}

export function selectExactlyOneActiveWorkerVersion(deployment = {}) {
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const active = versions.filter((item) => Number(item?.percentage) === 100);
  const versionId = active[0]?.version_id ?? active[0]?.versionId ?? null;
  if (active.length !== 1 || typeof versionId !== 'string' || versionId.trim() === '') {
    throw completionError(
      'WooCommerce completion requires exactly one 100% active Worker version',
      'WOOCOMMERCE_2026_COMPLETION_ACTIVE_VERSION_INVALID',
      { activeVersionCount: active.length },
    );
  }
  return versionId.trim();
}

export function assertWooCommerce2026RemoteSafeFlags(versionView = {}) {
  const enabledFlags = collectEnabledMktFlags(versionView);
  if (enabledFlags.length !== 0) throw completionError(
    'WooCommerce completion is blocked by enabled Worker execution flags',
    'WOOCOMMERCE_2026_COMPLETION_REMOTE_FLAGS_ACTIVE',
    { enabledFlags },
  );
  return Object.freeze({ enabledFlags, allFalse: true });
}

export function validateWooCommerce2026CleanupPreflight(row = {}) {
  const activeWork = integer(row.active_work, 'active_work');
  const replacedActiveWork = integer(
    row.replaced_active_work,
    'replaced_active_work',
  );
  const otherActiveWork = integer(row.other_active_work, 'other_active_work');
  const activeLocks = integer(row.active_locks, 'active_locks');
  const workStatus = nullableText(row.replaced_work_status);
  const syncStatus = nullableText(row.replaced_sync_status);
  const syncErrorCode = nullableText(row.replaced_sync_error_code);
  const oldRows = sumFields(row, REQUIRED_ZERO_CLEANUP_FIELDS);
  const aggregateRows = integer(
    row.old_customer_aggregates,
    'old_customer_aggregates',
  );

  if (activeLocks !== 0 || otherActiveWork > 1) throw completionError(
    'Foreign active work or lock blocks WooCommerce 2026 cleanup',
    'WOOCOMMERCE_2026_COMPLETION_CLEANUP_BLOCKED',
    { activeWork, replacedActiveWork, otherActiveWork, activeLocks },
  );

  const pendingExactCleanup = activeWork === 1
    && replacedActiveWork === 1
    && otherActiveWork === 0
    && workStatus === 'active'
    && syncStatus === 'running';
  const alreadyClean = replacedActiveWork === 0
    && activeWork === otherActiveWork
    && workStatus === 'terminal'
    && syncStatus === 'failed'
    && syncErrorCode === 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED'
    && oldRows === 0;

  if (!pendingExactCleanup && !alreadyClean) throw completionError(
    'WooCommerce 2026 cleanup state is not the exact pending or completed contract',
    'WOOCOMMERCE_2026_COMPLETION_CLEANUP_STATE_INVALID',
    {
      activeWork,
      replacedActiveWork,
      otherActiveWork,
      activeLocks,
      workStatus,
      syncStatus,
      syncErrorCode,
      oldRows,
      aggregateRows,
    },
  );

  return Object.freeze({
    pendingExactCleanup,
    alreadyClean,
    activeWork,
    otherActiveWork,
    activeLocks,
    oldRows,
    aggregateRows,
  });
}

export function validateWooCommerce2026CleanupPostState(row = {}) {
  const activeWork = integer(row.active_work, 'active_work');
  const replacedActiveWork = integer(
    row.replaced_active_work,
    'replaced_active_work',
  );
  const otherActiveWork = integer(row.other_active_work, 'other_active_work');
  const activeLocks = integer(row.active_locks, 'active_locks');
  const oldRows = sumFields(row, REQUIRED_ZERO_CLEANUP_FIELDS);
  const aggregateRows = integer(
    row.old_customer_aggregates,
    'old_customer_aggregates',
  );
  const workStatus = nullableText(row.replaced_work_status);
  const syncStatus = nullableText(row.replaced_sync_status);
  const syncErrorCode = nullableText(row.replaced_sync_error_code);

  if (oldRows !== 0
    || aggregateRows !== 0
    || activeWork !== 0
    || replacedActiveWork !== 0
    || otherActiveWork !== 0
    || activeLocks !== 0
    || workStatus !== 'terminal'
    || syncStatus !== 'failed'
    || syncErrorCode !== 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED') {
    throw completionError(
      'WooCommerce 2026 cleanup post-state is incomplete',
      'WOOCOMMERCE_2026_COMPLETION_CLEANUP_POSTSTATE_INVALID',
      {
        oldRows,
        aggregateRows,
        activeWork,
        replacedActiveWork,
        otherActiveWork,
        activeLocks,
        workStatus,
        syncStatus,
        syncErrorCode,
      },
    );
  }

  return Object.freeze({
    oldRows: 0,
    aggregateRows: 0,
    activeWork: 0,
    activeLocks: 0,
    exactReplacedOperationClosed: true,
  });
}

export function validateWooCommerce2026FinalSummary(value = {}, expectedHead) {
  const repositoryHead = requireWooCommerce2026CompletionHead(expectedHead);
  const history = value.orderHistoryWindow ?? {};
  if (value.accepted !== true
    || value.repositoryHead !== repositoryHead
    || value.parityVerified !== true
    || value.idempotentRerunVerified !== true
    || value.incrementalVerified !== true
    || value.executionFlagsAllFalse !== true
    || value.scheduleEnabled !== false
    || value.production !== false
    || value.nextStep !== 'none_for_integration_workspace_woocommerce'
    || history.start !== WOOCOMMERCE_2026_HISTORY_START
    || history.scopeMode !== 'report_range'
    || typeof value.fullReconciliation?.operationId !== 'string'
    || !/^woo-final-full-[0-9a-f]{12}$/u.test(value.fullReconciliation.operationId)) {
    throw completionError(
      'WooCommerce Final summary does not satisfy the 2026 completion contract',
      'WOOCOMMERCE_2026_COMPLETION_FINAL_SUMMARY_INVALID',
      {
        repositoryHead: value.repositoryHead ?? null,
        accepted: value.accepted === true,
        parityVerified: value.parityVerified === true,
        idempotentRerunVerified: value.idempotentRerunVerified === true,
        incrementalVerified: value.incrementalVerified === true,
        executionFlagsAllFalse: value.executionFlagsAllFalse === true,
        scheduleEnabled: value.scheduleEnabled ?? null,
        production: value.production ?? null,
        historyStart: history.start ?? null,
        scopeMode: history.scopeMode ?? null,
      },
    );
  }
  return Object.freeze({
    operationId: value.fullReconciliation.operationId,
    repositoryHead,
    accepted: true,
    parityVerified: true,
    idempotentRerunVerified: true,
    incrementalVerified: true,
    executionFlagsAllFalse: true,
    scheduleEnabled: false,
  });
}

export function validateWooCommerce2026CompletionFinalRemote(row = {}) {
  const activeWork = integer(row.active_work, 'active_work');
  const activeLocks = integer(row.active_locks, 'active_locks');
  const activeQueueOperations = integer(
    row.active_queue_operations,
    'active_queue_operations',
  );
  if (activeWork !== 0 || activeLocks !== 0 || activeQueueOperations !== 0) {
    throw completionError(
      'WooCommerce completion left active reliability state',
      'WOOCOMMERCE_2026_COMPLETION_FINAL_REMOTE_ACTIVE',
      { activeWork, activeLocks, activeQueueOperations },
    );
  }
  return Object.freeze({ activeWork, activeLocks, activeQueueOperations });
}

function sumFields(row, names) {
  return names.reduce((sum, name) => sum + integer(row[name], name), 0);
}

function integer(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw completionError(
    `WooCommerce completion field ${fieldName} must be a non-negative integer`,
    'WOOCOMMERCE_2026_COMPLETION_VALUE_INVALID',
    { fieldName },
  );
  return number;
}

function nullableText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw completionError(
    `WooCommerce completion requires ${fieldName}`,
    'WOOCOMMERCE_2026_COMPLETION_INPUT_REQUIRED',
    { fieldName },
  );
  return value.trim();
}

function booleanLike(value) {
  return value === true
    || value === 1
    || String(value ?? '').trim().toLowerCase() === 'true';
}

function completionError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerce2026CompletionError';
  error.code = code;
  error.details = details;
  return error;
}
