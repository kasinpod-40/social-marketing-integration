import { serializeRowsForLark } from './lark-field-serializer.js';

/**
 * Lark Base storage adapter. It owns destination-schema discovery and typed
 * field serialization; dedupe/diff policy remains in TableSyncEngine.
 */
export class LarkRecordRepository {
  constructor(input) {
    this.client = requireClient(input?.client);
    this.schemaCache = new Map();
  }

  async listAll(tableId) {
    return this.client.listRecords({ tableId: requireText(tableId, 'tableId') });
  }

  async prepareRows(tableId, rows, context = {}) {
    const normalizedTableId = requireText(tableId, 'tableId');
    const fields = await this.getTableFields(normalizedTableId);
    return serializeRowsForLark(requireArray(rows, 'rows'), fields, {
      tableId: normalizedTableId,
      keyField: context?.keyField,
    });
  }

  async createMany(tableId, rows) {
    return this.client.batchCreateRecords({
      tableId: requireText(tableId, 'tableId'),
      records: requireArray(rows, 'rows'),
    });
  }

  async updateMany(tableId, records) {
    return this.client.batchUpdateRecords({
      tableId: requireText(tableId, 'tableId'),
      records: requireArray(records, 'records'),
    });
  }

  async getTableFields(tableId) {
    const normalizedTableId = requireText(tableId, 'tableId');
    if (!this.schemaCache.has(normalizedTableId)) {
      this.schemaCache.set(normalizedTableId, Promise.resolve(
        this.client.listFields({ tableId: normalizedTableId }),
      ).catch((error) => {
        this.schemaCache.delete(normalizedTableId);
        throw error;
      }));
    }
    return this.schemaCache.get(normalizedTableId);
  }
}

function requireClient(client) {
  for (const method of ['batchCreateRecords', 'batchUpdateRecords', 'listRecords', 'listFields']) {
    if (typeof client?.[method] !== 'function') throw new TypeError(`LarkRecordRepository requires client.${method}`);
  }
  return client;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`LarkRecordRepository requires array ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`LarkRecordRepository requires ${fieldName}`);
  return value.trim();
}
