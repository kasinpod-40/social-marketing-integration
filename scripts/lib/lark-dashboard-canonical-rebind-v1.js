export const LARK_DASHBOARD_CANONICAL_REBIND_VERSION =
  'lark_dashboard_canonical_rebind_v1';

export const REPORT_METRIC_TABLE_NAME = '📊 MKT_Report_Metric_Values';
export const ORGANIC_DASHBOARD_NAME = '🌱 Organic Performance';

export const CANONICAL_REPORT_FIELD_NAMES = Object.freeze({
  metricKey: 'metric_key',
  displayName: 'display_name',
  windowDays: 'window_days',
  currentValue: 'current_value',
});

export const LEGACY_REPORT_FIELD_NAMES = Object.freeze([
  '__mkt_legacy_display_name_single_select_v1',
  '__mkt_legacy_display_name_single_select_v2',
  '__mkt_legacy_window_days_single_select_v1',
  '__mkt_legacy_window_days_single_select_v2',
]);

export const LEGACY_DISPLAY_FIELD_NAMES = Object.freeze(
  LEGACY_REPORT_FIELD_NAMES.filter((name) => name.includes('display_name')),
);
export const LEGACY_WINDOW_FIELD_NAMES = Object.freeze(
  LEGACY_REPORT_FIELD_NAMES.filter((name) => name.includes('window_days')),
);

export const ORGANIC_METRIC_BINDINGS = deepFreeze({
  'Period Engagement': 'tiktok:period_engagement',
  'Baseline Coverage Rate': 'tiktok:baseline_coverage_rate',
  'Tracked Content': 'tiktok:tracked_content_count',
  'Current Engagement Rate': 'tiktok:latest_engagement_rate',
  'Period Likes': 'tiktok:period_likes',
  'Baseline Missing Content': 'tiktok:baseline_missing_content_count',
  'Period Comments': 'tiktok:period_comments',
  'New Content': 'tiktok:new_content_count',
  'Total Engagement': 'tiktok:latest_total_engagement',
  'Total Views': 'tiktok:latest_total_views',
  'Period Shares': 'tiktok:period_shares',
  'Period Engagement Rate': 'tiktok:period_engagement_rate',
  'Baseline Covered Content': 'tiktok:baseline_covered_content_count',
  'Period Views': 'tiktok:period_views',
  'Total Shares': 'tiktok:latest_total_shares',
  'Total Likes': 'tiktok:latest_total_likes',
  'Total Comments': 'tiktok:latest_total_comments',
});

export const ORGANIC_PERIOD_METRIC_KEYS = Object.freeze([
  'tiktok:period_views',
  'tiktok:period_likes',
  'tiktok:period_comments',
  'tiktok:period_shares',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
]);

const LEGACY_FIELD_NAME_SET = new Set(LEGACY_REPORT_FIELD_NAMES);
const LEGACY_DISPLAY_FIELD_NAME_SET = new Set(LEGACY_DISPLAY_FIELD_NAMES);
const LEGACY_WINDOW_FIELD_NAME_SET = new Set(LEGACY_WINDOW_FIELD_NAMES);
const WINDOW_VALUES = new Set(['1', '3', '7', '30']);
const VALUE_KEYS = new Set([
  'value', 'values', 'default_value', 'defaultValue', 'selected_value', 'selectedValue',
]);
const VALUELESS_FILTER_OPERATORS = new Set(['isEmpty', 'isNotEmpty']);
const FILTER_REQUEST_KEYS = new Set(['conjunction', 'conditions']);
const FILTER_CONDITION_REQUEST_KEYS = new Set([
  'field_name', 'fieldName', 'operator', 'value',
]);

/**
 * เปลี่ยนเฉพาะ data_config ของ Block เดิม โดยรักษา Block ID, Chart type และ Layout ไว้
 * - KPI ของ Organic ใช้ metric_key เป็น Stable binding
 * - ทุก Dashboard ใช้ window_days Number แทน Legacy Select
 * - Filter PATCH ส่งเฉพาะ Request fields; ห้ามสะท้อน response metadata กลับเข้า API
 */
