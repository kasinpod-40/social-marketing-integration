import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightCustomerBaseFullParity } from '../../packages/application/src/use-cases/preflight-customer-base-full-parity.js';

class FakeBaseClient {
  constructor({ appToken, name, tableNames, isAdvanced = true }) {
    this.appToken = appToken;
    this.name = name;
    this.tableNames = tableNames;
    this.isAdvanced = isAdvanced;
    this.requests = [];
  }

  async requestBitableJson(path, options = {}) {
    this.requests.push({ path, options });
    return {
      code: 0,
      data: {
        app: {
          app_token: this.appToken,
          name: this.name,
          revision: 7,
          is_advanced: this.isAdvanced,
          time_zone: 'Asia/Bangkok',
          formula_type: 1,
          advance_version: 'v1',
        },
      },
    };
  }

  async listTables() {
    return this.tableNames.map((name, index) => ({ tableId: `tbl_${index + 1}`, name }));
  }
}

test('customer Base identity preflight is GET-only and accepts the exact source authority', async () => {
  const expected = ['A', 'B', 'C'];
  const source = new FakeBaseClient({ appToken: 'app_source', name: 'Social MKT Data Hub', tableNames: expected });
  const target = new FakeBaseClient({ appToken: 'app_target', name: '✨Marketing Content Calendar', tableNames: ['C'] });

  const result = await preflightCustomerBaseFullParity({
    sourceClient: source,
    targetClient: target,
    expectedTableNames: expected,
    expectedSourceLabel: 'Social MKT Data Hub',
    expectedTargetLabel: '✨Marketing Content Calendar',
  });

  assert.equal(result.ok, true);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.source.tableCount, 3);
  assert.deepEqual(result.source.missingExpectedTables, []);
  assert.deepEqual(result.target.missingExpectedTables, ['A', 'B']);
  assert.equal(source.requests.length, 1);
  assert.equal(source.requests[0].options.method, 'GET');
  assert.equal(source.requests[0].path, '/open-apis/bitable/v1/apps/app_source');
});

test('customer Base identity preflight stops when configured source is only a 17-table subset', async () => {
  const expected = Array.from({ length: 33 }, (_, index) => `T${index + 1}`);
  const sourceTables = expected.slice(0, 17);
  const source = new FakeBaseClient({ appToken: 'app_source', name: 'Social MKT Data Hub', tableNames: sourceTables });
  const target = new FakeBaseClient({ appToken: 'app_target', name: '✨Marketing Content Calendar', tableNames: [] });

  const result = await preflightCustomerBaseFullParity({
    sourceClient: source,
    targetClient: target,
    expectedTableNames: expected,
    expectedSourceLabel: 'Social MKT Data Hub',
    expectedTargetLabel: '✨Marketing Content Calendar',
  });

  assert.equal(result.ok, false);
  assert.equal(result.source.tableCount, 17);
  assert.equal(result.source.missingExpectedTables.length, 16);
  assert.ok(result.blockers.some((item) => item.code === 'CUSTOMER_BASE_SOURCE_AUTHORITY_TABLE_SET_MISMATCH'));
});

test('customer Base identity preflight fails closed on source or target Base name mismatch', async () => {
  const source = new FakeBaseClient({ appToken: 'app_source', name: 'Wrong Source', tableNames: ['A'] });
  const target = new FakeBaseClient({ appToken: 'app_target', name: 'Wrong Target', tableNames: [] });

  const result = await preflightCustomerBaseFullParity({
    sourceClient: source,
    targetClient: target,
    expectedTableNames: ['A'],
    expectedSourceLabel: 'Social MKT Data Hub',
    expectedTargetLabel: '✨Marketing Content Calendar',
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.code === 'CUSTOMER_BASE_SOURCE_IDENTITY_NAME_MISMATCH'));
  assert.ok(result.blockers.some((item) => item.code === 'CUSTOMER_BASE_TARGET_IDENTITY_NAME_MISMATCH'));
});
