import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';

const MAX_SOURCE_PAYLOAD_BYTES = 65_536;
const SENSITIVE_KEYS = new Set([
  'access_token',
  'app_secret',
  'appsecret_proof',
  'client_secret',
  'token',
]);

export function safeMetaSourceJson(value) {
  const serialized = JSON.stringify(sanitizeValue(value ?? null));
  if (new TextEncoder().encode(serialized).byteLength > MAX_SOURCE_PAYLOAD_BYTES) {
    throw new RangeError('Meta normalized source payload exceeds 65536 bytes');
  }
  return serialized;
}

export function requireMetaObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Meta normalization requires ${fieldName} object`);
  }
  return value;
}

export function requireMetaText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Meta normalization requires ${fieldName}`);
  }
  return value.trim();
}

export function optionalMetaText(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`Meta normalization ${fieldName} must be text`);
  }
  return String(value).trim() || null;
}

export function optionalMetaUrl(value, fieldName) {
  const text = optionalMetaText(value, fieldName);
  if (!text) return null;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError(`Meta normalization ${fieldName} must use HTTP(S)`);
  }
  return url.toString();
}

export function optionalMetaCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/u.test(text)) {
    throw new TypeError(`Meta normalization ${fieldName} must be a non-negative integer`);
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`Meta normalization ${fieldName} exceeds safe integer range`);
  }
  return number;
}

export function optionalMetaFiniteNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`Meta normalization ${fieldName} must be finite`);
  }
  return number;
}

export function requireMetaTimestamp(value, fieldName) {
  return toEpochMilliseconds(value, { label: `Meta ${fieldName}` });
}

export function optionalMetaTimestamp(value, fieldName) {
  return toEpochMilliseconds(value, {
    label: `Meta ${fieldName}`,
    allowNull: true,
  });
}

export function dateOnlyForMetaInstant(value, timeZone = 'Asia/Bangkok') {
  const epochMs = requireMetaTimestamp(value, 'metric instant');
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function normalizeMetaMetricValue(value, fieldName) {
  if (value === null || value === undefined) {
    return Object.freeze({ valueNumber: null, valueJson: null });
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const number = optionalMetaFiniteNumber(value, fieldName);
    return Object.freeze({ valueNumber: number, valueJson: null });
  }
  return Object.freeze({
    valueNumber: null,
    valueJson: safeMetaSourceJson(value),
  });
}

export function deepFreezeMeta(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreezeMeta(nested);
  return Object.freeze(value);
}

function sanitizeValue(value, key = null) {
  if (key && SENSITIVE_KEYS.has(key.toLowerCase())) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeUrl(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([nestedKey, nestedValue]) => [
      nestedKey,
      sanitizeValue(nestedValue, nestedKey),
    ]),
  );
}

function sanitizeUrl(value) {
  if (!/^https?:\/\//iu.test(value)) return value;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}