export function rewriteDashboardBlockDataConfig(input = {}) {
  const dashboardName = requireText(input.dashboardName, 'dashboardName');
  const blockName = requireText(input.blockName, 'blockName');
  const before = normalizeDataConfig(input.dataConfig);
  const metricKey = dashboardName === ORGANIC_DASHBOARD_NAME
    ? ORGANIC_METRIC_BINDINGS[blockName] ?? null
    : null;
  const legacyReferencesBefore = collectLegacyFieldReferences(before);
  const filterResponseMetadataRemovalCount = metricKey
    ? countFilterResponseMetadata(before.filter)
    : 0;
  let after = clone(before);

  if (metricKey) after = bindOrganicMetric(after, metricKey);
  if (legacyReferencesBefore.some((name) => LEGACY_WINDOW_FIELD_NAME_SET.has(name))) {
    after = replaceLegacyWindowField(after);
  }

  const legacyReferencesAfter = collectLegacyFieldReferences(after);
  if (legacyReferencesAfter.length > 0) {
    throw contractError(
      'Dashboard Block still references Legacy Report fields after canonical rewrite',
      'LARK_DASHBOARD_CANONICAL_REBIND_LEGACY_REFERENCE_REMAINS',
      { dashboardName, blockName, legacyReferencesAfter },
    );
  }

  const changed = stableStringify(before) !== stableStringify(after);
  return deepFreeze({
    dashboardName,
    blockName,
    metricKey,
    changed,
    filterResponseMetadataRemovalCount,
    legacyReferencesBefore,
    legacyReferencesAfter,
    dataConfig: after,
    patch: changedTopLevelKeys(before, after),
  });
}

/**
 * แปลง Filter ที่อ่านจาก Dashboard response เป็นรูป Request contract เท่านั้น
 * โดยเก็บ Business conditions เดิม แต่ตัด condition_id, field_type และ metadata อื่นออก
 */
export function sanitizeDashboardFilterForMutation(value) {
  const source = value === null || value === undefined
    ? { conjunction: 'and', conditions: [] }
    : requireObject(value, 'filter');
  const conjunction = source.conjunction === 'or' ? 'or' : 'and';
  const conditions = requireArray(source.conditions ?? [], 'filter.conditions')
    .map((condition, index) => sanitizeDashboardFilterCondition(condition, index));
  return deepFreeze({ conjunction, conditions });
}

/** ตรวจว่า Organic KPI ครบ 17 ชื่อและไม่มีชื่อซ้ำ */
export function assertOrganicMetricBlockNames(blockNames) {
  const candidates = requireArray(blockNames, 'blockNames')
    .map((name) => requireText(name, 'blockName'))
    .filter((name) => Object.hasOwn(ORGANIC_METRIC_BINDINGS, name));
  const actual = [...new Set(candidates)].sort();
  const expected = Object.keys(ORGANIC_METRIC_BINDINGS).sort();
  const missing = expected.filter((name) => !actual.includes(name));
  const duplicateCount = candidates.length - actual.length;
  if (missing.length > 0 || duplicateCount !== 0 || actual.length !== expected.length) {
    throw contractError(
      'Organic Dashboard must contain the exact 17 canonical KPI Blocks',
      'LARK_DASHBOARD_CANONICAL_REBIND_ORGANIC_BLOCK_SET_INVALID',
      { expectedCount: expected.length, actualCount: actual.length, duplicateCount, missing },
    );
  }
  return deepFreeze({ expectedCount: expected.length, actualCount: actual.length });
}

export function assertCanonicalOrganicMetricBinding(input = {}) {
  const blockName = requireText(input.blockName, 'blockName');
  const expectedMetricKey = ORGANIC_METRIC_BINDINGS[blockName];
  if (!expectedMetricKey) return false;
  const config = normalizeDataConfig(input.dataConfig);
  const conditions = requireArray(config?.filter?.conditions ?? [], 'filter.conditions');
  const exact = conditions.filter((condition) => {
    const source = condition && typeof condition === 'object' ? condition : {};
    const fieldName = source.field_name ?? source.fieldName;
    return fieldName === CANONICAL_REPORT_FIELD_NAMES.metricKey
      && source.operator === 'is'
      && scalarEquals(source.value, expectedMetricKey);
  });
  if (exact.length !== 1) {
    throw contractError(
      'Organic KPI Block is not bound to its exact canonical metric_key',
      'LARK_DASHBOARD_CANONICAL_REBIND_METRIC_BINDING_INVALID',
      { blockName, expectedMetricKey, exactConditionCount: exact.length },
    );
  }
  return true;
}

export function collectLegacyFieldReferences(value) {
  const found = new Set();
  visit(value, (candidate) => {
    if (typeof candidate === 'string' && LEGACY_FIELD_NAME_SET.has(candidate.trim())) {
      found.add(candidate.trim());
    }
  });
  return Object.freeze([...found].sort());
}

