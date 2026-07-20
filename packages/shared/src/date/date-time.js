import { requireDateOnly } from './date-only.js';

const EPOCH_MILLISECONDS_THRESHOLD = 100_000_000_000;
const MIN_SUPPORTED_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_SUPPORTED_EPOCH_MS = Date.UTC(2101, 0, 1) - 1;
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/u;
const TIMEZONE_CONVERGENCE_ATTEMPTS = 6;

/**
 * แปลงวันที่/เวลาจากระบบภายนอกให้เป็น Epoch Milliseconds มาตรฐานเดียวของระบบ
 * รองรับ Date, epoch seconds/milliseconds, numeric string และ ISO-8601 ที่มี timezone ชัดเจน
 */
export function toEpochMilliseconds(value, options = {}) {
  const label = normalizeLabel(options.label ?? 'date-time');
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
    epochMs = parseDateTimeText(value, { label, allowNull });
  } else {
    throw new TypeError(`${label} must be a Date, epoch number, numeric epoch string, or ISO-8601 string`);
  }

  return validateEpochRange(epochMs, label);
}

/**
 * แปลงวันแบบ YYYY-MM-DD ให้เป็น Epoch Milliseconds ของเวลา 00:00:00 ใน IANA timezone ที่กำหนด
 * ใช้การ Converge จาก Calendar parts แทนการ Hardcode UTC offset เพื่อรองรับ DST และ Offset ที่เปลี่ยนตามวัน
 * หากวันนั้นไม่มี Local midnight จริง ฟังก์ชันจะ Fail closed แทนการเลื่อนวันโดยเงียบ ๆ
 */
export function dateOnlyInTimeZoneToEpochMilliseconds(value, timeZone, options = {}) {
  const label = normalizeLabel(options.label ?? 'date');
  const date = requireDateOnly(value, { label });
  const normalizedTimeZone = requireTimeZone(timeZone, `${label} timeZone`);
  const [year, month, day] = date.split('-').map(Number);
  const targetLocalAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = targetLocalAsUtc;

  for (let attempt = 0; attempt < TIMEZONE_CONVERGENCE_ATTEMPTS; attempt += 1) {
    const parts = readZonedDateTimeParts(candidate, normalizedTimeZone);
    const observedLocalAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = targetLocalAsUtc - observedLocalAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }

  const resolved = readZonedDateTimeParts(candidate, normalizedTimeZone);
  if (resolved.year !== year
    || resolved.month !== month
    || resolved.day !== day
    || resolved.hour !== 0
    || resolved.minute !== 0
    || resolved.second !== 0) {
    throw new RangeError(`${label} has no resolvable local midnight in ${normalizedTimeZone}`);
  }

  return validateEpochRange(candidate, label);
}

/** Compatibility wrapper ของ TikTok/DEV เดิม; Generic domain ต้องเรียกฟังก์ชัน IANA timezone โดยตรง */
export function bangkokDateToEpochMilliseconds(value, options = {}) {
  return dateOnlyInTimeZoneToEpochMilliseconds(value, 'Asia/Bangkok', {
    label: options.label ?? 'Bangkok date',
  });
}

/** อ่าน string โดยปฏิเสธ ISO ที่วันที่หรือเวลาเป็นไปไม่ได้แทนการให้ Date.parse ปรับวันอัตโนมัติ */
function parseDateTimeText(value, input) {
  const text = value.trim();
  if (text === '') {
    if (input.allowNull) return null;
    throw new TypeError(`${input.label} is required`);
  }

  if (/^[+-]?\d+(?:\.\d+)?$/u.test(text)) {
    return normalizeEpochNumber(Number(text), input.label);
  }

  const match = ISO_DATE_TIME_PATTERN.exec(text);
  if (!match) {
    throw new TypeError(`${input.label} must be a valid ISO-8601 date-time with an explicit timezone`);
  }

  const dateOnly = `${match[1]}-${match[2]}-${match[3]}`;
  requireDateOnly(dateOnly, { label: input.label });

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`${input.label} contains an invalid clock time`);
  }

  const timezone = normalizeTimezone(match[8], input.label);
  const fraction = normalizeFraction(match[7]);
  const normalizedIso = `${dateOnly}T${match[4]}:${match[5]}:${match[6]}${fraction}${timezone}`;
  const epochMs = Date.parse(normalizedIso);
  if (!Number.isFinite(epochMs)) {
    throw new TypeError(`${input.label} is not a valid date-time`);
  }
  return epochMs;
}

/** แยก Epoch seconds ออกจาก milliseconds ด้วย threshold ที่เหมาะกับช่วงปีที่ระบบรองรับ */
function normalizeEpochNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return Math.abs(value) < EPOCH_MILLISECONDS_THRESHOLD ? value * 1000 : value;
}

/** ตรวจ Epoch ให้เป็นจำนวนจริงและอยู่ในช่วงปี 2000-2100 */
function validateEpochRange(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} is not a valid date-time`);
  }

  const rounded = Math.trunc(value);
  if (rounded < MIN_SUPPORTED_EPOCH_MS || rounded > MAX_SUPPORTED_EPOCH_MS) {
    throw new RangeError(`${label} is outside the supported range 2000-2100`);
  }

  return rounded;
}

/** อ่าน Calendar parts ของ Instant ใน IANA timezone แบบไม่พึ่ง Locale date string */
function readZonedDateTimeParts(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Object.freeze({
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  });
}

/** ตรวจ IANA timezone โดยให้ Intl เป็นแหล่งความจริงของ Runtime */
function requireTimeZone(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  const timeZone = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch (cause) {
    throw new TypeError(`${label} must be a valid IANA timezone`, { cause });
  }
  return timeZone;
}

/** Normalize fractional seconds ให้เหลือความละเอียด milliseconds ที่ JavaScript รองรับ */
function normalizeFraction(value) {
  if (!value) return '';
  return `.${value.padEnd(3, '0').slice(0, 3)}`;
}

/** ตรวจ timezone offset และแปลง +0700 ให้เป็น +07:00 */
function normalizeTimezone(value, label) {
  if (/^Z$/iu.test(value)) return 'Z';
  const match = /^([+-])(\d{2}):?(\d{2})$/u.exec(value);
  if (!match) throw new TypeError(`${label} contains an invalid timezone offset`);

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    throw new RangeError(`${label} contains an unsupported timezone offset`);
  }
  return `${match[1]}${match[2]}:${match[3]}`;
}

function normalizeLabel(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'date-time';
}
