export const LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION =
  'lark_dashboard_field_identity_recovery_v3_2';

export const LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_CONFIRMATION =
  'PRESERVE_SLICER_FIELD_ID_REBIND_STATISTICS_AND_REMOVE_LEGACY_FIELDS';

export const LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION =
  'I_ENABLED_BASE_BLOCK_FIELD_AND_RECORD_RECOVERY_SCOPES';

export const REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES = Object.freeze([
  'base:dashboard:read',
  'base:block:read',
  'base:block:update',
  'base:field:read',
  'base:field:update',
  'base:field:delete',
  'base:record:retrieve',
  'base:record:update',
]);

export const REPORT_METRIC_FIELD_IDENTITIES = Object.freeze({
  metricKey: Object.freeze({ fieldId: 'fldGvd3tw8', fieldName: 'metric_key', type: 1 }),
  displayName: Object.freeze({ fieldId: 'fldE4Nezjd', fieldName: 'display_name', type: 1 }),
  canonicalWindowNumber: Object.freeze({
    fieldId: 'fldbPCldTL',
    fieldName: 'window_days',
    type: 2,
    retiredName: '__mkt_retired_window_days_number_v3',
  }),
  preservedWindowSelect: Object.freeze({
    fieldId: 'fldMlTUP3Z',
    legacyName: '__mkt_legacy_window_days_single_select_v1',
    canonicalName: 'window_days',
    type: 3,
  }),
  windowSelectV2: Object.freeze({
    fieldId: 'fldraj0QP8',
    fieldName: '__mkt_legacy_window_days_single_select_v2',
    type: 3,
  }),
  displaySelectV1: Object.freeze({
    fieldId: 'fldZB452Z2',
    fieldName: '__mkt_legacy_display_name_single_select_v1',
    type: 3,
  }),
  displaySelectV2: Object.freeze({
    fieldId: 'fldHNUhCfl',
    fieldName: '__mkt_legacy_display_name_single_select_v2',
    type: 3,
  }),
});

export const DASHBOARD_WINDOW_DAY_OPTIONS = Object.freeze(['1', '3', '7', '30']);
const WINDOW_OPTION_SET = new Set(DASHBOARD_WINDOW_DAY_OPTIONS);
const SUPPORTED_ORGANIC_BLOCK_TYPES = new Set(['statistics']);

export function assertFieldIdentityScopeConfirmation(value) {
  if (value !== LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION) {
    throw recoveryError(
      'Explicit confirmation of the complete Lark field-identity recovery scope contract is required',
      'LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION_REQUIRED',
      {
        envName: 'CONFIRM_LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONTRACT',
        requiredScopes: REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES,
        remoteMutationCount: 0,
      },
    );
  }
  return true;
}

export function assertFieldIdentityRecoveryConfirmation(value) {
  if (value !== LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_CONFIRMATION) {
    throw recoveryError(
      'Explicit confirmation of Dashboard field-identity recovery is required',
      'LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_CONFIRMATION_REQUIRED',
      {
        envName: 'CONFIRM_LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY',
        remoteMutationCount: 0,
      },
    );
  }
  return true;
}

export function assertSupportedOrganicMetricBlockType(type, details = {}) {
  const normalized = normalizeText(type).toLowerCase();
  if (!SUPPORTED_ORGANIC_BLOCK_TYPES.has(normalized)) {
    throw recoveryError(
      'Organic metric block type is not supported by the reviewed API mutation contract',
      'LARK_DASHBOARD_FIELD_IDENTITY_BLOCK_TYPE_UNSUPPORTED',
      { ...details, blockType: normalized || null },
    );
  }
  return normalized;
}

/**
 * Build a lossless backfill into the slicer-bound SingleSelect field.
 * Number is authoritative while it exists; v2 may only agree, never override it.
 */
