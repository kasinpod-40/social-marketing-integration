import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';

const SEVERITIES = new Set(['info', 'warning', 'critical']);
const STATUSES = new Set(['open', 'acknowledged', 'resolved']);

/** สร้าง Entity สำหรับ MKT_System_Alerts และ D1 operational alerts */
export function createSystemAlert(input = {}) {
  const severity = requireChoice(input.severity ?? 'warning', 'severity', SEVERITIES);
  const status = requireChoice(input.status ?? 'open', 'status', STATUSES);

  return Object.freeze({
    alertId: normalizeId(input.alertId),
    syncRunId: optionalText(input.syncRunId),
    alertType: requireText(input.alertType ?? 'sync_failure', 'alertType'),
    severity,
    platform: requireText(input.platform ?? 'system', 'platform').toLowerCase(),
    status,
    message: requireText(input.message, 'message'),
    errorCode: optionalUpperText(input.errorCode),
    createdAt: normalizeTimestamp(input.createdAt),
    details: freezeDetails(input.details),
  });
}

function normalizeId(value) {
  if (value === null || value === undefined || value === '') return crypto.randomUUID();
  return requireText(value, 'alertId');
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return Date.now();
  return toEpochMilliseconds(value, { label: 'System alert createdAt' });
}

function requireChoice(value, fieldName, allowed) {
  const text = requireText(value, fieldName);
  if (!allowed.has(text)) throw new TypeError(`System alert ${fieldName} is invalid: ${text}`);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`System alert requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'optionalText');
}

function optionalUpperText(value) {
  const text = optionalText(value);
  return text ? text.toUpperCase() : null;
}

function freezeDetails(value) {
  if (value === null || value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('System alert details must be an object');
  }
  return Object.freeze({ ...value });
}
