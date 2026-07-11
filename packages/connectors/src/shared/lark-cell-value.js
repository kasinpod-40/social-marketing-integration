import { toFiniteNumber } from '../../../shared/src/number/strict-number.js';

/**
 * อ่าน Text cell จาก Lark Bitable ที่อาจเป็น Primitive, Rich text array หรือ Select object
 * ไม่ใช้ String(object) จึงไม่มีทางสร้างค่า "[object Object]" เงียบ ๆ
 */
export function readLarkText(value, options = {}) {
  const allowNull = options.allowNull !== false;
  const separator = typeof options.separator === 'string' ? options.separator : '';
  const parts = collectTextParts(value);
  const text = parts.join(separator).trim();

  if (text !== '') return text;
  if (allowNull) return null;
  throw new TypeError(`${options.label ?? 'Lark text'} is required`);
}

/**
 * อ่าน URL cell จาก String, URL object หรือ Array ของ Lark
 * คืนเฉพาะ absolute http/https URL เพื่อให้ Payload ปลายทางผ่าน URL Field contract
 */
export function readLarkUrl(value, options = {}) {
  const allowNull = options.allowNull !== false;
  const candidate = findUrlCandidate(value);

  if (candidate === null) {
    if (allowNull) return null;
    throw new TypeError(`${options.label ?? 'Lark URL'} is required`);
  }

  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new TypeError(`${options.label ?? 'Lark URL'} must be an absolute http/https URL`);
  }
}

/**
 * อ่าน Number cell จาก Primitive หรือ Cell wrapper แบบหนึ่งค่า
 * ลบ comma คั่นหลักพันและปฏิเสธ Array หลายค่าเพื่อไม่เลือกค่าผิดโดยไม่แจ้งเตือน
 */
export function readLarkNumber(value, options = {}) {
  const allowNull = options.allowNull !== false;
  const primitive = unwrapSinglePrimitive(value);

  if (primitive === null || primitive === undefined || primitive === '') {
    if (allowNull) return null;
    throw new TypeError(`${options.label ?? 'Lark number'} is required`);
  }

  return toFiniteNumber(primitive, {
    label: options.label ?? 'Lark number',
    allowNull,
  });
}

/** เดิน Rich cell แบบ Recursive และเก็บเฉพาะค่าที่มีความหมายเป็นข้อความ */
function collectTextParts(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTextParts(item));

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value', 'option', 'label']) {
      const parts = collectTextParts(value[key]);
      if (parts.some((part) => String(part).trim() !== '')) return parts;
    }
    return [];
  }

  return [];
}

/** ค้นหา URL candidate ตัวแรกจาก String, Array หรือ URL object ของ Lark */
function findUrlCandidate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findUrlCandidate(item);
      if (candidate) return candidate;
    }
    return null;
  }

  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    for (const key of ['link', 'url', 'text']) {
      const candidate = findUrlCandidate(value[key]);
      if (candidate !== null) return candidate;
    }
    return null;
  }
  return null;
}

/** แกะ Number cell wrapper โดยยอมรับเพียงหนึ่งค่าที่ระบุแน่ชัด */
function unwrapSinglePrimitive(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length > 1) throw new TypeError('Lark number cell must contain a single value');
    return unwrapSinglePrimitive(value[0]);
  }

  if (value && typeof value === 'object') {
    for (const key of ['value', 'text']) {
      const candidate = unwrapSinglePrimitive(value[key]);
      if (candidate !== null && candidate !== undefined
        && (typeof candidate !== 'string' || candidate.trim() !== '')) return candidate;
    }
    return null;
  }
  return value;
}
