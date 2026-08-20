import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseCloneCanonicalParity } from '../../packages/application/src/use-cases/verify-lark-base-clone-canonical-parity.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId,
  fieldName,
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: primary,
  property: null,
});

const relation = (fieldId, fieldName, tableId) => ({
  fieldId,
  fieldName,
  type: 18,
  uiType: 'SingleLink',
  description: '',
  isPrimary: false,
  property: { table_id: tableId, multiple: false },
});

const record = (recordId, fields) => ({ recordId, fields });

class ReadClient {
  constructor(tables) {
    this.tables = structuredClone(tables);
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  async listFields({ tableId }) {
    return structuredClone(this.tables.find((table) => table.tableId === tableId).fields);
  }

  async listRecords({ tableId }) {
    return structuredClone(this.tables.find((table) => table.tableId === tableId).records);
  }

  async listViews() {
    return [];
  }
}

function fixtures(sourceRelationValue, targetRelationValue) {
  const sourceClient = new ReadClient([
    {
      tableId: 'src_accounts',
      name: 'Accounts',
      fields: [text('src_account_key', 'account_key', true)],
      records: [record('src_account_rec', { account_key: 'a1' })],
    },
    {
      tableId: 'src_campaigns',
      name: 'Campaigns',
      fields: [
        text('src_campaign_key', 'campaign_key', true),
        relation('src_account_link', 'account_link', 'src_accounts'),
      ],
      records: [record('src_campaign_rec', {
        campaign_key: 'c1',
        account_link: sourceRelationValue,
      })],
    },
  ]);

  const targetClient = new ReadClient([
    {
      tableId: 'target_accounts',
      name: 'Accounts',
      fields: [text('target_account_key', 'account_key', true)],
      records: [record('target_account_rec', { account_key: 'a1' })],
    },
    {
      tableId: 'target_campaigns',
      name: 'Campaigns',
      fields: [
        text('target_campaign_key', 'campaign_key', true),
        relation('target_account_link', 'account_link', 'target_accounts'),
      ],
      records: [record('target_campaign_rec', {
        campaign_key: 'c1',
        account_link: targetRelationValue,
      })],
    },
  ]);

  return { sourceClient, targetClient };
}

test('canonical verifier treats null and empty-array relation readback as the same no-link state', async () => {
  const { sourceClient, targetClient } = fixtures(null, []);

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatches, 0);
  assert.equal(result.remoteMutationCount, 0);
});

test('canonical verifier still rejects a missing non-empty relation', async () => {
  const { sourceClient, targetClient } = fixtures(['src_account_rec'], []);

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => (
    item.code === 'CANONICAL_VERIFY_RECORD_VALUE_MISMATCH'
      && item.message.includes('Campaigns.account_link')
  )));
  assert.equal(result.remoteMutationCount, 0);
});
