import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_LARK_VIEW_HYGIENE_FOLDER,
  CUSTOMER_LARK_VIEW_HYGIENE_VERSION,
  applyCustomerLarkViewHygiene,
  sha256CustomerLarkViewHygieneScope,
} from '../../packages/application/src/use-cases/apply-customer-lark-view-hygiene.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { processJob } from '../../apps/sync-worker/src/active-job-router.js';

function baseScope() {
  return {
    version: CUSTOMER_LARK_VIEW_HYGIENE_VERSION,
    folderName: CUSTOMER_LARK_VIEW_HYGIENE_FOLDER,
    tableId: 'tblCustomerMkt',
    tableName: '📈 MKT_Ads_Daily',
    primaryFieldId: 'fldPrimary',
    candidateFields: [
      { fieldId: 'fldEmpty', fieldName: 'empty_metric' },
      { fieldId: 'fldNowPopulated', fieldName: 'late_metric' },
    ],
    views: [
      { viewId: 'vewAll', viewName: 'All Records', viewType: 'grid' },
      { viewId: 'vewPaid', viewName: 'Paid only', viewType: 'grid' },
    ],
  };
}

async function reviewedScope(overrides = {}) {
  const scope = { ...baseScope(), ...overrides };
  return { ...scope, scopeSha256: await sha256CustomerLarkViewHygieneScope(scope) };
}

function fakeClient() {
  const views = new Map([
    ['vewAll', {
      viewId: 'vewAll', viewName: 'All Records', viewType: 'grid',
      property: { hiddenFields: ['fldExisting'], filterInfo: null },
    }],
    ['vewPaid', {
      viewId: 'vewPaid', viewName: 'Paid only', viewType: 'grid',
      property: { hiddenFields: ['fldEmpty'], filterInfo: null },
    }],
  ]);
  const calls = { searches: [], updates: [] };
  return {
    calls,
    async listFields() {
      return [
        { fieldId: 'fldPrimary', fieldName: 'stable_key', isPrimary: true },
        { fieldId: 'fldEmpty', fieldName: 'empty_metric', isPrimary: false },
        { fieldId: 'fldNowPopulated', fieldName: 'late_metric', isPrimary: false },
      ];
    },
    async searchRecords(input) {
      calls.searches.push(input);
      return input.fieldNames[0] === 'late_metric'
        ? [{ recordId: 'rec1', fields: { late_metric: 7 } }]
        : [];
    },
    async listViews() { return [...views.values()]; },
    async getView({ viewId }) { return structuredClone(views.get(viewId)); },
    async updateView({ viewId, hiddenFields, ...rest }) {
      calls.updates.push({ viewId, hiddenFields, ...rest });
      views.get(viewId).property.hiddenFields = [...hiddenFields];
    },
  };
}

test('live-proves empty candidates, preserves existing hidden fields, and skips populated fields', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();

  const result = await applyCustomerLarkViewHygiene({
    client,
    scope,
    allowedScopeHashes: scope.scopeSha256,
  });

  assert.equal(result.confirmedEmptyFields, 1);
  assert.equal(result.populatedFieldsSkipped, 1);
  assert.equal(result.updatedViews, 1);
  assert.equal(result.unchangedViews, 1);
  assert.equal(result.recordWrites, 0);
  assert.equal(result.schemaWrites, 0);
  assert.deepEqual(client.calls.updates, [{
    tableId: 'tblCustomerMkt',
    viewId: 'vewAll',
    hiddenFields: ['fldEmpty', 'fldExisting'],
  }]);
  assert.ok(client.calls.searches.every((call) => call.pageSize === 1
    && call.maxPages === 1
    && call.maxItems === 1
    && call.filter.conditions[0].operator === 'isNotEmpty'));
});

test('unreviewed scope hash fails before any Lark request', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  client.listFields = async () => { throw new Error('must not read'); };

  await assert.rejects(
    applyCustomerLarkViewHygiene({
      client,
      scope: { ...scope, scopeSha256: 'a'.repeat(64) },
      allowedScopeHashes: scope.scopeSha256,
    }),
    (error) => error.code === 'CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_FORBIDDEN',
  );
});

test('live schema drift fails before search or mutation', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  client.listFields = async () => [
    { fieldId: 'fldPrimary', fieldName: 'stable_key', isPrimary: true },
    { fieldId: 'fldEmpty', fieldName: 'renamed_metric', isPrimary: false },
    { fieldId: 'fldNowPopulated', fieldName: 'late_metric', isPrimary: false },
  ];

  await assert.rejects(
    applyCustomerLarkViewHygiene({ client, scope, allowedScopeHashes: scope.scopeSha256 }),
    (error) => error.code === 'CUSTOMER_LARK_VIEW_HYGIENE_SCHEMA_DRIFT',
  );
  assert.equal(client.calls.searches.length, 0);
  assert.equal(client.calls.updates.length, 0);
});

test('primary field can never be admitted as an empty-field candidate', async () => {
  const invalid = baseScope();
  invalid.candidateFields = [{ fieldId: 'fldPrimary', fieldName: 'stable_key' }];

  await assert.rejects(
    sha256CustomerLarkViewHygieneScope(invalid),
    (error) => error.code === 'CUSTOMER_LARK_VIEW_HYGIENE_PRIMARY_FIELD_FORBIDDEN',
  );
});

test('worker route admits only exact customer Production runtime with explicit feature flag', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  const job = {
    schemaVersion: 1,
    body: {
      schemaVersion: 1,
      type: JOB_TYPES.LARK_BASE_VIEW_HYGIENE,
      trigger: JOB_TRIGGERS.CUSTOMER_LARK_EMPTY_FIELDS,
      scope,
    },
  };
  const runtime = {
    environment: 'production',
    profileKey: 'chemistry_k',
    customerKey: 'chemistry_k',
    infrastructureOwner: 'customer',
  };

  const result = await processJob({
    job,
    env: {
      MKT_CUSTOMER_LARK_VIEW_HYGIENE_ENABLED: 'true',
      MKT_CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_SHA256S: scope.scopeSha256,
    },
    getRuntimeConfig: () => runtime,
    getInfrastructure: () => ({ getLarkBitableClient: () => client }),
  });
  assert.equal(result.ok, true);

  await assert.rejects(processJob({
    job,
    env: {
      MKT_CUSTOMER_LARK_VIEW_HYGIENE_ENABLED: 'true',
      MKT_CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_SHA256S: scope.scopeSha256,
    },
    getRuntimeConfig: () => ({ ...runtime, profileKey: 'integration_workspace' }),
    getInfrastructure: () => { throw new Error('must not initialize'); },
  }), (error) => error.code === 'CUSTOMER_LARK_VIEW_HYGIENE_FORBIDDEN');
});
