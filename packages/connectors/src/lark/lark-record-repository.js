/**
 * Thin Lark Base storage adapter.
 *
 * It intentionally contains no dedupe, diff, retry, or upsert business logic.
 * Those concerns belong to TableSyncEngine and LarkBitableClient respectively.
 */
export class LarkRecordRepository {
  /**
   * @param {Object} input
   * @param {{batchCreateRecords: Function, batchUpdateRecords: Function, listRecords: Function}} input.client
   */
  constructor(input) {
    this.client = requireClient(input?.client);
  }

  async listAll(tableId) {
    return this.client.listRecords({ tableId: requireText(tableId, 'tableId') });
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
}

function requireClient(client) {
  for (const method of ['batchCreateRecords', 'batchUpdateRecords', 'listRecords']) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`LarkRecordRepository requires client.${method}`);
    }
  }
  return client;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`LarkRecordRepository requires array ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LarkRecordRepository requires ${fieldName}`);
  }
  return value.trim();
}
