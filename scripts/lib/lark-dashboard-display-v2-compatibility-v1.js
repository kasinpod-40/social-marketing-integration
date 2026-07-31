import {
  LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_VERSION,
  TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS,
  TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS,
  TIKTOK_ORGANIC_DASHBOARD_WINDOWS,
  isReviewedTikTokOrganicDashboardDisplayV2Alias,
  resolveTikTokOrganicDashboardDisplayV2ByMetricKey,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';
import {
  readWindowNumber,
  readWindowSelect,
} from './lark-dashboard-field-identity-recovery-v3.js';

export const LARK_DASHBOARD_DISPLAY_V2_BACKFILL_VERSION =
  LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_VERSION;

export const LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION =
  'BACKFILL_DISPLAY_V2_WITHOUT_DASHBOARD_FIELD_OR_VALUE_MUTATION';

export const EXPECTED_REPORT_RECORD_COUNT = 86;
export const EXPECTED_DASHBOARD_RECORD_COUNT = 68;
export const EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT = 24;
export const EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT = 50;
export const EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT = 48;
export const EXPECTED_REVIEWED_ALIAS_CORRECTION_COUNT = 2;

const TARGET_REPORT_TYPE = 'dashboard_performance_report';
const TARGET_PLATFORM = 'tiktok';
const TARGET_CAPABILITY = 'organic';
const TARGET_PERIOD_KIND = 'rolling_days';
const TARGET_CUSTOMER_PROFILE = 'integration_workspace';
const TARGET_CUSTOMER_KEY = 'chemistry_k';
const TARGET_ACCOUNT_ID = 'chemistry_k';
const WINDOW_SET = new Set(TIKTOK_ORGANIC_DASHBOARD_WINDOWS);
const METRIC_KEY_SET = new Set(TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS);

export function assertLarkDashboardDisplayV2BackfillConfirmation(value) {
  if (value !== LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION) {
    throw compatibilityError(
      'Explicit confirmation of the bounded display v2 Record backfill is required',
      'LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION_REQUIRED',
      {
        envName: 'CONFIRM_LARK_DASHBOARD_DISPLAY_V2_BACKFILL',
        requiredValue: LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION,
        dashboardPatchCount: 0,
        fieldMutationCount: 0,
        currentValueMutationCount: 0,
        recordDeleteCount: 0,
        remoteMutationCount: 0,
      },
    );
  }
  return true;
}

export function assertLarkDashboardDisplayV2Options(field) {
  const options = Array.isArray(field?.property?.options) ? field.property.options : [];
  const optionNames = options
    .map((option) => normalizeText(option?.name))
    .filter(Boolean);
  const duplicates = optionNames.filter((name, index) => optionNames.indexOf(name) !== index);
  const missing = TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS
    .filter((name) => !optionNames.includes(name));
  if (duplicates.length > 0 || missing.length > 0) {
    throw compatibilityError(
      'Display v2 SingleSelect options do not contain the reviewed Dashboard labels exactly once',
      'LARK_DASHBOARD_DISPLAY_V2_OPTIONS_INVALID',
      {
        missingOptions: missing,
        duplicateOptions: [...new Set(duplicates)],
        observedOptionCount: optionNames.length,
      },
    );
  }
  return Object.freeze(optionNames);
}

export function planLarkDashboardDisplayV2Backfill(input = {}) {
  const records = requireArray(input.records, 'records');
  const fieldNames = normalizeFieldNames(input.fieldNames);
  const updates = [];
  const expectedByRecord = [];
  const conflicts = [];
  const matrix = new Map();
  let targetRecordCount = 0;
  let populatedDisplayV2Count = 0;
  let convergedDisplayV2Count = 0;
  let missingValueUpdateCount = 0;
  let reviewedAliasCorrectionCount = 0;
  let targetCurrentValueNullCount = 0;

  for (const record of [...records].sort(compareRecordId)) {
    const recordId = requireText(record?.recordId ?? record?.record_id, 'recordId');
    const fields = record?.fields ?? {};
    if (!isTargetScope(fields, fieldNames)) continue;

    targetRecordCount += 1;
    const metricKey = readText(fields[fieldNames.metricKey]);
    const windowDays = readWindowNumber(fields[fieldNames.numberWindow]);
    const preservedWindow = readWindowSelect(fields[fieldNames.preservedWindowSelect]);
    const currentDisplayV2 = readSingleSelect(fields[fieldNames.displaySelectV2]);
    const currentValue = readNumberOrNull(fields[fieldNames.currentValue]);
    if (currentValue === null) targetCurrentValueNullCount += 1;
    if (currentDisplayV2 !== null) populatedDisplayV2Count += 1;

    if (!METRIC_KEY_SET.has(metricKey)) {
      conflicts.push(Object.freeze({ recordId, reason: 'unexpected_dashboard_metric_key', metricKey }));
      continue;
    }
    if (!WINDOW_SET.has(windowDays)) {
      conflicts.push(Object.freeze({ recordId, reason: 'unexpected_dashboard_window', windowDays }));
      continue;
    }
    if (preservedWindow !== String(windowDays)) {
      conflicts.push(Object.freeze({
        recordId,
        reason: 'preserved_window_select_not_converged',
        windowDays,
        preservedWindow,
      }));
      continue;
    }

    const matrixKey = `${windowDays}:${metricKey}`;
    if (matrix.has(matrixKey)) {
      conflicts.push(Object.freeze({
        recordId,
        reason: 'duplicate_dashboard_metric_window',
        matrixKey,
        otherRecordId: matrix.get(matrixKey),
      }));
      continue;
    }
    matrix.set(matrixKey, recordId);

    const desiredDisplayV2 = requireText(
      resolveTikTokOrganicDashboardDisplayV2ByMetricKey(metricKey),
      'desiredDisplayV2',
    );
    expectedByRecord.push(Object.freeze({
      recordId,
      metricKey,
      windowDays,
      desiredDisplayV2,
    }));

    if (currentDisplayV2 === desiredDisplayV2) {
      convergedDisplayV2Count += 1;
      continue;
    }

    let reason = 'missing_display_v2';
    if (currentDisplayV2 === null) {
      missingValueUpdateCount += 1;
    } else if (isReviewedTikTokOrganicDashboardDisplayV2Alias({
      metricKey,
      value: currentDisplayV2,
    })) {
      reason = 'reviewed_alias_correction';
      reviewedAliasCorrectionCount += 1;
    } else {
      conflicts.push(Object.freeze({
        recordId,
        reason: 'unexpected_populated_display_v2',
        metricKey,
        windowDays,
        currentDisplayV2,
        desiredDisplayV2,
      }));
      continue;
    }

    updates.push(Object.freeze({
      recordId,
      fields: Object.freeze({
        [fieldNames.displaySelectV2]: desiredDisplayV2,
      }),
      reason,
      metricKey,
      windowDays,
      previousDisplayV2: currentDisplayV2,
      desiredDisplayV2,
    }));
  }

  for (const windowDays of TIKTOK_ORGANIC_DASHBOARD_WINDOWS) {
    for (const metricKey of TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS) {
      const matrixKey = `${windowDays}:${metricKey}`;
      if (!matrix.has(matrixKey)) {
        conflicts.push(Object.freeze({
          reason: 'missing_dashboard_metric_window',
          matrixKey,
          metricKey,
          windowDays,
        }));
      }
    }
  }

  return deepFreeze({
    recordCount: records.length,
    targetRecordCount,
    populatedDisplayV2Count,
    convergedDisplayV2Count,
    targetCurrentValueNullCount,
    missingValueUpdateCount,
    reviewedAliasCorrectionCount,
    pendingUpdateCount: updates.length,
    conflictCount: conflicts.length,
    updates,
    expectedByRecord,
    conflicts,
  });
}

function isTargetScope(fields, fieldNames) {
  return readText(fields[fieldNames.reportType]) === TARGET_REPORT_TYPE
    && readText(fields[fieldNames.platform]) === TARGET_PLATFORM
    && readText(fields[fieldNames.capability]) === TARGET_CAPABILITY
    && readText(fields[fieldNames.periodKind]) === TARGET_PERIOD_KIND
    && readText(fields[fieldNames.customerProfile]) === TARGET_CUSTOMER_PROFILE
    && readText(fields[fieldNames.customerKey]) === TARGET_CUSTOMER_KEY
    && readText(fields[fieldNames.accountId]) === TARGET_ACCOUNT_ID;
}

function normalizeFieldNames(value) {
  const names = value && typeof value === 'object' ? value : {};
  return Object.freeze(Object.fromEntries([
    'metricKey',
    'numberWindow',
    'preservedWindowSelect',
    'displaySelectV2',
    'currentValue',
    'reportType',
    'platform',
    'capability',
    'periodKind',
    'customerProfile',
    'customerKey',
    'accountId',
  ].map((key) => [key, requireText(names[key], `fieldNames.${key}`)])));
}

function readText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return readText(value[0]);
    return value.map(readText).filter(Boolean).join(',');
  }
  if (typeof value === 'object') {
    return readText(value.text ?? value.name ?? value.value ?? null);
  }
  const text = String(value).trim();
  return text || null;
}

function readSingleSelect(value) {
  const text = readText(value);
  return text || null;
}

function readNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length !== 1) throw new TypeError('Number cell must contain at most one value');
    return readNumberOrNull(value[0]);
  }
  if (typeof value === 'object') return readNumberOrNull(value.value ?? value.text ?? null);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Number cell must be finite or null');
  return number;
}

function compareRecordId(left, right) {
  return String(left?.recordId ?? left?.record_id ?? '')
    .localeCompare(String(right?.recordId ?? right?.record_id ?? ''));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw new TypeError(`Display v2 compatibility requires ${fieldName}`);
  return text;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Display v2 compatibility requires ${fieldName}`);
  return value;
}

function compatibilityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardDisplayV2CompatibilityError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
