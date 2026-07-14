import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const LARK_REPORT_VIEW_VERSION = 'report-client-views-v1.4';

/**
 * Client View contract สำหรับตาราง Report output เท่านั้น
 * Installer จัดการชื่อ View ตอนสร้างและ PATCH เฉพาะ Filter แบบ body ขั้นต่ำ.
 * Hidden fields, Sort, Column width และ Role permissions ให้ตั้งใน Lark UI เพื่อเลี่ยง tenant-specific 1254001.
 */
export const LARK_REPORT_VIEWS = deepFreeze([
  {
    tableKey: 'mktReportMetricValues',
    envName: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
    views: [
      metricCombinedView(),
      metricView('daily', '📊 Daily Metrics', 'daily_organic_report'),
      metricView('weekly', '📈 Weekly Metrics', 'weekly_organic_report'),
    ],
  },
  {
    tableKey: 'mktReportTopContent',
    envName: 'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
    views: [
      topContentCombinedView(),
      topContentView('daily', '🏆 Daily Top Content', 'daily_organic_report'),
      topContentView('weekly', '🏅 Weekly Top Content', 'weekly_organic_report'),
    ],
  },
]);

const VIEW_TYPES = new Set(['grid', 'kanban', 'gallery', 'gantt', 'form']);
const FILTER_OPERATORS = new Set([
  'is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty',
  'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual',
]);

export function validateReportViewDefinition(contract = LARK_REPORT_VIEWS) {
  if (!Array.isArray(contract) || contract.length === 0) {
    throw permanentError('Report client view contract must contain tables', {
      code: 'LARK_REPORT_VIEW_CONTRACT_INVALID',
    });
  }

  const tableKeys = new Set();
  for (const table of contract) {
    const tableKey = requireText(table?.tableKey, 'tableKey');
    requireText(table?.envName, `${tableKey}.envName`);
    if (tableKeys.has(tableKey)) invalid(`Duplicate report view tableKey: ${tableKey}`);
    tableKeys.add(tableKey);
    if (!Array.isArray(table.views) || table.views.length === 0) {
      invalid(`Report view table ${tableKey} requires views`);
    }

    const names = new Set();
    for (const view of table.views) {
      requireText(view?.key, `${tableKey}.view.key`);
      const name = requireText(view?.name, `${tableKey}.view.name`);
      if (names.has(normalizeName(name))) invalid(`Duplicate report view name: ${name}`);
      names.add(normalizeName(name));
      if (!VIEW_TYPES.has(requireText(view?.type, `${name}.type`))) {
        invalid(`Unsupported report view type: ${view.type}`);
      }
      for (const field of view.hiddenFields ?? []) requireText(field, `${name}.hiddenFields`);
      const filter = view.filterInfo;
      if (!filter || !Array.isArray(filter.conditions) || filter.conditions.length === 0) {
        invalid(`Report view ${name} requires filter conditions`);
      }
      if (!new Set(['and', 'or']).has(filter.conjunction)) invalid(`Invalid conjunction in ${name}`);
      for (const condition of filter.conditions) {
        requireText(condition?.fieldName, `${name}.filter.fieldName`);
        if (!FILTER_OPERATORS.has(requireText(condition?.operator, `${name}.filter.operator`))) {
          invalid(`Unsupported filter operator in ${name}: ${condition.operator}`);
        }
      }
    }
  }
  return true;
}


function metricCombinedView() {
  return {
    key: 'allClientMetrics',
    name: '📊 Client Metrics',
    type: 'grid',
    hiddenFields: metricHiddenFields(),
    filterInfo: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'client_visible', operator: 'is', value: 'true' },
      ],
    },
    manualSort: { fieldName: 'rank', direction: 'ascending' },
  };
}

function topContentCombinedView() {
  return {
    key: 'allTopContent',
    name: '🏆 Top Content',
    type: 'grid',
    hiddenFields: topContentHiddenFields(),
    filterInfo: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'data_status', operator: 'isNot', value: 'no_data' },
      ],
    },
    manualSort: { fieldName: 'rank', direction: 'ascending' },
  };
}

function metricView(key, name, reportType) {
  return {
    key: `${key}Metrics`,
    name,
    type: 'grid',
    hiddenFields: metricHiddenFields(),
    filterInfo: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'report_type', operator: 'is', value: reportType },
        { fieldName: 'client_visible', operator: 'is', value: 'true' },
      ],
    },
    manualSort: { fieldName: 'rank', direction: 'ascending' },
  };
}

function topContentView(key, name, reportType) {
  return {
    key: `${key}TopContent`,
    name,
    type: 'grid',
    hiddenFields: topContentHiddenFields(),
    filterInfo: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'report_type', operator: 'is', value: reportType },
        { fieldName: 'data_status', operator: 'isNot', value: 'no_data' },
      ],
    },
    manualSort: { fieldName: 'rank', direction: 'ascending' },
  };
}


function metricHiddenFields() {
  return [
    'report_id',
    'report_setting_key',
    'customer_profile',
    'account_id',
    'metric_key',
    'dimension_type',
    'dimension_value',
    'formula_version',
    'source_snapshot_count',
    'client_visible',
  ];
}

function topContentHiddenFields() {
  return [
    'report_id',
    'report_setting_key',
    'customer_profile',
    'account_id',
    'content_key',
  ];
}

function invalid(message) {
  throw permanentError(message, { code: 'LARK_REPORT_VIEW_CONTRACT_INVALID' });
}

function normalizeName(value) {
  return requireText(value, 'name').normalize('NFKC').trim().toLowerCase();
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`Report view contract requires ${fieldName}`);
  }
  return value.trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

validateReportViewDefinition();
