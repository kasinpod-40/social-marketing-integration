import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLarkBaseResumableTarget } from '../../packages/application/src/use-cases/prepare-lark-base-resumable-target.js';

const field = (fieldId, fieldName, type, primary = false) => ({
  fieldId,
  fieldName,
  type,
  uiType: type === 2 ? 'Number' : 'Text',
  description: '',
  property: type === 2 ? { formatter: '0' } : null,
  isPrimary: primary,
});

class NumericStringReadbackTarget {
  constructor({ followers = '1000', note = '001' } = {}) {
    this.calls = [];
    this.tables = [
      {
        tableId: 'protected_tiktok',
        name: 'TikTok',
        fields: [field('fld_protected', 'key', 1, true)],
        records: [],
        views: [],
      },
      {
        tableId: 'tbl_daily',
        name: 'Accounts Daily',
        fields: [
          field('fld_key', 'account_daily_key', 1, true),
          field('fld_followers', 'followers', 2),
          field('fld_note', 'note', 1),
        ],
        records: [{
          recordId: 'rec_daily',
          fields: {
            account_daily_key: 'instagram:17841413521012797:2026-08-10',
            followers,
            note,
          },
        }],
        views: [],
      },
    ];
  }

  table(tableId) {
    const table = this.tables.find((item) => item.tableId === tableId);
    if (!table) throw new Error(`Unknown table ${tableId}`);
    return table;
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  async listFields({ tableId }) {
    return structuredClone(this.table(tableId).fields);
  }

  async listRecords({ tableId }) {
    const records = structuredClone(this.table(tableId).records);
    if (tableId === 'tbl_daily') {
      for (const record of records) {
        const value = record.fields.followers;
        if (typeof value === 'number') record.fields.followers = String(value);
      }
    }
    return records;
  }

  async listViews({ tableId }) {
    return structuredClone(this.table(tableId).views);
  }

  async createTable() {
    throw new Error('unexpected createTable');
  }

  async createField() {
    throw new Error('unexpected createField');
  }

  async updateField() {
    throw new Error('unexpected updateField');
  }

  async batchCreateRecords() {
    throw new Error('unexpected batchCreateRecords');
  }

  async batchUpdateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchUpdateRecords', tableId, records: structuredClone(records) });
    for (const update of records) {
      const record = this.table(tableId).records.find((item) => item.recordId === update.recordId);
      Object.assign(record.fields, structuredClone(update.fields));
    }
    return { updated: records.length };
  }
}

async function claim(target, mode) {
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Accounts Daily'],
    protectedTables: [{ name: 'TikTok', tableId: 'protected_tiktok' }],
    recordReconciliationMode: mode,
  });
  await prepared.client.createTable({
    name: 'Accounts Daily',
    defaultViewName: 'All Records',
    fields: [{ fieldName: 'account_daily_key', type: 1, description: '', property: null }],
  });
  return prepared.client;
}

test('exact retry treats numeric-string and number as equal only for Number fields', async () => {
  const target = new NumericStringReadbackTarget({ followers: '1234' });
  const client = await claim(target, 'exact-retry');

  const result = await client.batchCreateRecords({
    tableId: 'tbl_daily',
    records: [{
      account_daily_key: 'instagram:17841413521012797:2026-08-10',
      followers: 1234,
      note: '001',
    }],
  });

  assert.deepEqual(result, { created: 0 });
  assert.equal(target.calls.length, 0);
});

test('source refresh accepts Lark numeric-string readback after a Number update', async () => {
  const target = new NumericStringReadbackTarget({ followers: '1000' });
  const client = await claim(target, 'source-refresh');

  const result = await client.batchCreateRecords({
    tableId: 'tbl_daily',
    records: [{
      account_daily_key: 'instagram:17841413521012797:2026-08-10',
      followers: 1234,
      note: '001',
    }],
  });

  assert.deepEqual(result, { created: 0 });
  assert.deepEqual(target.calls, [{
    kind: 'batchUpdateRecords',
    tableId: 'tbl_daily',
    records: [{ recordId: 'rec_daily', fields: { followers: 1234 } }],
  }]);
});

test('Text fields remain strict and are never numeric-coerced', async () => {
  const target = new NumericStringReadbackTarget({ followers: '1234', note: '001' });
  const client = await claim(target, 'exact-retry');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_daily',
      records: [{
        account_daily_key: 'instagram:17841413521012797:2026-08-10',
        followers: 1234,
        note: 1,
      }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_CONFLICT'
      && error?.details?.fieldName === 'note',
  );
});