export function hasComputedDashboardValue(protocol) {
  const data = normalizeProtocol(protocol);
  const measures = Array.isArray(data.measures) ? data.measures : [];
  const aliases = measures
    .map((measure) => measure?.alias)
    .filter((alias) => typeof alias === 'string' && alias !== '');
  const rows = Array.isArray(data.main_data) ? data.main_data : [];
  return rows.some((row) => aliases.some((alias) => {
    const value = row?.[alias]?.value ?? row?.[alias];
    return typeof value === 'number' && Number.isFinite(value);
  }));
}

export function hasDashboardProtocol(protocol) {
  const data = normalizeProtocol(protocol);
  return Array.isArray(data.main_data)
    && Array.isArray(data.measures)
    && Array.isArray(data.dimensions);
}

function bindOrganicMetric(config, metricKey) {
  const currentFilter = sanitizeDashboardFilterForMutation(config.filter);
  const retained = currentFilter.conditions.filter((condition) => {
    const fieldName = condition.field_name;
    return !LEGACY_DISPLAY_FIELD_NAME_SET.has(fieldName)
      && fieldName !== CANONICAL_REPORT_FIELD_NAMES.metricKey;
  });
  retained.push({
    field_name: CANONICAL_REPORT_FIELD_NAMES.metricKey,
    operator: 'is',
    value: metricKey,
  });
  return {
    ...config,
    filter: {
      conjunction: 'and',
      conditions: retained,
    },
  };
}

function sanitizeDashboardFilterCondition(condition, index) {
  const source = requireObject(condition, `filter.conditions[${index}]`);
  const fieldName = requireText(
    source.field_name ?? source.fieldName,
    `filter.conditions[${index}].field_name`,
  );
  const operator = requireText(source.operator, `filter.conditions[${index}].operator`);
  const result = { field_name: fieldName, operator };
  if (!VALUELESS_FILTER_OPERATORS.has(operator)) {
    if (source.value === undefined || source.value === null) {
      throw contractError(
        'Dashboard filter condition requires value for its operator',
        'LARK_DASHBOARD_CANONICAL_REBIND_FILTER_VALUE_REQUIRED',
        { index, fieldName, operator },
      );
    }
    result.value = clone(source.value);
  }
  return result;
}

function countFilterResponseMetadata(value) {
  if (value === null || value === undefined) return 0;
  const source = requireObject(value, 'filter');
  let count = Object.keys(source).filter((key) => !FILTER_REQUEST_KEYS.has(key)).length;
  const conditions = requireArray(source.conditions ?? [], 'filter.conditions');
  for (const condition of conditions) {
    const normalized = requireObject(condition, 'filter condition');
    count += Object.keys(normalized).filter(
      (key) => !FILTER_CONDITION_REQUEST_KEYS.has(key),
    ).length;
  }
  return count;
}

function replaceLegacyWindowField(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => replaceLegacyWindowField(item, parentKey));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && LEGACY_WINDOW_FIELD_NAME_SET.has(value.trim())) {
      return CANONICAL_REPORT_FIELD_NAMES.windowDays;
    }
    if (VALUE_KEYS.has(parentKey) && typeof value === 'string' && WINDOW_VALUES.has(value.trim())) {
      return Number(value.trim());
    }
    return value;
  }
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = replaceLegacyWindowField(nested, key);
  }
  return output;
}

function changedTopLevelKeys(before, after) {
  const patch = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (stableStringify(before[key]) !== stableStringify(after[key])) patch[key] = clone(after[key]);
  }
  return deepFreeze(patch);
}

function normalizeDataConfig(value) {
  if (typeof value === 'string') {
    try {
      return requireObject(JSON.parse(value), 'dataConfig');
    } catch (error) {
      throw contractError(
        'Dashboard Block data_config is not valid JSON',
        'LARK_DASHBOARD_CANONICAL_REBIND_DATA_CONFIG_INVALID',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }
  return clone(requireObject(value ?? {}, 'dataConfig'));
}

function normalizeProtocol(value) {
  return value?.data?.data ?? value?.data ?? value ?? {};
}

function scalarEquals(value, expected) {
  if (Array.isArray(value)) return value.length === 1 && scalarEquals(value[0], expected);
  return value === expected;
}

function visit(value, callback) {
  callback(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) visit(nested, callback);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
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
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardCanonicalRebindError';
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
