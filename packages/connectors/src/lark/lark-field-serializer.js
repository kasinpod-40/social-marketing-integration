import { toEpochMilliseconds } from '../shared/date-time.js';

const LARK_FIELD_TYPES = Object.freeze({
  TEXT: 1,
  NUMBER: 2,
  SINGLE_SELECT: 3,
  MULTI_SELECT: 4,
  DATE_TIME: 5,
  CHECKBOX: 7,
  URL: 15,
});

/**
 * Converts normalized domain rows into Lark record field payloads using the
 * destination table schema. Unknown fields and invalid typed values fail
 * before any write request is made.
 */
export function serializeRowsForLark(rows, fields, context = {}) {
  const schema = buildSchemaIndex(fields);
  return requireArray(rows, 'rows').map((row, index) => serializeRowForLark(row, schema, {
    tableId: context.tableId,
    rowIndex: index,
    keyField: context.keyField,
  }));
}

export function serializeRowForLark(row, schemaOrFields, context = {}) {
  const source = requireObject(row, 'row');
  const schema = schemaOrFields instanceof Map ? schemaOrFields : buildSchemaIndex(schemaOrFields);
  const output = {};

  for (const [fieldName, value] of Object.entries(source)) {
    const field = schema.get(fieldName);
    if (!field) {
      throw fieldError(context, fieldName, `field does not exist in destination schema`);
    }

    const serialized = serializeValue(value, field, { ...context, row: source });
    if (serialized !== OMIT_FIELD) output[fieldName] = serialized;
  }

  return Object.freeze(output);
}

export function buildSchemaIndex(fields) {
  const index = new Map();
  for (const field of requireArray(fields, 'fields')) {
    const fieldName = requireText(field?.fieldName ?? field?.field_name ?? field?.name, 'field name');
    const fieldType = Number(field?.type);
    if (!Number.isInteger(fieldType)) throw new Error(`Lark field ${fieldName} has invalid type`);
    if (index.has(fieldName)) throw new Error(`Lark schema contains duplicate field name: ${fieldName}`);
    index.set(fieldName, Object.freeze({ fieldName, type: fieldType, property: field?.property ?? null }));
  }
  return index;
}

const OMIT_FIELD = Symbol('omit-field');

function serializeValue(value, field, context) {
  if (value === undefined || value === null || value === '') return OMIT_FIELD;

  switch (field.type) {
    case LARK_FIELD_TYPES.URL:
      return serializeUrl(value, field.fieldName, context);
    case LARK_FIELD_TYPES.NUMBER:
      return serializeNumber(value, field.fieldName, context);
    case LARK_FIELD_TYPES.DATE_TIME:
      return serializeDateTime(value, field.fieldName, context);
    case LARK_FIELD_TYPES.CHECKBOX:
      return Boolean(value);
    case LARK_FIELD_TYPES.MULTI_SELECT:
      return serializeMultiSelect(value, field.fieldName, context);
    case LARK_FIELD_TYPES.TEXT:
    case LARK_FIELD_TYPES.SINGLE_SELECT:
      return serializeText(value, field.fieldName, context);
    default:
      // Preserve already-structured values for field types not yet transformed
      // by the platform, while still preventing undefined values.
      return value;
  }
}

function serializeUrl(value, fieldName, context) {
  if (isUrlPayload(value)) {
    const link = validateHttpUrl(value.link, fieldName, context);
    const text = optionalText(value.text) ?? link;
    return Object.freeze({ link, text });
  }

  const link = validateHttpUrl(value, fieldName, context);
  return Object.freeze({ link, text: link });
}

function serializeNumber(value, fieldName, context) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw fieldError(context, fieldName, `expected a finite number`);
  return number;
}

function serializeDateTime(value, fieldName, context) {
  try {
    return toEpochMilliseconds(value, { label: `Lark field ${fieldName}` });
  } catch (error) {
    throw fieldError(context, fieldName, error instanceof Error ? error.message : 'invalid date-time value');
  }
}

function serializeMultiSelect(value, fieldName, context) {
  if (!Array.isArray(value)) throw fieldError(context, fieldName, `expected an array`);
  return value.map((item) => serializeText(item, fieldName, context));
}

function serializeText(value, fieldName, context) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw fieldError(context, fieldName, `expected text-compatible value`);
}

function validateHttpUrl(value, fieldName, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw fieldError(context, fieldName, `expected a non-empty URL`);
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw fieldError(context, fieldName, `expected an absolute http/https URL`);
  }
}

function isUrlPayload(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.link === 'string';
}

function fieldError(context, fieldName, reason) {
  const identity = context?.keyField && context?.row?.[context.keyField]
    ? `${context.keyField}=${context.row[context.keyField]}`
    : Number.isInteger(context?.rowIndex) ? `row=${context.rowIndex}` : 'row=unknown';
  const table = context?.tableId ? `table=${context.tableId}` : 'table=unknown';
  return new Error(`Lark preflight failed: ${table}, ${identity}, field=${fieldName}: ${reason}`);
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Lark field serializer requires array ${fieldName}`);
  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Lark field serializer requires object ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Lark field serializer requires ${fieldName}`);
  return value.trim();
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
