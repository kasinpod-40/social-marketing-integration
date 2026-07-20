const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DEFAULT_MIN_YEAR = 2000;
const DEFAULT_MAX_YEAR = 2100;
const ZONED_SEARCH_WINDOW_MS = 36 * 60 * 60 * 1000;
const MAX_ZONED_DATE_CACHE_ENTRIES = 2_048;
const MAX_TIMEZONE_FORMATTERS = 128;
const zonedDateEpochCache = new Map();
const timezoneFormatterCache = new Map();

/**
 * ตรวจและคืนค่าวันที่แบบ YYYY-MM-DD โดยยืนยันทั้งรูปแบบและวันที่จริง
 * เช่น 2026-02-30 หรือ 2026-99-99 จะถูกปฏิเสธ แม้ข้อความจะตรงรูปแบบก็ตาม
 */
export function requireDateOnly(value, options = {}) {
  const label = normalizeLabel(options.label ?? 'date');
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be YYYY-MM-DD`);
  }

  const text = value.trim();
  const match = DATE_ONLY_PATTERN.exec(text);
  if (!match) {
    throw new TypeError(`${label} must be YYYY-MM-DD`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const minYear = readBoundary(options.minYear, DEFAULT_MIN_YEAR, 'minYear');
  const maxYear = readBoundary(options.maxYear, DEFAULT_MAX_YEAR, 'maxYear');

  if (minYear > maxYear) {
    throw new TypeError('date-only minYear cannot be greater than maxYear');
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const isRealDate = utcDate.getUTCFullYear() === year
    && utcDate.getUTCMonth() === month - 1
    && utcDate.getUTCDate() === day;

  if (!isRealDate || year < minYear || year > maxYear) {
    throw new RangeError(`${label} is not a valid calendar date between ${minYear}-${maxYear}`);
  }

  return text;
}

/** คืนวันที่ปัจจุบันของ Timezone ที่กำหนดในรูปแบบ YYYY-MM-DD */
export function todayInTimeZone(timeZone, now = new Date()) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError('now must be a valid Date-compatible value');
  }
  return formatDateInTimeZone(instant.getTime(), normalizedTimeZone);
}

/**
 * แปลงวันแบบ YYYY-MM-DD ให้เป็น Epoch Milliseconds ที่เวลาเที่ยงคืนตาม UTC offset
 * ใช้เฉพาะ Source contract ที่ให้ Fixed offset ชัดเจน; Source ที่ใช้ IANA timezone ให้ใช้
 * `dateOnlyInTimeZoneToEpochMilliseconds()` เพื่อรองรับ DST และการเปลี่ยน offset ตามวันจริง
 */
export function dateOnlyToEpochMilliseconds(value, options = {}) {
  const label = normalizeLabel(options.label ?? 'date');
  const date = requireDateOnly(value, { label });
  const offset = normalizeUtcOffset(options.utcOffset ?? '+07:00');
  const epochMs = Date.parse(`${date}T00:00:00${offset}`);

  if (!Number.isFinite(epochMs)) {
    throw new TypeError(`${label} could not be converted to epoch milliseconds`);
  }

  return epochMs;
}

/**
 * คืน Instant แรกของวันตาม IANA timezone โดยไม่เดา offset และรองรับ DST
 *
 * Binary search หา Instant แรกที่ Local date เท่ากับวันที่เป้าหมาย จึงรองรับเขตเวลาที่
 * เปลี่ยน offset ใกล้เที่ยงคืนหรือไม่มีเวลา 00:00 ในบางวันได้อย่าง deterministic
 */
export function dateOnlyInTimeZoneToEpochMilliseconds(value, options = {}) {
  const label = normalizeLabel(options.label ?? 'date');
  const date = requireDateOnly(value, { label });
  const timeZone = normalizeTimeZone(options.timeZone);
  const cacheKey = `${timeZone}\u0000${date}`;
  const cached = zonedDateEpochCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const match = DATE_ONLY_PATTERN.exec(date);
  const anchor = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let low = anchor - ZONED_SEARCH_WINDOW_MS;
  let high = anchor + ZONED_SEARCH_WINDOW_MS;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (formatDateInTimeZone(middle, timeZone) < date) low = middle + 1;
    else high = middle;
  }

  if (formatDateInTimeZone(low, timeZone) !== date) {
    throw new RangeError(`${label} could not be resolved in timezone ${timeZone}`);
  }

  setBoundedCache(zonedDateEpochCache, cacheKey, low, MAX_ZONED_DATE_CACHE_ENTRIES);
  return low;
}

/** ตรวจ UTC offset แบบ ±HH:mm */
function normalizeUtcOffset(value) {
  const text = requireText(value, 'utcOffset');
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(text);
  if (!match) throw new TypeError('utcOffset must be ±HH:mm');

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    throw new RangeError('utcOffset is outside the supported range');
  }

  return text;
}

function normalizeTimeZone(value) {
  const timeZone = requireText(value, 'timeZone');
  try {
    getDateFormatter(timeZone).format(new Date(0));
  } catch (cause) {
    throw new TypeError(`timeZone is invalid: ${timeZone}`, { cause });
  }
  return timeZone;
}

function formatDateInTimeZone(epochMs, timeZone) {
  const parts = getDateFormatter(timeZone).formatToParts(new Date(epochMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function getDateFormatter(timeZone) {
  if (!timezoneFormatterCache.has(timeZone)) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    setBoundedCache(timezoneFormatterCache, timeZone, formatter, MAX_TIMEZONE_FORMATTERS);
  }
  return timezoneFormatterCache.get(timeZone);
}

function setBoundedCache(cache, key, value, maximum) {
  if (!cache.has(key) && cache.size >= maximum) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, value);
}

/** อ่านขอบเขตปีโดยยอมรับเฉพาะจำนวนเต็ม */
function readBoundary(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`${fieldName} must be an integer`);
  return number;
}

function normalizeLabel(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'date';
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}
