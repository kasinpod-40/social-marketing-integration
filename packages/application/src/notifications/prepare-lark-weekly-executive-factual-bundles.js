import { resolveReportMetricDisplayValue } from '../reports/report-metric-display-value.js';

/**
 * Enrich collected Shared Report bundles with the existing presentation-safe display value.
 * Canonical `current_value` remains untouched; currency micros are scaled only for the message.
 */
export function prepareLarkWeeklyExecutiveFactualBundles(reportBundles = []) {
  if (!Array.isArray(reportBundles)) throw new TypeError('reportBundles must be an array');
  return Object.freeze(reportBundles.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError(`reportBundles[${index}] must be an object`);
    }
    const metricValues = Array.isArray(raw.metricValues) ? raw.metricValues : [];
    return deepFreeze({
      ...structuredClone(raw),
      metricValues: metricValues.map((metric, metricIndex) => {
        if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
          throw new TypeError(`reportBundles[${index}].metricValues[${metricIndex}] must be object`);
        }
        const metricKey = requireText(metric.metric_key ?? metric.metricKey, 'metricKey');
        const unit = requireText(metric.unit, 'unit');
        return {
          ...structuredClone(metric),
          displayValue: resolveReportMetricDisplayValue({
            metricKey,
            unit,
            currentValue: metric.current_value ?? metric.currentValue,
          }),
        };
      }),
    });
  }));
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
