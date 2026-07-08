const DEFAULT_CONCURRENCY = 4;

/**
 * Repository adapter that provides upsert by a stable key field.
 * It searches keys with bounded concurrency, then batch creates and updates.
 */
export class LarkRecordRepository {
  /**
   * @param {Object} input
   * @param {{ searchRecordsByField: Function, batchCreateRecords: Function, batchUpdateRecords: Function, listRecords: Function }} input.client
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

    const lookupResults = await mapWithConcurrency(rows, DEFAULT_CONCURRENCY, async (row) => {
      const keyValue = requireText(row?.[keyField], keyField);
      const matches = await this.client.searchRecordsByField({ tableId, fieldName: keyField, fieldValue: keyValue });
      return { row, match: matches[0] ?? null };
    });

    const createRows = [];
    const updateRows = [];

    for (const result of lookupResults) {
      if (result.match?.recordId) {
        updateRows.push({ recordId: result.match.recordId, fields: result.row });
      } else {
        createRows.push(result.row);
      }
    }

    const [createResult, updateResult] = await Promise.all([
      this.client.batchCreateRecords({ tableId, records: createRows }),
      this.client.batchUpdateRecords({ tableId, records: updateRows }),
    ]);

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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function requireClient(client) {
  const requiredMethods = ['searchRecordsByField', 'batchCreateRecords', 'batchUpdateRecords', 'listRecords'];
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

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LarkRecordRepository requires ${fieldName}`);
  }

  return value.trim();
}
