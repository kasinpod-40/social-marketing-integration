import {
  readLarkNumber,
  readLarkText,
} from '../../../connectors/src/shared/lark-cell-value.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const TIKTOK_REPORT_METRIC_KEYS = Object.freeze([
  'tiktok:period_views',
  'tiktok:period_likes',
  'tiktok:period_comments',
  'tiktok:period_shares',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
  'tiktok:new_content_count',
  'tiktok:tracked_content_count',
  'tiktok:baseline_coverage_rate',
  'tiktok:latest_total_views',
  'tiktok:latest_total_engagement',
  'tiktok:latest_weighted_avg_watch_time_seconds',
  'tiktok:latest_weighted_completion_rate',
]);

/** โหลด Metric definitions ที่ Report Engine ต้องใช้และยืนยันว่าครบ/ไม่ซ้ำ */
export async function loadTikTokReportMetricDefinitions(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const records = await repository.listByFieldValues(
    tableId,
    'metric_key',
    TIKTOK_REPORT_METRIC_KEYS,
  );
  const byKey = new Map();

  for (const record of records) {
    const definition = normalizeMetricDefinitionRecord(record);
    if (byKey.has(definition.metric_key)) {
      throw permanentError(`Duplicate metric definition: ${definition.metric_key}`, {
        code: 'REPORT_METRIC_DEFINITION_DUPLICATE',
        details: { metricKey: definition.metric_key },
      });
    }
    byKey.set(definition.metric_key, definition);
  }

  const missing = TIKTOK_REPORT_METRIC_KEYS.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw permanentError(`Missing TikTok report metric definitions: ${missing.join(', ')}`, {
      code: 'REPORT_METRIC_DEFINITION_MISSING',
      details: { missing },
    });
  }

  return Object.freeze(TIKTOK_REPORT_METRIC_KEYS.map((key) => {
    const definition = byKey.get(key);
    if (!definition.enabled) {
      throw permanentError(`Required report metric is disabled: ${key}`, {
        code: 'REPORT_METRIC_DEFINITION_DISABLED',
        details: { metricKey: key },
      });
    }
    if (definition.formula_version !== 'tiktok-organic-v1') {
      throw permanentError(`Unsupported formula version for ${key}: ${definition.formula_version}`, {
        code: 'REPORT_FORMULA_VERSION_MISMATCH',
        details: { metricKey: key, formulaVersion: definition.formula_version },
      });
    }
    return definition;
  }));
}

export function normalizeMetricDefinitionRecord(record) {
  const fields = record?.fields;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw permanentError('Metric definition record requires fields object', {
      code: 'REPORT_METRIC_DEFINITION_INVALID',
    });
  }

  return Object.freeze({
    metric_key: readLarkText(fields.metric_key, { allowNull: false, label: 'metric_key' }),
    platform: readLarkText(fields.platform, { allowNull: false, label: 'platform' }),
    display_name: readLarkText(fields.display_name, { allowNull: false, label: 'display_name' }),
    unit: readLarkText(fields.unit, { allowNull: false, label: 'unit' }),
    enabled: readCheckbox(fields.enabled, 'enabled'),
    client_visible: readCheckbox(fields.client_visible, 'client_visible'),
    sort_order: readLarkNumber(fields.sort_order, { allowNull: false, label: 'sort_order' }),
    formula_version: readLarkText(fields.formula_version, {
      allowNull: false,
      label: 'formula_version',
    }),
  });
}

function readCheckbox(value, fieldName) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = readLarkText(value, { allowNull: true, label: fieldName });
  if (text === null) return false;
  const normalized = text.trim().toLowerCase();
  if (['true', '1', 'yes', 'checked'].includes(normalized)) return true;
  if (['false', '0', 'no', 'unchecked'].includes(normalized)) return false;
  throw permanentError(`${fieldName} must be a checkbox value`, {
    code: 'REPORT_METRIC_DEFINITION_INVALID',
    details: { fieldName },
  });
}

function requireRepository(repository) {
  if (typeof repository?.listByFieldValues !== 'function') {
    throw new TypeError('loadTikTokReportMetricDefinitions requires repository.listByFieldValues');
  }
  return repository;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Metric definition loader requires ${fieldName}`);
  }
  return value.trim();
}
