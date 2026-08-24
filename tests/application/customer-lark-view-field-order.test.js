import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_LARK_VIEW_FIELD_ORDER_VERSION,
  CUSTOMER_LARK_VIEW_HYGIENE_FOLDER,
  applyCustomerLarkViewFieldOrder,
  orderCustomerLarkFieldsForDisplay,
  sha256CustomerLarkViewFieldOrderScope,
} from '../../packages/application/src/use-cases/apply-customer-lark-view-hygiene.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { processJob } from '../../apps/sync-worker/src/active-job-router.js';

const RAW_FIELDS = Object.freeze([
  { fieldId: 'fldSpend', fieldName: 'spend', fieldType: 2 },
  { fieldId: 'fldRun', fieldName: 'sync_run_id', fieldType: 1 },
  { fieldId: 'fldPlatform', fieldName: 'platform', fieldType: 3 },
  { fieldId: 'fldPrimary', fieldName: 'ads_daily_key', fieldType: 1 },
  { fieldId: 'fldDate', fieldName: 'metric_date', fieldType: 1 },
  { fieldId: 'fldName', fieldName: 'account_name', fieldType: 1 },
  { fieldId: 'fldStatus', fieldName: 'data_status', fieldType: 3 },
  { fieldId: 'fldUrl', fieldName: 'landing_page_url', fieldType: 15 },
  { fieldId: 'fldCampaign', fieldName: 'external_campaign_id', fieldType: 1 },
  { fieldId: 'fldConversions', fieldName: 'conversions', fieldType: 2 },
]);

function baseScope() {
  return {
    version: CUSTOMER_LARK_VIEW_FIELD_ORDER_VERSION,
    folderName: CUSTOMER_LARK_VIEW_HYGIENE_FOLDER,
    tableId: 'tblCustomerMkt',
    tableName: '📈 MKT_Ads_Daily',
    primaryFieldId: 'fldPrimary',
    orderedFields: orderCustomerLarkFieldsForDisplay({
      fields: RAW_FIELDS,
      primaryFieldId: 'fldPrimary',
    }),
    views: [
      { viewId: 'vewAll', viewName: 'All Records', viewType: 'grid' },
      { viewId: 'vewPaid', viewName: 'Paid only', viewType: 'grid' },
    ],
  };
}

async function reviewedScope(overrides = {}) {
  const scope = { ...baseScope(), ...overrides };
  return { ...scope, scopeSha256: await sha256CustomerLarkViewFieldOrderScope(scope) };
}

function fakeClient() {
  const visible = new Map([
    ['vewAll', ['ads_daily_key', 'spend', 'account_name', 'metric_date', 'platform', 'data_status', 'landing_page_url']],
    ['vewPaid', ['ads_daily_key', 'platform', 'metric_date', 'spend']],
  ]);
  const calls = { sets: [] };
  return {
    calls,
    async listFields() {
      return RAW_FIELDS.map((field) => ({
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        type: field.fieldType,
        isPrimary: field.fieldId === 'fldPrimary',
      }));
    },
    async listViews() {
      return [
        { viewId: 'vewAll', viewName: 'All Records', viewType: 'grid' },
        { viewId: 'vewPaid', viewName: 'Paid only', viewType: 'grid' },
      ];
    },
    async getViewVisibleFields({ viewId }) { return [...visible.get(viewId)]; },
    async setViewVisibleFields({ viewId, visibleFields, ...rest }) {
      calls.sets.push({ viewId, visibleFields, ...rest });
      visible.set(viewId, [...visibleFields]);
    },
  };
}

test('plans a customer-friendly semantic field order with the primary field first', () => {
  assert.deepEqual(baseScope().orderedFields.map((field) => field.fieldName), [
    'ads_daily_key',
    'account_name',
    'platform',
    'metric_date',
    'data_status',
    'spend',
    'conversions',
    'landing_page_url',
    'external_campaign_id',
    'sync_run_id',
  ]);
});

test('reorders only currently visible fields and proves exact readback', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  const result = await applyCustomerLarkViewFieldOrder({
    client,
    scope,
    allowedScopeHashes: scope.scopeSha256,
  });

  assert.equal(result.updatedViews, 1);
  assert.equal(result.unchangedViews, 1);
  assert.equal(result.recordWrites, 0);
  assert.equal(result.schemaWrites, 0);
  assert.deepEqual(client.calls.sets, [{
    tableId: 'tblCustomerMkt',
    viewId: 'vewAll',
    visibleFields: [
      'ads_daily_key',
      'account_name',
      'platform',
      'metric_date',
      'data_status',
      'spend',
      'landing_page_url',
    ],
  }]);
});

test('rejects an unreviewed field-order scope before any Lark read', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  client.listFields = async () => { throw new Error('must not read'); };
  await assert.rejects(
    applyCustomerLarkViewFieldOrder({
      client,
      scope: { ...scope, scopeSha256: 'a'.repeat(64) },
      allowedScopeHashes: scope.scopeSha256,
    }),
    (error) => error.code === 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_FORBIDDEN',
  );
});

test('fails closed on Live field-schema drift before any View mutation', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  client.listFields = async () => [
    ...(await fakeClient().listFields()),
    { fieldId: 'fldUnexpected', fieldName: 'unexpected', type: 1, isPrimary: false },
  ];
  await assert.rejects(
    applyCustomerLarkViewFieldOrder({ client, scope, allowedScopeHashes: scope.scopeSha256 }),
    (error) => error.code === 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCHEMA_DRIFT',
  );
  assert.equal(client.calls.sets.length, 0);
});

test('fails closed when the exact Grid view set drifts before any View mutation', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  client.listViews = async () => [
    ...(await fakeClient().listViews()),
    { viewId: 'vewExtra', viewName: 'Unreviewed', viewType: 'grid' },
  ];
  await assert.rejects(
    applyCustomerLarkViewFieldOrder({ client, scope, allowedScopeHashes: scope.scopeSha256 }),
    (error) => error.code === 'CUSTOMER_LARK_VIEW_FIELD_ORDER_SCHEMA_DRIFT',
  );
  assert.equal(client.calls.sets.length, 0);
});

test('worker route admits field ordering only in exact Customer Production with its own flag', async () => {
  const scope = await reviewedScope();
  const client = fakeClient();
  const job = {
    schemaVersion: 1,
    body: {
      schemaVersion: 1,
      type: JOB_TYPES.LARK_BASE_VIEW_FIELD_ORDER,
      trigger: JOB_TRIGGERS.CUSTOMER_LARK_FIELD_ORDER,
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
      MKT_CUSTOMER_LARK_VIEW_FIELD_ORDER_ENABLED: 'true',
      MKT_CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_SHA256S: scope.scopeSha256,
    },
    getRuntimeConfig: () => runtime,
    getInfrastructure: () => ({ getLarkBitableClient: () => client }),
  });
  assert.equal(result.ok, true);

  await assert.rejects(processJob({
    job,
    env: {
      MKT_CUSTOMER_LARK_VIEW_FIELD_ORDER_ENABLED: 'true',
      MKT_CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_SHA256S: scope.scopeSha256,
    },
    getRuntimeConfig: () => ({ ...runtime, environment: 'development' }),
    getInfrastructure: () => { throw new Error('must not initialize'); },
  }), (error) => error.code === 'CUSTOMER_LARK_VIEW_HYGIENE_FORBIDDEN');
});
