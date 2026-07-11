import { toEpochMilliseconds } from '../shared/date-time.js';
import { readLarkNumber, readLarkText, readLarkUrl } from '../shared/lark-cell-value.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { toFiniteNumber } from '../../../shared/src/number/strict-number.js';

const LARK_FIELD_TYPES = Object.freeze({
  TEXT: 1,
  NUMBER: 2,
  SINGLE_SELECT: 3,
  MULTI_SELECT: 4,
  DATE_TIME: 5,
  CHECKBOX: 7,
  URL: 15,
});

const OMIT_FIELD = Symbol('omit-field');

/**
 * Serialize แถว Domain ทั้งชุดตาม Schema จริงของ Lark ก่อนเริ่ม Write
 * หาก Field ไม่มีอยู่หรือชนิดข้อมูลผิด จะหยุดทั้งรอบโดยยังไม่ส่งคำขอเขียน
 */
export function serializeRowsForLark(rows, fields, context = {}) {
  const schema = buildSchemaIndex(fields);
  return requireArray(rows, 'rows').map((row, index) => serializeRowForLark(row, schema, {
    tableId: context.tableId,
    rowIndex: index,
    keyField: context.keyField,
  }));
}

/**
 * Serialize หนึ่งแถวและตัด Field ที่เป็น null/undefined/ข้อความว่างออกจาก Payload
 */
export function serializeRowForLark(row, schemaOrFields, context = {}) {
  const source = requireObject(row, 'row');
  const schema = schemaOrFields instanceof Map ? schemaOrFields : buildSchemaIndex(schemaOrFields);
  const output = {};

  for (const [fieldName, value] of Object.entries(source)) {
    const field = schema.get(fieldName);
    if (!field) {
      throw fieldError(context, fieldName, 'field does not exist in destination schema');
    }

    const serialized = serializeValue(value, field, { ...context, row: source });
    if (serialized !== OMIT_FIELD) output[fieldName] = serialized;
  }

  if (context.keyField) {
    if (!Object.hasOwn(output, context.keyField)) {
      throw fieldError({ ...context, row: source }, context.keyField, 'stable key is missing after serialization');
    }
    output[context.keyField] = requireText(output[context.keyField], context.keyField);
  }

  return Object.freeze(output);
}

/**
 * แปลง Record ที่อ่านกลับจาก Lark ให้มีรูปแบบเดียวกับ Payload ฝั่งเขียน
 * ช่วยป้องกัน Update ปลอมจาก URL/Rich text ที่ Lark คืนคนละ Shape กับตอนส่งเข้า
 */
export function normalizeExistingRecordsForComparison(records, fields, options = {}) {
  const schema = buildSchemaIndex(fields);
  const incomingFieldNames = new Set(requireArray(options.incomingFieldNames ?? [], 'incomingFieldNames'));

  return Object.freeze(requireArray(records, 'records').map((record, rowIndex) => {
    const sourceFields = requireObject(record?.fields ?? {}, 'record.fields');
    const normalizedFields = {};

    for (const fieldName of incomingFieldNames) {
      const field = schema.get(fieldName);
      if (!field) {
        throw fieldError({ tableId: options.tableId, rowIndex }, fieldName, 'field does not exist in destination schema');
      }

      const normalized = normalizeExistingValue(sourceFields[fieldName], field, {
        tableId: options.tableId,
        rowIndex,
      });
      if (normalized !== OMIT_FIELD) normalizedFields[fieldName] = normalized;
    }

    return Object.freeze({
      recordId: record?.recordId ?? record?.record_id ?? null,
      fields: Object.freeze(normalizedFields),
    });
  }));
}

/** สร้าง Index ของ Schema ด้วยชื่อ Field และตรวจชื่อซ้ำตั้งแต่ต้น */
export function buildSchemaIndex(fields) {
  const index = new Map();
  for (const field of requireArray(fields, 'fields')) {
    const fieldName = requireText(field?.fieldName ?? field?.field_name ?? field?.name, 'field name');
    const fieldType = Number(field?.type);
    if (!Number.isInteger(fieldType)) throw new Error(`Lark field ${fieldName} has invalid type`);
    if (index.has(fieldName)) throw new Error(`Lark schema contains duplicate field name: ${fieldName}`);
    index.set(fieldName, Object.freeze({
      fieldName,
      type: fieldType,
      property: field?.property ?? null,
    }));
  }
  return index;
}

