import { createMetaHistoryOperationId } from './meta-history-2026-finalizer.js';
import { collectEnabledMktFlags } from './woocommerce-2026-completion-one-command.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_PAID_LARK_CLOSEOUT_CONTRACT_VERSION = 'meta_paid_lark_closeout_v1';
export const META_PAID_LARK_CLOSEOUT_TARGETS = Object.freeze(['chemistry_k2', 'chemistry_k3']);
export const META_PAID_LARK_CLOSEOUT_TABLE_KEYS = Object.freeze([
  'mktAdsCreatives',
  'mktAdsDaily',
]);
export const META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS = Object.freeze([
  'mktAdsAccounts',
  'mktAdsCampaigns',
  'mktAdsAdGroups',
  'mktAdsAds',
]);
export const META_PAID_LARK_CLOSEOUT_PERIOD = Object.freeze({
  since: '2026-07-01',
  until: '2026-07-31',
});

export function createMetaPaidLarkCloseoutPlan(repositoryHead, createdAt = Date.now()) {
  const head = requireSha(repositoryHead, 'repositoryHead');
  const timestamp = Number(createdAt);
  if (!Number.isSafeInteger(timestamp) || timestamp < Date.UTC(2000, 0, 1)) {
    throw closeoutError('Meta paid closeout clock is invalid', 'META_PAID_LARK_CLOSEOUT_CLOCK_INVALID');
  }
  const operations = META_PAID_LARK_CLOSEOUT_TARGETS.map((target, index) => Object.freeze({
    target,
    periodStart: META_PAID_LARK_CLOSEOUT_PERIOD.since,
    periodEnd: META_PAID_LARK_CLOSEOUT_PERIOD.until,
    operationId: createMetaHistoryOperationId(target, META_PAID_LARK_CLOSEOUT_PERIOD, head),
    originalRequestedAt: new Date(timestamp + index).toISOString(),
    larkTableKeys: META_PAID_LARK_CLOSEOUT_TABLE_KEYS,
  }));
  return deepFreeze({
    contractVersion: META_PAID_LARK_CLOSEOUT_CONTRACT_VERSION,
    repositoryHead: head,
    createdAt: new Date(timestamp).toISOString(),
    operations,
    instagramMode: 'verify_only_no_queue_send',
    facebookMode: 'excluded_no_sync_no_queue_send',
    excludedLarkTableKeys: META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS,
    schedules: false,
    production: false,
  });
}

export function validateMetaPaidLarkCloseoutPlan(value, repositoryHead) {
  const expectedHead = requireSha(repositoryHead, 'repositoryHead');
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.contractVersion !== META_PAID_LARK_CLOSEOUT_CONTRACT_VERSION
    || value.repositoryHead !== expectedHead
    || value.instagramMode !== 'verify_only_no_queue_send'
    || value.facebookMode !== 'excluded_no_sync_no_queue_send'
    || value.schedules !== false
    || value.production !== false
    || !Array.isArray(value.operations)
    || value.operations.length !== META_PAID_LARK_CLOSEOUT_TARGETS.length) {
    throw closeoutError('Meta paid closeout plan is invalid', 'META_PAID_LARK_CLOSEOUT_PLAN_INVALID');
  }
  const createdAt = requireIso(value.createdAt, 'createdAt');
  const createdTimestamp = Date.parse(createdAt);
  const expected = createMetaPaidLarkCloseoutPlan(expectedHead, createdTimestamp);
  const observedRequestedAt = new Set();
  for (let index = 0; index < expected.operations.length; index += 1) {
    const observed = value.operations[index];
    const authority = expected.operations[index];
    for (const field of ['target', 'periodStart', 'periodEnd', 'operationId', 'originalRequestedAt']) {
      if (observed?.[field] !== authority[field]) {
        throw closeoutError(
          'Meta paid closeout operation differs from authority',
          'META_PAID_LARK_CLOSEOUT_PLAN_INVALID',
          { index, field },
        );
      }
    }
    const requestedAt = requireIso(
      observed.originalRequestedAt,
      `operations[${index}].originalRequestedAt`,
    );
    if (observedRequestedAt.has(requestedAt)) {
      throw closeoutError(
        'Meta paid closeout generations must be unique',
        'META_PAID_LARK_CLOSEOUT_PLAN_INVALID',
        { index, field: 'originalRequestedAt' },
      );
    }
    observedRequestedAt.add(requestedAt);
    if (JSON.stringify(observed.larkTableKeys) !== JSON.stringify(META_PAID_LARK_CLOSEOUT_TABLE_KEYS)) {
      throw closeoutError('Meta paid closeout Lark scope is invalid', 'META_PAID_LARK_CLOSEOUT_SCOPE_INVALID', { index });
    }
  }
  if (JSON.stringify(value.excludedLarkTableKeys) !== JSON.stringify(META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS)) {
    throw closeoutError('Meta paid closeout excluded scope is invalid', 'META_PAID_LARK_CLOSEOUT_SCOPE_INVALID');
  }
  return deepFreeze(structuredClone(value));
}

