const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DEFAULT_MIN_YEAR = 2000;
const DEFAULT_MAX_YEAR = 2100;

/**
 * ตรวจและคืนค่าวันที่แบบ YYYY-MM-DD โดยยืนยันทั้งรูปแบบและวันที่จริง
 * เช่น 2026-02-30 หรือ 2026-99-99 จะถูกปฏิเสธ แม้ข้อความจะตรงรูปแบบก็ตาม
 *
 * @param {unknown} value ค่าวันที่ที่ต้องตรวจ
 * @param {Object} [options] ตัวเลือกการตรวจ
 * @param {string} [options.label] ชื่อฟิลด์ที่ใช้ในข้อความ Error
 * @param {number} [options.minYear] ปีต่ำสุดที่ระบบรองรับ
 * @param {number} [options.maxYear] ปีสูงสุดที่ระบบรองรับ
 * @returns {string} วันที่ที่ผ่านการตรวจในรูปแบบ YYYY-MM-DD
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

/**
 * คืนวันที่ปัจจุบันของ Timezone ที่กำหนดในรูปแบบ YYYY-MM-DD
 * ใช้ Intl แทนการบวกชั่วโมงเองเพื่อป้องกันความคลาดเคลื่อนจาก Timezone
 */
export function todayInTimeZone(timeZone, now = new Date()) {
  const normalizedTimeZone = requireText(timeZone, 'timeZone');
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError('now must be a valid Date-compatible value');
  }

  // ใช้ formatToParts แทนการพึ่งรูปแบบวันที่ของ Locale ซึ่งอาจคืน 07/11/2026 ในบาง Runtime
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/**
 * แปลงวันแบบ YYYY-MM-DD ให้เป็น Epoch Milliseconds ที่เวลาเที่ยงคืนตาม UTC offset
 * สำหรับประเทศไทยให้ส่ง offset +07:00 เพื่อให้ Lark DateTime แสดงวันที่ไม่เลื่อน
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
 * ตรวจ UTC offset แบบ ±HH:mm และจำกัดช่วงให้เป็นค่าที่มาตรฐานเวลาใช้งานได้
 */
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

/** อ่านขอบเขตปีโดยยอมรับเฉพาะจำนวนเต็ม */
function readBoundary(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`${fieldName} must be an integer`);
  return number;
}

/** ทำให้ชื่อฟิลด์ใน Error อ่านง่ายและไม่เป็นข้อความว่าง */
function normalizeLabel(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'date';
}

/** บังคับข้อความที่จำเป็นสำหรับ Timezone และ UTC offset */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }

  return value.trim();
}
