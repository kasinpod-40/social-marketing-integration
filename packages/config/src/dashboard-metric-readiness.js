export const DASHBOARD_METRIC_SCOPE_OPTIONS = Object.freeze([
  'period_delta',
  'current_total',
  'data_quality',
]);

export const DASHBOARD_METRIC_AVAILABILITY_OPTIONS = Object.freeze([
  'available',
  'baseline_incomplete',
  'source_unavailable',
  'not_observed',
]);

const METRIC_SCOPES = new Set(DASHBOARD_METRIC_SCOPE_OPTIONS);
const AVAILABILITY_STATUSES = new Set(DASHBOARD_METRIC_AVAILABILITY_OPTIONS);

const AVAILABILITY_MESSAGES = Object.freeze({
  available: 'พร้อมใช้งาน',
  baseline_incomplete: 'N/A — Baseline ยังไม่ครบ',
  source_unavailable: 'N/A — แหล่งข้อมูลยังไม่พร้อม',
  not_observed: 'N/A — ยังไม่มีข้อมูลสังเกตการณ์',
});

/** Normalize กลุ่ม Metric โดยไม่ผูกกับชื่อ Platform หรือ Metric key. */
export function normalizeDashboardMetricScope(value, fallback = 'period_delta') {
  const candidate = optionalText(value) ?? fallback;
  if (!METRIC_SCOPES.has(candidate)) {
    throw new TypeError(`Unsupported Dashboard metric scope: ${candidate}`);
  }
  return candidate;
}

/**
 * Normalize สถานะความพร้อมของ Metric.
 * Payload รุ่นเก่าที่ไม่มี metadata ยังแสดงค่าที่มีจริงเป็น available และ null เป็น not_observed.
 */
export function normalizeDashboardMetricAvailability(input = {}) {
  const explicit = optionalText(input.status);
  if (explicit !== null) {
    if (!AVAILABILITY_STATUSES.has(explicit)) {
      throw new TypeError(`Unsupported Dashboard metric availability: ${explicit}`);
    }
    return explicit;
  }
  if (input.currentValue !== null && input.currentValue !== undefined && input.currentValue !== '') {
    return 'available';
  }
  if (input.dataStatus === 'source_unavailable') return 'source_unavailable';
  return 'not_observed';
}

/** ข้อความสำหรับ Lark/UI ต้องไม่ว่าง เพื่อให้การเปลี่ยนสถานะเขียนทับข้อความเก่าได้เสมอ. */
export function dashboardMetricAvailabilityMessage(status) {
  const normalized = normalizeDashboardMetricAvailability({ status });
  return AVAILABILITY_MESSAGES[normalized];
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
