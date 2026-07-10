/**
 * Repository adapter that provides upsert by a stable key field.
 * It loads the destination table once, indexes stable keys locally, then batch creates and updates.
 */
export class LarkRecordRepository {
  /**
   * @param {Object} input
   * @param {{ batchCreateRecords: Function, batchUpdateRecords: Function, listRecords: Function }} input.client
   */
  constructor(input) {
    this.client = requireClient(input?.client);
  }

  async listAll(tableId) {
    return this.client.listRecords({ tableId: requireText(tableId, 'tableId') });
  }

  async upsertByKey(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const keyField = requireText(input?.keyField, 'keyField');
    const rows = dedupeRowsByKey(requireArray(input?.rows, 'rows'), keyField);

    if (rows.length === 0) {
      return Object.freeze({ created: 0, updated: 0, skipped: 0 });
    }

    // Read the destination table once and build a local index. This avoids one
    // Lark search request per row, which is both slower and prone to 1254290
    // TooManyRequest errors during concurrent connector syncs.
    const existingRecords = await this.client.listRecords({ tableId });
    const existingByKey = new Map();

    for (const record of existingRecords) {
      const keyValue = optionalText(record?.fields?.[keyField]);
      if (keyValue && !existingByKey.has(keyValue)) {
        existingByKey.set(keyValue, record);
      }
    }

    const createRows = [];
    const updateRows = [];

    for (const row of rows) {
      const keyValue = requireText(row?.[keyField], keyField);
      const match = existingByKey.get(keyValue);
      if (match?.recordId) {
        updateRows.push({ recordId: match.recordId, fields: row });
      } else {
        createRows.push(row);
      }
    }

    // Keep writes sequential. Lark Base can return write-conflict/rate-limit
    // errors when the same table/app is modified concurrently.
    const createResult = await this.client.batchCreateRecords({ tableId, records: createRows });
    const updateResult = await this.client.batchUpdateRecords({ tableId, records: updateRows });

    return Object.freeze({
      created: createResult.created,
      updated: updateResult.updated,
      skipped: 0,
    });
  }
}

export function dedupeRowsByKey(rows, keyField) {
  const normalizedKeyField = requireText(keyField, 'keyField');
  const byKey = new Map();

  for (const row of rows) {
    const keyValue = requireText(row?.[normalizedKeyField], normalizedKeyField);
    byKey.set(keyValue, row);
  }

  return [...byKey.values()];
}

function requireClient(client) {
  const requiredMethods = ['batchCreateRecords', 'batchUpdateRecords', 'listRecords'];
  for (const method of requiredMethods) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`LarkRecordRepository requires client.${method}`);
    }
  }

  return client;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`LarkRecordRepository requires array ${fieldName}`);
  }

  return value;
}

function optionalText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return text === '' ? null : text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LarkRecordRepository requires ${fieldName}`);
  }

  return value.trim();
}
