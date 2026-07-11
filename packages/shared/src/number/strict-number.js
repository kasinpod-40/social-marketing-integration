const PLAIN_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const GROUPED_NUMBER_PATTERN = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

/**
 * แปลงค่าที่เป็น number หรือข้อความตัวเลขให้เป็น finite number แบบเข้มงวด
 * ไม่ยอมให้ boolean, ช่องว่างล้วน หรือ comma ที่จัดกลุ่มผิดกลายเป็นตัวเลขเงียบ ๆ
 */
export function toFiniteNumber(value, options = {}) {
  const label = normalizeLabel(options.label ?? 'number');
  const allowNull = options.allowNull === true;

  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new TypeError(`${label} is required`);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return value;
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a number or numeric string`);
  }

  const text = value.trim();
  if (text === '') {
    if (allowNull) return null;
    throw new TypeError(`${label} is required`);
  }

  const validPlain = PLAIN_NUMBER_PATTERN.test(text);
  const validGrouped = GROUPED_NUMBER_PATTERN.test(text);
  if (!validPlain && !validGrouped) {
    throw new TypeError(`${label} must be a valid numeric value`);
  }

  const numeric = Number(text.replace(/,/gu, ''));
  if (!Number.isFinite(numeric)) throw new TypeError(`${label} must be finite`);
  return numeric;
}

function normalizeLabel(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'number';
}
