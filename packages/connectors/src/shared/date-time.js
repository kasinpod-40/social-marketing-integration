const EPOCH_MILLISECONDS_THRESHOLD = 100_000_000_000;
const MIN_SUPPORTED_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_SUPPORTED_EPOCH_MS = Date.UTC(2100, 0, 1);

/**
 * Converts supported external date-time values into canonical epoch milliseconds.
 *
 * Accepted values:
 * - Date
 * - epoch seconds or epoch milliseconds (number)
 * - numeric epoch strings
 * - ISO-8601 strings with an explicit timezone (Z or ±HH:mm)
 *
 * Ambiguous timezone-less date strings are rejected so sync output does not
 * depend on the machine timezone.
 */
export function toEpochMilliseconds(value, options = {}) {
  const label = typeof options.label === 'string' && options.label.trim() !== ''
    ? options.label.trim()
    : 'date-time';
  const allowNull = options.allowNull === true;

  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw new TypeError(`${label} is required`);
  }

  let epochMs;

  if (value instanceof Date) {
    epochMs = value.getTime();
  } else if (typeof value === 'number') {
    epochMs = normalizeEpochNumber(value, label);
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') {
      if (allowNull) return null;
      throw new TypeError(`${label} is required`);
    }

    if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
      epochMs = normalizeEpochNumber(Number(text), label);
    } else {
      if (!hasExplicitTimezone(text)) {
        throw new TypeError(`${label} must include an explicit timezone`);
      }
      epochMs = Date.parse(text);
    }
  } else {
    throw new TypeError(`${label} must be a Date, epoch number, numeric epoch string, or ISO-8601 string`);
  }

  if (!Number.isFinite(epochMs)) {
    throw new TypeError(`${label} is not a valid date-time`);
  }

  const rounded = Math.trunc(epochMs);
  if (rounded < MIN_SUPPORTED_EPOCH_MS || rounded > MAX_SUPPORTED_EPOCH_MS) {
    throw new RangeError(`${label} is outside the supported range 2000-2100`);
  }

  return rounded;
}

function normalizeEpochNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return Math.abs(value) < EPOCH_MILLISECONDS_THRESHOLD ? value * 1000 : value;
}

function hasExplicitTimezone(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}
