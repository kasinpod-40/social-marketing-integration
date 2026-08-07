const MICROS_PER_UNIT = 1_000_000;
const LARK_DISPLAY_DECIMALS = 4;
const LARK_DISPLAY_SCALE = 10 ** LARK_DISPLAY_DECIMALS;

/**
 * Derive a presentation-safe numeric value without changing canonical Business facts.
 * Monetary Report metrics remain integer micros in current_value; display_value is scaled
 * to account currency units for Lark Dashboard rendering. All display values are rounded only
 * at the dedicated four-decimal presentation precision; canonical current_value is untouched.
 */
export function resolveReportMetricDisplayValue(input = {}) {
  const metricKey = requireText(input.metricKey, 'metricKey');
  const unit = requireText(input.unit, 'unit');
  const currentValue = optionalFinite(input.currentValue);
  if (currentValue === null) return null;
  const displayValue = unit === 'currency' && metricKey.endsWith('_micros')
    ? currentValue / MICROS_PER_UNIT
    : currentValue;
  return roundToLarkDisplayPrecision(displayValue);
}

export function isReportMetricMicrosCurrency(input = {}) {
  const metricKey = requireText(input.metricKey, 'metricKey');
  const unit = requireText(input.unit, 'unit');
  return unit === 'currency' && metricKey.endsWith('_micros');
}

function roundToLarkDisplayPrecision(value) {
  return Math.round((value + Number.EPSILON) * LARK_DISPLAY_SCALE) / LARK_DISPLAY_SCALE;
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Report metric display value must be finite or null');
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
