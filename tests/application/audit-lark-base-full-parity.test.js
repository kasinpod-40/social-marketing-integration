import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLarkBaseFullParity } from '../../packages/application/src/use-cases/audit-lark-base-full-parity.js';

class FakeAuditClient {
  constructor({ appToken, failResource = null } = {}) {
    this.appToken = appToken ?? 'app_fake';
    this.failResource = failResource;
  }

  async listTables() {
    return [{ tableId: 'tbl_1', name: 'Accounts' }];
  }

  async listFields() {
    return [{ fieldId: 'fld_1', fieldName: 'account_key', type: 1, isPrimary: true, property: null }];
  }

  async listRecords() {
    return [{ recordId: 'rec_1', fields: { account_key: 'a1' } }];
  }

  async listViews() {
    return [{ viewId: 'vew_1', viewName: 'All Records', viewType: 'grid' }];
  }

  async requestBitableJson(path) {
    if (this.failResource && path.includes(this.failResource)) {
      const error = new Error('read blocked');
      error.code = 'FAKE_READ_BLOCKED';
      throw error;
    }
    if (path.endsWith('/blocks/list')) return { data: { blocks: [] } };
    if (path.includes('/views/vew_1/')) return { data: {} };
    if (path.endsWith('/views/vew_1')) return { data: { id: 'vew_1', name: 'All Records', type: 'grid' } };
    if (path.includes('/forms')) return { data: { forms: [], has_more: false } };
    if (path.endsWith('/dashboards') || path.includes('/dashboards?')) return { data: { dashboards: [], has_more: false } };
    if (path.endsWith('/workflows') || path.includes('/workflows?')) return { data: { workflows: [], has_more: false } };
    if (path.endsWith('/roles')) return { data: { roles: [] } };
    return { data: {} };
  }
}

test('full parity audit is GET-only and inventories every required parity dimension', async () => {
  const result = await auditLarkBaseFullParity({
    sourceClient: new FakeAuditClient({ appToken: 'app_source' }),
    targetClient: new FakeAuditClient({ appToken: 'app_target' }),
    expectedTableNames: ['Accounts'],
    expectedTableCount: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.source.tables, 1);
  assert.equal(result.source.records, 1);
  assert.equal(result.source.views, 1);
  assert.equal(result.target.tables, 1);
  assert.equal(result.writeGate.provisionMissingBlocked, true);
  assert.equal(result.writeGate.consolidationApplyBlocked, true);
  assert.ok(result.fullParityDefinition.dimensions.includes('view sort'));
  assert.ok(result.fullParityDefinition.dimensions.includes('view filter'));
  assert.ok(result.fullParityDefinition.dimensions.includes('dashboards, themes, blocks, layouts and data_config'));
  assert.ok(result.fullParityDefinition.dimensions.includes('workflows, steps and enabled/disabled state'));
  assert.ok(result.fullParityDefinition.dimensions.includes('advanced-permission roles and full role configuration'));
});

test('full parity audit fails closed when any required resource cannot be read', async () => {
  const result = await auditLarkBaseFullParity({
    sourceClient: new FakeAuditClient({ appToken: 'app_source', failResource: '/roles' }),
    targetClient: new FakeAuditClient({ appToken: 'app_target' }),
    expectedTableNames: ['Accounts'],
    expectedTableCount: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.remoteMutationCount, 0);
  assert.ok(result.blockers.some((item) => item.code === 'FULL_PARITY_READ_COVERAGE_INCOMPLETE'));
  assert.ok(result.source.readFailures.some((item) => item.resource === 'advanced-permission-roles'));
});

test('full parity audit reports missing destination tables instead of permitting partial apply', async () => {
  class EmptyTargetClient extends FakeAuditClient {
    async listTables() { return []; }
  }

  const result = await auditLarkBaseFullParity({
    sourceClient: new FakeAuditClient({ appToken: 'app_source' }),
    targetClient: new EmptyTargetClient({ appToken: 'app_target' }),
    expectedTableNames: ['Accounts'],
    expectedTableCount: 1,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.target.missingExpectedTables, ['Accounts']);
  assert.ok(result.blockers.some((item) => item.code === 'FULL_PARITY_TARGET_TABLE_MISSING'));
  assert.equal(result.writeGate.consolidationApplyBlocked, true);
});