/** เลือก Serializer ตามชนิด Field ของ Lark */
function serializeValue(value, field, context) {
  if (value === undefined || value === null || value === '') return OMIT_FIELD;

  switch (field.type) {
    case LARK_FIELD_TYPES.TEXT:
      return serializeText(value, field.fieldName, context);
    case LARK_FIELD_TYPES.NUMBER:
      return serializeNumber(value, field.fieldName, context);
    case LARK_FIELD_TYPES.SINGLE_SELECT:
      return serializeSingleSelect(value, field, context);
    case LARK_FIELD_TYPES.MULTI_SELECT:
      return serializeMultiSelect(value, field, context);
    case LARK_FIELD_TYPES.DATE_TIME:
      return serializeDateTime(value, field.fieldName, context);
    case LARK_FIELD_TYPES.CHECKBOX:
      return serializeCheckbox(value, field.fieldName, context);
    case LARK_FIELD_TYPES.URL:
      return serializeUrl(value, field.fieldName, context);
    default:
      throw fieldError(context, field.fieldName, `unsupported writable Lark field type ${field.type}`);
  }
}

/** Normalize ค่าที่อ่านจาก Lark ให้ตรงกับ Serializer ฝั่งเขียน */
function normalizeExistingValue(value, field, context) {
  if (value === undefined || value === null || value === '') return OMIT_FIELD;

  try {
    switch (field.type) {
      case LARK_FIELD_TYPES.TEXT: {
        const text = readLarkText(value, { allowNull: true, label: field.fieldName });
        return text === null ? OMIT_FIELD : text;
      }
      case LARK_FIELD_TYPES.NUMBER: {
        const number = readLarkNumber(value, { allowNull: true, label: field.fieldName });
        return number === null ? OMIT_FIELD : number;
      }
      case LARK_FIELD_TYPES.SINGLE_SELECT: {
        const text = readSelectText(value);
        return text === null ? OMIT_FIELD : text;
      }
      case LARK_FIELD_TYPES.MULTI_SELECT:
        return readSelectList(value);
      case LARK_FIELD_TYPES.DATE_TIME:
        return toEpochMilliseconds(value, { allowNull: true, label: `Lark field ${field.fieldName}` }) ?? OMIT_FIELD;
      case LARK_FIELD_TYPES.CHECKBOX:
        return readCheckbox(value, field.fieldName, context);
      case LARK_FIELD_TYPES.URL: {
        const rawLink = readLarkUrl(value, { allowNull: true, label: field.fieldName });
        if (rawLink === null) return OMIT_FIELD;
        // Canonicalize URL ฝั่งอ่านด้วยกฎเดียวกับฝั่งเขียน เช่นเติม / หลัง Domain
        // เพื่อไม่ให้ Diff มองว่า URL เดิมเปลี่ยนทุกครั้งเพียงเพราะรูปแบบ String ต่างกัน
        const link = validateHttpUrl(rawLink, field.fieldName, context);
        const existingText = readLarkText(value, { allowNull: true, label: field.fieldName });
        return Object.freeze({ link, text: optionalText(existingText) ?? link });
      }
      default:
        throw fieldError(context, field.fieldName, `unsupported comparable Lark field type ${field.type}`);
    }
  } catch (error) {
    if (error?.code === 'LARK_PREFLIGHT_FAILED') throw error;
    throw fieldError(context, field.fieldName, error instanceof Error ? error.message : 'invalid existing value');
  }
}

/** Serialize URL ให้เป็น {link,text} ตาม Contract ของ Lark */
function serializeUrl(value, fieldName, context) {
  if (isUrlPayload(value)) {
    const link = validateHttpUrl(value.link, fieldName, context);
    const text = optionalText(value.text) ?? link;
    return Object.freeze({ link, text });
  }

  const link = validateHttpUrl(value, fieldName, context);
  return Object.freeze({ link, text: link });
}

/** Serialize Number โดยไม่ยอมให้ NaN/Infinity หลุดเข้า Lark */
function serializeNumber(value, fieldName, context) {
  try {
    return toFiniteNumber(value, { label: `Lark field ${fieldName}` });
  } catch (error) {
    throw fieldError(context, fieldName, error instanceof Error ? error.message : 'expected a finite number');
  }
}

/** Serialize DateTime ทุก Shape ให้เป็น Epoch Milliseconds */
function serializeDateTime(value, fieldName, context) {
  try {
    return toEpochMilliseconds(value, { label: `Lark field ${fieldName}` });
  } catch (error) {
    throw fieldError(context, fieldName, error instanceof Error ? error.message : 'invalid date-time value');
  }
}

/** Serialize Checkbox แบบเข้มงวด ป้องกัน Boolean('false') กลายเป็น true */
function serializeCheckbox(value, fieldName, context) {
  return readCheckbox(value, fieldName, context);
}

