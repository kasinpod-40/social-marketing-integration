import { REPORT_METRIC_FIELD_IDENTITIES } from './lark-dashboard-field-identity-recovery-v3.js';

export const EXECUTIVE_NUMBER_WINDOW_CHART_NAMES = Object.freeze([
  'Net Sales by Window',
  'Ad Spend by Window',
  'Organic Views by Window',
]);

export const EXECUTIVE_DASHBOARD_NAME = '📊 Executive Marketing Overview';

const EXECUTIVE_NUMBER_WINDOW_CHART_SET = new Set(EXECUTIVE_NUMBER_WINDOW_CHART_NAMES);
const WINDOW_PRESET_SET = new Set(['1', '3', '7', '30']);
const VALUE_KEYS = new Set([
  'value',
  'values',
  'default_value',
  'defaultValue',
  'selected_value',
  'selectedValue',
]);
const FIELD_TYPE_KEYS = new Set(['field_type', 'fieldType', 'originFieldType']);

export function assertReviewedNumberWindowChart(input = {}) {
  const dashboardName = requireText(input.dashboardName, 'dashboardName');
  const blockName = requireText(input.blockName, 'blockName');
  const blockType = requireText(input.blockType, 'blockType').toLowerCase();
  if (dashboardName !== EXECUTIVE_DASHBOARD_NAME
    || !EXECUTIVE_NUMBER_WINDOW_CHART_SET.has(blockName)
    || blockType !== 'column') {
    throw chartError(
      'Window chart is outside the reviewed Executive 3-column scope',
      'LARK_DASHBOARD_WINDOW_CHART_SCOPE_UNSUPPORTED',
      { dashboardName, blockName, blockType },
    );
  }
  return Object.freeze({ dashboardName, blockName, blockType });
}

export function rewriteNumberWindowChartToPreservedSelect(input = {}) {
  const identity = assertReviewedNumberWindowChart(input);
  const before = requireObject(input.dataConfig, 'dataConfig');
  const sourceName = REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.fieldName;
  const sourceId = REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.fieldId;
  const targetName = REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.legacyName;
  const targetId = REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.fieldId;
  const counters = { sourceName: 0, sourceId: 0, numericPreset: 0 };
  const after = rewriteNode(clone(before), {
    sourceName,
    sourceId,
    targetName,
    targetId,
    counters,
  });
  const sourceReferenceCount = counters.sourceName + counters.sourceId;
  if (sourceReferenceCount < 1) {
    throw chartError(
      'Reviewed Executive window chart does not reference the canonical Number window field',
      'LARK_DASHBOARD_WINDOW_CHART_SOURCE_REFERENCE_MISSING',
      { ...identity, sourceName, sourceId },
    );
  }
  if (containsExact(after, sourceName) || containsExact(after, sourceId)) {
    throw chartError(
      'Canonical Number window reference remains after chart rewrite',
      'LARK_DASHBOARD_WINDOW_CHART_SOURCE_REFERENCE_REMAINS',
      { ...identity, sourceName, sourceId },
    );
  }
  if (!containsExact(after, targetName) && !containsExact(after, targetId)) {
    throw chartError(
      'Preserved Select window reference is absent after chart rewrite',
      'LARK_DASHBOARD_WINDOW_CHART_TARGET_REFERENCE_MISSING',
      { ...identity, targetName, targetId },
    );
  }
  const changed = stableStringify(before) !== stableStringify(after);
  if (!changed) {
    throw chartError(
      'Reviewed Executive window chart rewrite produced no change',
      'LARK_DASHBOARD_WINDOW_CHART_REWRITE_EMPTY',
      identity,
    );
  }
  return deepFreeze({
    ...identity,
    changed,
    sourceReferenceCount,
    numericPresetConversionCount: counters.numericPreset,
    dataConfig: after,
    patch: changedTopLevelKeys(before, after),
  });
}

export function hasNumberWindowReference(value) {
  return containsExact(
    value,
    REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.fieldName,
  ) || containsExact(
    value,
    REPORT_METRIC_FIELD_IDENTITIES.canonicalWindowNumber.fieldId,
  );
}

export function hasPreservedWindowReference(value) {
  return containsExact(
    value,
    REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.legacyName,
  ) || containsExact(
    value,
    REPORT_METRIC_FIELD_IDENTITIES.preservedWindowSelect.fieldId,
  );
}

function rewriteNode(value, context, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteNode(item, context, parentKey));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (value.trim() === context.sourceName) {
        context.counters.sourceName += 1;
        return context.targetName;
      }
      if (value.trim() === context.sourceId) {
        context.counters.sourceId += 1;
        return context.targetId;
      }
    }
    if (VALUE_KEYS.has(parentKey)) {
      const preset = normalizePreset(value);
      if (preset !== null && typeof value !== 'string') {
        context.counters.numericPreset += 1;
        return preset;
      }
    }
    return value;
  }

  const output = {};
  const sourceObject = Object.values(value).some((nested) => (
    (typeof nested === 'string' && nested.trim() === context.sourceName)
    || (typeof nested === 'string' && nested.trim() === context.sourceId)
  ));
  for (const [key, nested] of Object.entries(value)) {
    if (sourceObject && FIELD_TYPE_KEYS.has(key) && Number(nested) === 2) {
      output[key] = 3;
      continue;
    }
    if (sourceObject && VALUE_KEYS.has(key)) {
      output[key] = rewritePresetValue(nested, context);
      continue;
    }
    output[key] = rewriteNode(nested, context, key);
  }
  return output;
}

function rewritePresetValue(value, context) {
  if (Array.isArray(value)) return value.map((item) => rewritePresetValue(item, context));
  const preset = normalizePreset(value);
  if (preset !== null) {
    if (typeof value !== 'string') context.counters.numericPreset += 1;
    return preset;
  }
  return rewriteNode(value, context, 'value');
}

function normalizePreset(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  return WINDOW_PRESET_SET.has(text) ? text : null;
}

function changedTopLevelKeys(before, after) {
  const patch = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (stableStringify(before[key]) !== stableStringify(after[key])) {
      patch[key] = clone(after[key]);
    }
  }
  return patch;
}

function containsExact(value, expected) {
  if (typeof value === 'string') return value.trim() === expected;
  if (Array.isArray(value)) return value.some((item) => containsExact(item, expected));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsExact(item, expected));
  }
  return false;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw chartError(
      `Window chart rebind requires ${fieldName}`,
      'LARK_DASHBOARD_WINDOW_CHART_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw chartError(
      `Window chart rebind requires ${fieldName}`,
      'LARK_DASHBOARD_WINDOW_CHART_VALUE_INVALID',
      { fieldName },
    );
  }
  return clone(value);
}

function chartError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardWindowChartRebindError';
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