export function planPreservedWindowSelectBackfill(input = {}) {
  const records = requireArray(input.records, 'records');
  const numberFieldName = requireText(input.numberFieldName, 'numberFieldName');
  const preservedFieldName = requireText(input.preservedFieldName, 'preservedFieldName');
  const v2FieldName = requireText(input.v2FieldName, 'v2FieldName');
  const updates = [];
  const expectedByRecord = [];
  const conflicts = [];
  let populatedNumberCount = 0;
  let populatedPreservedCount = 0;
  let populatedV2Count = 0;

  for (const record of [...records].sort(compareRecordId)) {
    const recordId = requireText(record?.recordId ?? record?.record_id, 'recordId');
    const fields = record?.fields ?? {};
    const numberValue = readWindowNumber(fields[numberFieldName]);
    const preservedValue = readWindowSelect(fields[preservedFieldName]);
    const v2Value = readWindowSelect(fields[v2FieldName]);
    if (numberValue !== null) populatedNumberCount += 1;
    if (preservedValue !== null) populatedPreservedCount += 1;
    if (v2Value !== null) populatedV2Count += 1;

    const authoritative = numberValue === null ? null : String(numberValue);
    if (authoritative !== null && !WINDOW_OPTION_SET.has(authoritative)) {
      conflicts.push(Object.freeze({ recordId, reason: 'number_outside_dashboard_presets' }));
      continue;
    }
    if (preservedValue !== null && !WINDOW_OPTION_SET.has(preservedValue)) {
      conflicts.push(Object.freeze({ recordId, reason: 'preserved_select_outside_dashboard_presets' }));
      continue;
    }
    if (v2Value !== null && !WINDOW_OPTION_SET.has(v2Value)) {
      conflicts.push(Object.freeze({ recordId, reason: 'v2_select_outside_dashboard_presets' }));
      continue;
    }
    if (authoritative === null && (preservedValue !== null || v2Value !== null)) {
      conflicts.push(Object.freeze({ recordId, reason: 'legacy_value_without_canonical_number' }));
      continue;
    }
    if (authoritative !== null && preservedValue !== null && preservedValue !== authoritative) {
      conflicts.push(Object.freeze({ recordId, reason: 'preserved_select_disagrees_with_number' }));
      continue;
    }
    if (authoritative !== null && v2Value !== null && v2Value !== authoritative) {
      conflicts.push(Object.freeze({ recordId, reason: 'v2_select_disagrees_with_number' }));
      continue;
    }

    expectedByRecord.push(Object.freeze({ recordId, value: authoritative }));
    if (authoritative !== null && preservedValue === null) {
      updates.push(Object.freeze({
        recordId,
        fields: Object.freeze({ [preservedFieldName]: authoritative }),
      }));
    }
  }

  return deepFreeze({
    recordCount: records.length,
    populatedNumberCount,
    populatedPreservedCount,
    populatedV2Count,
    pendingUpdateCount: updates.length,
    conflictCount: conflicts.length,
    updates,
    expectedByRecord,
    conflicts,
  });
}

export function assertPreservedWindowSelectConverged(input = {}) {
  const plan = planPreservedWindowSelectBackfill(input);
  if (plan.conflictCount !== 0 || plan.pendingUpdateCount !== 0) {
    throw recoveryError(
      'Slicer-bound window field did not converge to the canonical Number values',
      'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_BACKFILL_NOT_CONVERGED',
      {
        conflictCount: plan.conflictCount,
        pendingUpdateCount: plan.pendingUpdateCount,
        conflicts: plan.conflicts,
      },
    );
  }
  return plan;
}

export function buildPreservedWindowSelectFieldMutation(field, fieldName = 'window_days') {
  const property = clone(field?.property ?? {});
  const options = Array.isArray(property.options) ? property.options : [];
  const optionNames = options.map((option) => normalizeText(option?.name)).filter(Boolean);
  if (optionNames.length !== DASHBOARD_WINDOW_DAY_OPTIONS.length
    || DASHBOARD_WINDOW_DAY_OPTIONS.some((name) => !optionNames.includes(name))) {
    throw recoveryError(
      'Slicer-bound window field options do not match 1/3/7/30',
      'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_OPTIONS_INVALID',
      { optionNames },
    );
  }
  return deepFreeze({
    fieldName: requireText(fieldName, 'fieldName'),
    type: 3,
    uiType: field?.uiType ?? field?.ui_type ?? 'SingleSelect',
    description: field?.description ?? '',
    property,
  });
}

export function buildRetiredNumberFieldMutation(field) {
  return deepFreeze({
    fieldName: REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.retiredName,
    type: 2,
    uiType: field?.uiType ?? field?.ui_type ?? 'Number',
    description: field?.description ?? '',
    property: clone(field?.property ?? {}),
  });
}

export function readWindowSelect(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length !== 1) throw new TypeError('window SingleSelect cell must contain at most one value');
    return readWindowSelect(value[0]);
  }
  if (typeof value === 'object') {
    return readWindowSelect(value.text ?? value.name ?? value.value ?? null);
  }
  const text = String(value).trim();
  return text || null;
}

export function readWindowNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length !== 1) throw new TypeError('window Number cell must contain at most one value');
    return readWindowNumber(value[0]);
  }
  if (typeof value === 'object') return readWindowNumber(value.value ?? value.text ?? null);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('window Number cell must be a positive integer');
  }
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
  if (!text) throw new TypeError(`Field-identity recovery requires ${fieldName}`);
  return text;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Field-identity recovery requires ${fieldName}`);
  return value;
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}
function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardFieldIdentityRecoveryError';
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