/** Serialize Single Select และตรวจว่าค่ามีอยู่ใน Options จริง */
function serializeSingleSelect(value, field, context) {
  const text = serializeText(value, field.fieldName, context);
  validateSelectOption(text, field, context);
  return text;
}

/** Serialize Multi Select แบบเรียงลำดับเพื่อให้ Diff คงที่และไม่ Update เพราะลำดับอย่างเดียว */
function serializeMultiSelect(value, field, context) {
  if (!Array.isArray(value)) throw fieldError(context, field.fieldName, 'expected an array');
  const items = [...new Set(value.map((item) => serializeText(item, field.fieldName, context)))].sort();
  // Payload นี้ใช้ Partial update และ Field ว่างชนิดอื่นก็ถูก Omit เช่นกัน
  // จึง Omit [] เพื่อไม่ให้ Existing field ที่ว่างเกิด False update ทุกครั้งที่ Sync
  if (items.length === 0) return OMIT_FIELD;
  for (const item of items) validateSelectOption(item, field, context);
  return Object.freeze(items);
}

/** ตรวจ Select Option กับ Schema Live ของตารางปลายทาง */
function validateSelectOption(value, field, context) {
  const options = Array.isArray(field?.property?.options) ? field.property.options : [];
  if (options.length === 0) return;
  const allowed = new Set(options.map((option) => option?.name).filter((name) => typeof name === 'string'));
  if (!allowed.has(value)) {
    throw fieldError(
      context,
      field.fieldName,
      `value ${JSON.stringify(value)} is not configured in destination select options`,
    );
  }
}

/** Serialize Text โดยรองรับเฉพาะ Primitive ที่แปลงความหมายได้ชัดเจน */
function serializeText(value, fieldName, context) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw fieldError(context, fieldName, 'expected text-compatible value');
}

/** ตรวจ URL ว่าเป็น Absolute HTTP/HTTPS เท่านั้น */
function validateHttpUrl(value, fieldName, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw fieldError(context, fieldName, 'expected a non-empty URL');
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw fieldError(context, fieldName, 'expected an absolute http/https URL');
  }
}

/** อ่าน Checkbox จาก boolean/0/1/string ที่ชัดเจนเท่านั้น */
function readCheckbox(value, fieldName, context) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'checked'].includes(text)) return true;
    if (['false', '0', 'no', 'unchecked'].includes(text)) return false;
  }
  throw fieldError(context, fieldName, 'expected a boolean checkbox value');
}

/** อ่านค่า Select เดี่ยวจาก Shape ที่ Lark คืนกลับ */
function readSelectText(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length > 1) throw new TypeError('single select contains multiple values');
    return readSelectText(value[0]);
  }
  if (typeof value === 'string') return optionalText(value);
  if (value && typeof value === 'object') {
    return readSelectText(value.name ?? value.text ?? value.value ?? value.option ?? null);
  }
  return value === null || value === undefined ? null : optionalText(String(value));
}

/** อ่าน Multi Select และเรียงลำดับเพื่อใช้เปรียบเทียบแบบไม่สนลำดับ */
function readSelectList(value) {
  if (value === null || value === undefined || value === '') return Object.freeze([]);
  const source = Array.isArray(value) ? value : [value];
  const items = source.map(readSelectText).filter(Boolean);
  return Object.freeze([...new Set(items)].sort());
}

/** ตรวจว่า Object เป็น URL payload ฝั่งเขียนของ Lark */
function isUrlPayload(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.link === 'string';
}

/**
 * สร้าง Error พร้อม Table, Stable Key และ Field เพื่อให้แก้ปัญหาได้จาก Log เดียว
 */
function fieldError(context, fieldName, reason) {
  const identity = context?.keyField && context?.row?.[context.keyField]
    ? `${context.keyField}=${context.row[context.keyField]}`
    : Number.isInteger(context?.rowIndex) ? `row=${context.rowIndex}` : 'row=unknown';
  const table = context?.tableId ? `table=${context.tableId}` : 'table=unknown';

  return permanentError(
    `Lark preflight failed: ${table}, ${identity}, field=${fieldName}: ${reason}`,
    {
      code: 'LARK_PREFLIGHT_FAILED',
      details: { tableId: context?.tableId ?? null, fieldName, identity },
    },
  );
}

/** บังคับ Array */
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Lark field serializer requires array ${fieldName}`);
  return value;
}

/** บังคับ Plain Object */
function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Lark field serializer requires object ${fieldName}`);
  }
  return value;
}

/** บังคับข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Lark field serializer requires ${fieldName}`);
  }
  return value.trim();
}

/** อ่านข้อความ Optional และตัดช่องว่างหัวท้าย */
function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
