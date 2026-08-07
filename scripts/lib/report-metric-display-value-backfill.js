import {
  readLarkNumber,
  readLarkText,
} from '../../packages/connectors/src/shared/lark-cell-value.js';
import {
  isReportMetricMicrosCurrency,
  resolveReportMetricDisplayValue,
} from '../../packages/application/src/reports/report-metric-display-value.js';

export const REPORT_METRIC_DISPLAY_VALUE_BACKFILL_VERSION =
  'report_metric_display_value_backfill_v1';
export const REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION =
  'BACKFILL_REPORT_METRIC_DISPLAY_VALUE';

export function planReportMetricDisplayValueBackfill(input = {}) {
  const records = requireArray(input.records, 'records');
  const fields = Object.freeze({
    metricKey: requireText(input.fieldNames?.metricKey ?? 'metric_key', 'fieldNames.metricKey'),
    currentValue: requireText(input.fieldNames?.currentValue ?? 'current_value', 'fieldNames.currentValue'),
    displayValue: requireText(input.fieldNames?.displayValue ?? 'display_value', 'fieldNames.displayValue'),
    unit: requireText(input.fieldNames?.unit ?? 'unit', 'fieldNames.unit'),
  });
  const updates = [];
  let nullValueCount = 0;
  let microsCurrencyCount = 0;
  let convergedCount = 0;

  for (const record of records) {
    const recordId = requireText(record?.recordId, 'record.recordId');
    const metricKey = readLarkText(record?.fields?.[fields.metricKey], {
      allowNull: false,
      label: fields.metricKey,
    });
    const unit = readLarkText(record?.fields?.[fields.unit], {
      allowNull: false,
      label: fields.unit,
    });
    const currentValue = readLarkNumber(record?.fields?.[fields.currentValue], {
      allowNull: true,
      label: fields.currentValue,
    });
    const existingDisplayValue = readLarkNumber(record?.fields?.[fields.displayValue], {
      allowNull: true,
      label: fields.displayValue,
    });
    const desiredDisplayValue = resolveReportMetricDisplayValue({
      metricKey,
      unit,
      currentValue,
    });
    if (desiredDisplayValue === null) nullValueCount += 1;
    if (isReportMetricMicrosCurrency({ metricKey, unit })) microsCurrencyCount += 1;

    if (sameNullableNumber(existingDisplayValue, desiredDisplayValue)) {
      convergedCount += 1;
      continue;
    }
    updates.push(Object.freeze({
      recordId,
      metricKey,
      unit,
      currentValue,
      previousDisplayValue: existingDisplayValue,
      desiredDisplayValue,
      fields: Object.freeze({ [fields.displayValue]: desiredDisplayValue }),
    }));
  }

  return Object.freeze({
    recordCount: records.length,
    convergedCount,
    pendingUpdateCount: updates.length,
    nullValueCount,
    microsCurrencyCount,
    updates: Object.freeze(updates),
  });
}

export function assertReportMetricDisplayValueBackfillConfirmation(value) {
  if (value !== REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION) {
    const error = new Error('Explicit confirmation of Report Metric display-value backfill is required');
    error.name = 'ReportMetricDisplayValueBackfillError';
    error.code = 'REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION_REQUIRED';
    error.details = Object.freeze({
      envName: 'CONFIRM_REPORT_METRIC_DISPLAY_VALUE_BACKFILL',
      requiredValue: REPORT_METRIC_DISPLAY_VALUE_BACKFILL_CONFIRMATION,
    });
    throw error;
  }
  return true;
}

function sameNullableNumber(left, right) {
  if (left === null || right === null) return left === right;
  return Number(left) === Number(right);
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
