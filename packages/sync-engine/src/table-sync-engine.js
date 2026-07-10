/**
 * Generic table synchronization engine.
 *
 * Responsibilities:
 * - validate and deduplicate incoming rows by a stable key
 * - read the destination table once
 * - build an in-memory key index
 * - detect duplicate keys already stored in the destination
 * - create missing rows, update changed rows, and skip unchanged rows
 *
 * Storage-specific repositories only perform list/create/update I/O. This
 * engine is intentionally independent of Lark so future storage adapters can
 * reuse the same synchronization behavior.
 */
export class TableSyncEngine {
  /**
   * @param {Object} [options]
   * @param {'error'|'first'} [options.existingDuplicatePolicy]
   */
  constructor(options = {}) {
    this.existingDuplicatePolicy = readDuplicatePolicy(options.existingDuplicatePolicy ?? 'error');
  }

  /**
   * @param {Object} input
   * @param {{listAll: Function, createMany: Function, updateMany: Function}} input.repository
   * @param {string} input.tableId
   * @param {string} input.keyField
   * @param {Object[]} input.rows
   */
  async syncByKey(input) {
    const repository = requireRepository(input?.repository);
    const tableId = requireText(input?.tableId, 'tableId');
    const keyField = requireText(input?.keyField, 'keyField');
    const deduplicated = deduplicateRowsByKey(requireArray(input?.rows, 'rows'), keyField);

    if (deduplicated.rows.length === 0) {
      return freezeResult({ created: 0, updated: 0, skipped: 0, duplicateInputRows: 0 });
    }

    const existingRecords = await repository.listAll(tableId);
    const existingIndex = buildExistingIndex(existingRecords, keyField, this.existingDuplicatePolicy);
    const createRows = [];
    const updateRows = [];
    let skipped = 0;

    for (const row of deduplicated.rows) {
      const keyValue = requireText(row?.[keyField], keyField);
      const existing = existingIndex.get(keyValue);

      if (!existing) {
        createRows.push(row);
        continue;
      }

      if (!existing.recordId) {
        throw new Error(`Destination record for ${keyField}=${keyValue} has no recordId`);
      }

      if (hasChangedFields(existing.fields, row)) {
        updateRows.push({ recordId: existing.recordId, fields: row });
      } else {
        skipped += 1;
      }
    }

    // Writes remain sequential by design. Storage adapters may batch each call,
    // while the engine avoids concurrent mutations against the same table/app.
    const createResult = await repository.createMany(tableId, createRows);
    const updateResult = await repository.updateMany(tableId, updateRows);

    return freezeResult({
      created: Number(createResult?.created ?? 0),
      updated: Number(updateResult?.updated ?? 0),
      skipped,
      duplicateInputRows: deduplicated.duplicateCount,
    });
  }
}

export function deduplicateRowsByKey(rows, keyField) {
  const normalizedKeyField = requireText(keyField, 'keyField');
  const byKey = new Map();
  let duplicateCount = 0;

  for (const row of rows) {
    requirePlainObject(row, 'row');
    const keyValue = requireText(row?.[normalizedKeyField], normalizedKeyField);
    if (byKey.has(keyValue)) duplicateCount += 1;
    // Last row wins because connector batches commonly contain a later snapshot
    // of the same source entity.
    byKey.set(keyValue, row);
  }

  return Object.freeze({ rows: Object.freeze([...byKey.values()]), duplicateCount });
}

export function hasChangedFields(existingFields, incomingFields) {
  requirePlainObject(existingFields, 'existingFields');
  requirePlainObject(incomingFields, 'incomingFields');

  for (const [fieldName, incomingValue] of Object.entries(incomingFields)) {
    if (!deepEqual(normalizeComparable(existingFields[fieldName]), normalizeComparable(incomingValue))) {
      return true;
    }
  }

  return false;
}

function buildExistingIndex(records, keyField, duplicatePolicy) {
  const index = new Map();
  const duplicates = [];

  for (const record of requireArray(records, 'existingRecords')) {
    const keyValue = optionalText(record?.fields?.[keyField]);
    if (!keyValue) continue;

    if (index.has(keyValue)) {
      duplicates.push(keyValue);
      if (duplicatePolicy === 'first') continue;
    }

    index.set(keyValue, record);
  }

  if (duplicates.length > 0 && duplicatePolicy === 'error') {
    const unique = [...new Set(duplicates)];
    throw new Error(`Destination table contains duplicate ${keyField} values: ${unique.slice(0, 10).join(', ')}`);
  }

  return index;
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeComparable(nested)]),
    );
  }
  return value;
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  if (typeof left === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
  }

  return false;
}

function requireRepository(repository) {
  for (const method of ['listAll', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`TableSyncEngine requires repository.${method}`);
    }
  }
  return repository;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TableSyncEngine requires array ${fieldName}`);
  return value;
}

function requirePlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`TableSyncEngine requires object ${fieldName}`);
  }
  return value;
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TableSyncEngine requires ${fieldName}`);
  }
  return value.trim();
}

function readDuplicatePolicy(value) {
  if (value !== 'error' && value !== 'first') {
    throw new TypeError('existingDuplicatePolicy must be error or first');
  }
  return value;
}

function freezeResult(result) {
  return Object.freeze(result);
}
