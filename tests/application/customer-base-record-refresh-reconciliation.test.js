import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
  applyCustomerBaseControlledParity,
} from '../../packages/application/src/use-cases/apply-customer-base-controlled-parity.js';
import { prepareLarkBaseResumableTarget } from '../../packages/application/src/use-cases/prepare-lark-base-resumable-target.js';

const primary = () => ({
  fieldId: 'fld_key',
  fieldName: 'account_key',
  type: 1,
  uiType: 'Text',
  description: '',
  property: null,
  isPrimary: true,
});

class RecordRefreshTarget {
  constructor({ persistUpdates = true, persistDeletes = true } = {}) {
    this.persistUpdates = persistUpdates;
    this.persistDeletes = persistDeletes;
    this.calls = [];
    this.tables = [
      {
        tableId: 'protected_tiktok',
        name: 'TikTok',
        fields: [{ ...primary(), fieldId: 'fld_protected', fieldName: 'key' }],
        records: [],
        views: [],
      },
      {
        tableId: 'tbl_accounts',
        name: 'Accounts',
        fields: [primary(), {
          fieldId: 'fld_last_sync', fieldName: 'last_sync_at', type: 5,
          uiType: 'DateTime', description: '', property: null, isPrimary: false,
        }],
        records: [{
          recordId: 'rec_existing',
          fields: { account_key: 'facebook:982406442148381', last_sync_at: 1000 },
        }],
        views: [],
      },
    ];
    this.sequence = 0;
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
    return structuredClone(this.table(tableId).records);
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

  async batchCreateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchCreateRecords', tableId, records: structuredClone(records) });
    for (const fields of records) {
      this.table(tableId).records.push({ recordId: `rec_new_${++this.sequence}`, fields: structuredClone(fields) });
    }
    return { created: records.length };
  }

  async batchUpdateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchUpdateRecords', tableId, records: structuredClone(records) });
    if (this.persistUpdates) {
      for (const update of records) {
        const record = this.table(tableId).records.find((item) => item.recordId === update.recordId);
        Object.assign(record.fields, structuredClone(update.fields));
      }
    }
    return { updated: records.length };
  }

  async batchDeleteRecords({ tableId, recordIds }) {
    this.calls.push({ kind: 'batchDeleteRecords', tableId, recordIds: structuredClone(recordIds) });
    if (this.persistDeletes) {
      const deleted = new Set(recordIds);
      this.table(tableId).records = this.table(tableId).records.filter((record) => !deleted.has(record.recordId));
    }
    return { deleted: recordIds.length };
  }
}

async function claimedAccounts(target, recordReconciliationMode) {
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Accounts'],
    protectedTables: [{ name: 'TikTok', tableId: 'protected_tiktok' }],
    recordReconciliationMode,
  });
  const table = await prepared.client.createTable({
    name: 'Accounts',
    defaultViewName: 'All Records',
    fields: [{ fieldName: 'account_key', type: 1, description: '', property: null }],
  });
  assert.equal(table.tableId, 'tbl_accounts');
  return prepared.client;
}

test('exact-retry still fails closed when an existing migration-owned record differs', async () => {
  const target = new RecordRefreshTarget();
  const client = await claimedAccounts(target, 'exact-retry');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_accounts',
      records: [{ account_key: 'facebook:982406442148381', last_sync_at: 2000 }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_CONFLICT'
      && error?.details?.fieldName === 'last_sync_at',
  );
  assert.equal(target.calls.some((call) => call.kind === 'batchUpdateRecords'), false);
});

test('source-refresh reconciles requested fields by stable primary while preserving the historical create result shape', async () => {
  const target = new RecordRefreshTarget();
  const client = await claimedAccounts(target, 'source-refresh');

  const result = await client.batchCreateRecords({
    tableId: 'tbl_accounts',
    records: [
      { account_key: 'facebook:982406442148381', last_sync_at: 2000 },
      { account_key: 'instagram:27863086069952218', last_sync_at: 3000 },
    ],
  });

  assert.deepEqual(result, { created: 1 });
  const updateCall = target.calls.find((call) => call.kind === 'batchUpdateRecords');
  assert.deepEqual(updateCall.records, [{
    recordId: 'rec_existing',
    fields: { last_sync_at: 2000 },
  }]);
  assert.equal('account_key' in updateCall.records[0].fields, false);
  assert.deepEqual(
    target.calls.filter((call) => call.kind === 'batchCreateRecords').map((call) => call.records.length),
    [1],
  );
  const existing = target.table('tbl_accounts').records.find((item) => item.recordId === 'rec_existing');
  assert.equal(existing.fields.last_sync_at, 2000);
});

test('source-refresh deletes only stale migration-owned primary keys absent from the admitted Source and verifies readback', async () => {
  const target = new RecordRefreshTarget();
  target.table('tbl_accounts').records.push({
    recordId: 'rec_stale',
    fields: { account_key: 'instagram:stale', last_sync_at: 900 },
  });
  const client = await claimedAccounts(target, 'source-refresh');

  const result = await client.batchCreateRecords({
    tableId: 'tbl_accounts',
    records: [{ account_key: 'facebook:982406442148381', last_sync_at: 1000 }],
  });

  assert.deepEqual(result, { created: 0 });
  const deleteCall = target.calls.find((call) => call.kind === 'batchDeleteRecords');
  assert.deepEqual(deleteCall, {
    kind: 'batchDeleteRecords',
    tableId: 'tbl_accounts',
    recordIds: ['rec_stale'],
  });
  assert.deepEqual(
    target.table('tbl_accounts').records.map((record) => record.fields.account_key),
    ['facebook:982406442148381'],
  );
});