export function buildMetaPaidLarkEnvironment(base = {}, operation = {}) {
  const target = requireTarget(operation.target);
  const tableKeys = Array.isArray(operation.larkTableKeys) ? operation.larkTableKeys : [];
  if (JSON.stringify(tableKeys) !== JSON.stringify(META_PAID_LARK_CLOSEOUT_TABLE_KEYS)) {
    throw closeoutError('Meta paid closeout Lark table scope is invalid', 'META_PAID_LARK_CLOSEOUT_SCOPE_INVALID');
  }
  return Object.freeze({
    ...base,
    MKT_META_LARK_TARGET: target,
    MKT_META_LARK_OPERATION_ID: requireText(operation.operationId, 'operation.operationId'),
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: requireIso(operation.originalRequestedAt, 'operation.originalRequestedAt'),
    MKT_META_LARK_PERIOD_START: requireDate(operation.periodStart, 'operation.periodStart'),
    MKT_META_LARK_PERIOD_END: requireDate(operation.periodEnd, 'operation.periodEnd'),
    MKT_META_LARK_TABLE_KEYS: META_PAID_LARK_CLOSEOUT_TABLE_KEYS.join(','),
  });
}

export function validateMetaPaidLarkRemoteFlagState(versionView = {}, options = {}) {
  const enabledFlags = collectEnabledMktFlags(versionView);
  const allowExistingRuntimeFlags = options.allowExistingRuntimeFlags === true;
  if (!allowExistingRuntimeFlags && enabledFlags.length !== 0) {
    throw closeoutError(
      'Paid Meta closeout requires an all-false Worker after the controlled baseline starts',
      'META_PAID_LARK_CLOSEOUT_REMOTE_FLAGS_ACTIVE',
      { enabledFlags },
    );
  }
  return deepFreeze({
    enabledFlags,
    allFalse: enabledFlags.length === 0,
    existingRuntimeAdmitted: allowExistingRuntimeFlags && enabledFlags.length !== 0,
  });
}

export function validateMetaPaidLarkReconciliation(value = {}, operation = {}) {
  const expectedKeys = META_PAID_LARK_CLOSEOUT_TABLE_KEYS;
  const results = value?.data?.comparison?.larkResults
    ?? value?.data?.snapshotAfter?.larkResults
    ?? value?.larkResults
    ?? [];
  const keys = Array.isArray(results) ? results.map((entry) => entry?.tableKey ?? null) : [];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || results.some((entry) => Number(entry?.expected ?? 0)
      !== Number(entry?.created ?? 0) + Number(entry?.updated ?? 0) + Number(entry?.skipped ?? 0))) {
    throw closeoutError('Meta paid Lark reconciliation is not exact', 'META_PAID_LARK_CLOSEOUT_RECONCILIATION_INVALID', {
      target: operation.target ?? null,
      observedTableKeys: keys,
    });
  }
  return deepFreeze({
    accepted: true,
    target: requireTarget(operation.target),
    operationId: requireText(operation.operationId, 'operation.operationId'),
    larkTableKeys: [...expectedKeys],
    excludedLarkTableKeys: [...META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS],
  });
}

function requireTarget(value) {
  const target = requireText(value, 'target');
  if (!META_PAID_LARK_CLOSEOUT_TARGETS.includes(target)) {
    throw closeoutError('Meta paid closeout target is invalid', 'META_PAID_LARK_CLOSEOUT_TARGET_INVALID', { target });
  }
  return target;
}

function requireSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) throw closeoutError(`${fieldName} must be a full SHA`, 'META_PAID_LARK_CLOSEOUT_INPUT_INVALID', { fieldName });
  return text;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw closeoutError(`${fieldName} must be YYYY-MM-DD`, 'META_PAID_LARK_CLOSEOUT_INPUT_INVALID', { fieldName });
  }
  return text;
}

function requireIso(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text) || Number.isNaN(Date.parse(text))) {
    throw closeoutError(`${fieldName} must be ISO UTC`, 'META_PAID_LARK_CLOSEOUT_INPUT_INVALID', { fieldName });
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw closeoutError(`${fieldName} is required`, 'META_PAID_LARK_CLOSEOUT_INPUT_INVALID', { fieldName });
  }
  return value.trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function closeoutError(message, code, details = {}) {
  return permanentError(message, { code, details });
}