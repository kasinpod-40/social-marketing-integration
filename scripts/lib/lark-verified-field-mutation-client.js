import { createHash } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const DEFAULT_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);

/**
 * ครอบ Lark client เฉพาะ administrative field migration:
 * - update/create Field ส่ง write เพียงครั้งเดียว
 * - หลัง write ใช้ fresh bounded reads จน metadata และ Record field-name/value converge
 * - update ต้องรักษา field_id, property และค่าของทุก Record แบบ exact fingerprint
 * - create ต้องเห็น Field เป้าหมายเพียงหนึ่งรายการและตรง type
 */
export function createVerifiedFieldMutationClient(client, options = {}) {
  requireClient(client);
  const delaysMs = normalizeDelays(options.delaysMs ?? DEFAULT_DELAYS_MS);
  const sleep = typeof options.sleepImpl === 'function' ? options.sleepImpl : sleepMs;

  return new Proxy(client, {
    get(target, property) {
      if (property === 'updateField') {
        return async (input) => verifiedUpdateField(target, input, delaysMs, sleep);
      }
      if (property === 'createField') {
        return async (input) => verifiedCreateField(target, input, delaysMs, sleep);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function verifiedUpdateField(client, input, delaysMs, sleep) {
  const tableId = requireText(input?.tableId, 'tableId');
  const fieldId = requireText(input?.fieldId, 'fieldId');
  const expectedName = requireText(input?.field?.fieldName ?? input?.field?.field_name, 'fieldName');
  const expectedType = requireType(input?.field?.type, 'field.type');
  const beforeFields = await client.listFields({ tableId });
  const source = beforeFields.find((field) => field.fieldId === fieldId);
  if (!source || source.isPrimary === true) {
    throw verificationError(
      'Lark field update preflight could not resolve one non-primary source Field',
      'LARK_FIELD_MUTATION_SOURCE_INVALID',
      { operation: 'update', expectedName, expectedType },
    );
  }
  const beforeRecords = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const propertyFingerprint = fingerprint(source.property ?? null);
  const sourceValueFingerprint = recordValueFingerprint(beforeRecords, source.fieldName);

  const result = await client.updateField(input);
  const verifiedField = await pollFields({
    client,
    tableId,
    delaysMs,
    sleep,
    accept(fields) {
      const sameId = fields.find((field) => field.fieldId === fieldId);
      const sameName = fields.filter((field) => normalizeName(field.fieldName) === normalizeName(expectedName));
      if (!sameId || sameName.length !== 1 || sameName[0].fieldId !== fieldId) return null;
      if (normalizeName(sameId.fieldName) !== normalizeName(expectedName)
        || Number(sameId.type) !== expectedType
        || sameId.isPrimary === true
        || fingerprint(sameId.property ?? null) !== propertyFingerprint) return null;
      return sameId;
    },
  });
  if (!verifiedField) {
    throw verificationError(
      'Lark field update metadata did not converge after one write',
      'LARK_FIELD_MUTATION_UPDATE_VERIFY_FAILED',
      { operation: 'update', expectedName, expectedType, writeRetryCount: 0 },
    );
  }

  const verifiedRecords = await pollRecords({
    client,
    tableId,
    delaysMs,
    sleep,
    accept(records) {
      if (records.length !== beforeRecords.length) return false;
      return recordValueFingerprint(records, expectedName) === sourceValueFingerprint;
    },
  });
  if (!verifiedRecords) {
    throw verificationError(
      'Lark field rename Record values did not converge after one write',
      'LARK_FIELD_MUTATION_RECORD_VERIFY_FAILED',
      {
        operation: 'update',
        expectedName,
        expectedType,
        recordCount: beforeRecords.length,
        sourceValueFingerprint,
        writeRetryCount: 0,
      },
    );
  }
  return result ?? verifiedField;
}

async function verifiedCreateField(client, input, delaysMs, sleep) {
  const tableId = requireText(input?.tableId, 'tableId');
  const expectedName = requireText(input?.field?.fieldName ?? input?.field?.field_name, 'fieldName');
  const expectedType = requireType(input?.field?.type, 'field.type');
  const before = await client.listFields({ tableId });
  if (before.some((field) => normalizeName(field.fieldName) === normalizeName(expectedName))) {
    throw verificationError(
      'Lark field create preflight found the canonical Field already present',
      'LARK_FIELD_MUTATION_CREATE_PREEXISTING',
      { operation: 'create', expectedName, expectedType },
    );
  }

  const result = await client.createField(input);
  const createdId = optionalText(result?.fieldId);
  const verified = await pollFields({
    client,
    tableId,
    delaysMs,
    sleep,
    accept(fields) {
      const matching = fields.filter(
        (field) => normalizeName(field.fieldName) === normalizeName(expectedName),
      );
      if (matching.length !== 1 || Number(matching[0].type) !== expectedType
        || matching[0].isPrimary === true) return null;
      if (createdId && matching[0].fieldId !== createdId) return null;
      return matching[0];
    },
  });
  if (!verified) {
    throw verificationError(
      'Lark field create did not converge after one write',
      'LARK_FIELD_MUTATION_CREATE_VERIFY_FAILED',
      { operation: 'create', expectedName, expectedType, writeRetryCount: 0 },
    );
  }
  return result ?? verified;
}

async function pollFields(input) {
  for (const delayMs of input.delaysMs) {
    if (delayMs > 0) await input.sleep(delayMs);
    const fields = await input.client.listFields({ tableId: input.tableId });
    const accepted = input.accept(fields);
    if (accepted) return accepted;
  }
  return null;
}

async function pollRecords(input) {
  for (const delayMs of input.delaysMs) {
    if (delayMs > 0) await input.sleep(delayMs);
    const records = await input.client.listRecords({
      tableId: input.tableId,
      includeRecordMetadata: false,
    });
    if (input.accept(records)) return records;
  }
  return null;
}

function recordValueFingerprint(records, fieldName) {
  const rows = [...records].sort(compareRecordId).map((record) => {
    const entry = Object.entries(record?.fields ?? {}).find(
      ([name]) => normalizeName(name) === normalizeName(fieldName),
    );
    return [
      record?.recordId ?? record?.record_id ?? null,
      entry !== undefined,
      entry?.[1] ?? null,
    ];
  });
  return fingerprint(rows);
}

function compareRecordId(left, right) {
  return String(left?.recordId ?? left?.record_id ?? '')
    .localeCompare(String(right?.recordId ?? right?.record_id ?? ''));
}

function normalizeDelays(value) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
    throw new TypeError('Verified Lark field mutation delays must be non-negative integers');
  }
  return Object.freeze([...value]);
}

function requireClient(client) {
  for (const method of ['listFields', 'listRecords', 'updateField', 'createField']) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Verified Lark field mutation client requires client.${method}`);
    }
  }
  return client;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Verified Lark field mutation requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireType(value, fieldName) {
  const type = Number(value);
  if (!Number.isSafeInteger(type) || type <= 0) {
    throw new TypeError(`Verified Lark field mutation requires ${fieldName}`);
  }
  return type;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function fingerprint(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sleepMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function verificationError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
