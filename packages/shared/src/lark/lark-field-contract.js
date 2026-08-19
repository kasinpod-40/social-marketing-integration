/**
 * Field types ที่ Lark OpenAPI กำหนดให้ property เป็น null/ไม่ส่ง property
 * อ้างอิง Field edit development guide และ Official SDK model.
 */
export const LARK_PROPERTYLESS_FIELD_TYPES = Object.freeze([1, 7, 13, 15, 17, 19]);
const PROPERTYLESS_TYPES = new Set(LARK_PROPERTYLESS_FIELD_TYPES);

const PROPERTY_KEY_ALIASES = Object.freeze({
  dateFormat: 'date_formatter',
  dateFormatter: 'date_formatter',
  autoFill: 'auto_fill',
  tableId: 'table_id',
  tableName: 'table_name',
  backFieldName: 'back_field_name',
  autoSerial: 'auto_serial',
  formulaExpression: 'formula_expression',
  allowedEditModes: 'allowed_edit_modes',
  rangeCustomize: 'range_customize',
  currencyCode: 'currency_code',
  filterInfo: 'filter_info',
});


const NUMBER_FORMATTER_ALIASES = Object.freeze({
  '#,##0': '1,000',
  '#,##0.00': '1,000.00',
  '#,##0.0000': '0.0000',
});

/**
 * แปลงรูปแบบ Number formatter จากรูปแบบ Spreadsheet/UI ให้เป็น enum ของ Lark OpenAPI
 * Lark ไม่รับ pattern เช่น #,##0 ใน Field Create/Update API
 */
export function normalizeLarkNumberFormatter(value) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return NUMBER_FORMATTER_ALIASES[normalized] ?? normalized;
}

const OFFICIAL_PROPERTY_KEYS = new Set([
  'options',
  'formatter',
  'date_formatter',
  'auto_fill',
  'multiple',
  'table_id',
  'table_name',
  'back_field_name',
  'auto_serial',
  'location',
  'formula_expression',
  'allowed_edit_modes',
  'min',
  'max',
  'range_customize',
  'currency_code',
  'rating',
  'type',
  'filter_info',
]);

/** คืน true เมื่อ Field type รองรับ property ใน OpenAPI */
export function larkFieldTypeAllowsProperty(type) {
  const number = Number(type);
  return Number.isInteger(number) && !PROPERTYLESS_TYPES.has(number);
}

/**
 * แปลง Property จาก API/UI aliases เป็นรูปแบบ OpenAPI canonical snake_case
 * และตัด UI-internal/unsupported keys เช่น optionsType, timeFormat, styleId, extractExternalUrl.
 */
export function normalizeLarkFieldProperty(type, property) {
  if (!larkFieldTypeAllowsProperty(type) || !isPlainObject(property)) return null;
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(property)) {
    const key = PROPERTY_KEY_ALIASES[rawKey] ?? rawKey;
    if (!OFFICIAL_PROPERTY_KEYS.has(key) || rawValue === undefined) continue;
    const normalizedValue = key === 'formatter'
      ? normalizeLarkNumberFormatter(rawValue)
      : rawValue;
    result[key] = structuredClone(normalizedValue);
  }
  return Object.keys(result).length > 0 ? Object.freeze(result) : null;
}

/** สร้าง Property request body ที่ปลอดภัยสำหรับ Lark Field Create/Update API */
export function serializeLarkFieldProperty(type, property) {
  const normalized = normalizeLarkFieldProperty(type, property);
  return normalized ? structuredClone(normalized) : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