test('exact-retry never deletes a migration-owned record that is absent from the requested Source', async () => {
  const target = new RecordRefreshTarget();
  target.table('tbl_accounts').records.push({
    recordId: 'rec_stale',
    fields: { account_key: 'instagram:stale', last_sync_at: 900 },
  });
  const client = await claimedAccounts(target, 'exact-retry');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_accounts',
      records: [{ account_key: 'facebook:982406442148381', last_sync_at: 1000 }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_STALE_CONFLICT'
      && error?.details?.staleRecordCount === 1,
  );
  assert.equal(target.calls.some((call) => call.kind === 'batchDeleteRecords'), false);
  assert.equal(target.table('tbl_accounts').records.some((record) => record.recordId === 'rec_stale'), true);
});

test('source-refresh requires delete capability only when stale migration-owned records exist', async () => {
  const target = new RecordRefreshTarget();
  target.table('tbl_accounts').records.push({
    recordId: 'rec_stale',
    fields: { account_key: 'instagram:stale', last_sync_at: 900 },
  });
  target.batchDeleteRecords = undefined;
  const client = await claimedAccounts(target, 'source-refresh');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_accounts',
      records: [{ account_key: 'facebook:982406442148381', last_sync_at: 1000 }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_STALE_DELETE_CAPABILITY_UNAVAILABLE'
      && error?.details?.staleRecordCount === 1,
  );
});

test('source-refresh fails closed when stale deletion readback still contains the removed primary key', async () => {
  const target = new RecordRefreshTarget({ persistDeletes: false });
  target.table('tbl_accounts').records.push({
    recordId: 'rec_stale',
    fields: { account_key: 'instagram:stale', last_sync_at: 900 },
  });
  const client = await claimedAccounts(target, 'source-refresh');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_accounts',
      records: [{ account_key: 'facebook:982406442148381', last_sync_at: 1000 }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_STALE_DELETE_READBACK_MISMATCH'
      && error?.details?.expectedDeleted === 1
      && error?.details?.remainingStale === 1,
  );
});

test('exact-retry does not require a batchUpdateRecords capability', async () => {
  const target = new RecordRefreshTarget();
  delete target.batchUpdateRecords;
  target.batchUpdateRecords = undefined;
  const client = await claimedAccounts(target, 'exact-retry');

  const result = await client.batchCreateRecords({
    tableId: 'tbl_accounts',
    records: [
      { account_key: 'facebook:982406442148381', last_sync_at: 1000 },
      { account_key: 'instagram:new', last_sync_at: 3000 },
    ],
  });
  assert.deepEqual(result, { created: 1 });
});

test('source-refresh requires update capability only when an existing record actually differs', async () => {
  const target = new RecordRefreshTarget();
  target.batchUpdateRecords = undefined;
  const client = await claimedAccounts(target, 'source-refresh');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_accounts',
      records: [{ account_key: 'facebook:982406442148381', last_sync_at: 2000 }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_REFRESH_CAPABILITY_UNAVAILABLE',
  );
});

test('source-refresh fails closed when update readback does not match the requested Source value', async () => {
  const target = new RecordRefreshTarget({ persistUpdates: false });
  const client = await claimedAccounts(target, 'source-refresh');

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_accounts',
      records: [{ account_key: 'facebook:982406442148381', last_sync_at: 2000 }],
    }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_RECORD_REFRESH_READBACK_MISMATCH'
      && error?.details?.fieldName === 'last_sync_at',
  );
});

test('controlled Apply threads source-refresh mode only through the existing resumable adapter', async () => {
  const captured = [];
  const sha = 'a'.repeat(64);
  const client = { listTables: async () => [] };
  const operations = {
    prepareLarkBaseResumableTarget: async (input) => {
      captured.push(input.recordReconciliationMode);
      return { ok: true, client };
    },
    applyLarkBaseConsolidation: async () => ({ ok: true }),
    applyLarkBaseDocumentedViewParity: async () => ({ ok: true }),
    planLarkBaseAdvancedPermissionParity: () => ({ ok: true, readyToWrite: true }),
    applyLarkBaseAdvancedPermissionParity: async () => ({ ok: true }),
    verifyLarkBaseAdvancedPermissionParity: async () => ({ ok: true }),
    verifyLarkBaseCloneCanonicalParity: async () => ({ ok: true }),
  };

  await applyCustomerBaseControlledParity({
    confirmation: CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
    sourceClient: {},
    targetClient: {},
    permissionSemantics: {},
    checkpoint: {
      contractVersion: 'customer_base_controlled_apply_checkpoint_v1',
      sourceAuthoritySha256: sha,
      expectedTableNames: ['Accounts'],
      requiredProtectedTableNames: ['TikTok'],
      protectedExternalTableNames: ['TikTok'],
      protectedTables: [{ name: 'TikTok', tableId: 'protected_tiktok' }],
      protectedRoles: [],
      manualOwnershipFrozen: true,
    },
    expectedTableNames: ['Accounts'],
    sourceAuthoritySha256: sha,
    recordReconciliationMode: 'source-refresh',
    operations,
  });

  assert.deepEqual(captured, ['source-refresh']);
});