import test from 'node:test';
import assert from 'node:assert/strict';
import { processJob } from '../../apps/sync-worker/src/index.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  CUSTOMER_META_K2_SNAPSHOT_ID,
  CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
  importCustomerMetaK2LarkSnapshot,
  listCustomerMetaK2LarkImportContracts,
  projectCustomerMetaK2RowsForLark,
} from '../../packages/application/src/use-cases/import-customer-meta-k2-lark-snapshot.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../packages/shared/src/date/date-time.js';

function creativeRows() {
  return Array.from({ length: 50 }, (_, index) => {
    const creativeId = String(10_000 + index);
    return {
      account_id: CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
      ads_creative_key: `meta_ads:${CUSTOMER_META_K2_SOURCE_ACCOUNT_ID}:creative:${creativeId}`,
      creative_name: `Creative ${index}`,
      creative_type: 'IMAGE',
      external_creative_id: creativeId,
      platform: 'meta_ads',
    };
  });
}

function validBody(overrides = {}) {
  const contract = listCustomerMetaK2LarkImportContracts().mktAdsCreatives;
  return {
    snapshotId: CUSTOMER_META_K2_SNAPSHOT_ID,
    sourceAccountId: CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
    tableKey: 'mktAdsCreatives',
    batchIndex: 0,
    batchCount: contract.batchCount,
    totalRows: contract.totalRows,
    batchFingerprint: contract.batchFingerprints[0],
    rows: creativeRows(),
    ...overrides,
  };
}

function dailyRows(metricDate = '2026-07-24') {
  const metricDateEpoch = dateOnlyInTimeZoneToEpochMilliseconds(metricDate, 'Asia/Bangkok');
  return Array.from({ length: 50 }, (_, index) => {
    const externalEntityId = String(20_000 + index);
    return {
      account_id: CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
      ads_daily_key: `meta_ads:${CUSTOMER_META_K2_SOURCE_ACCOUNT_ID}:ad:${externalEntityId}:${metricDate}`,
      entity_type: 'ad',
      external_entity_id: externalEntityId,
      metric_date: metricDateEpoch,
      platform: 'meta_ads',
    };
  });
}

function fakeSyncEngine(result) {
  const calls = [];
  return {
    calls,
    async planByKey(input) {
      calls.push({ stage: 'plan', ...input });
      return { duplicateInputRows: 0, marker: 'plan' };
    },
    async executePlan(plan) {
      calls.push({ stage: 'execute', plan });
      return result;
    },
  };
}

test('exact Customer K2 batch writes only its reviewed table and reconciles', async () => {
  const contract = listCustomerMetaK2LarkImportContracts().mktAdsCreatives;
  const syncEngine = fakeSyncEngine({ created: 50, updated: 0, skipped: 0, duplicateInputRows: 0 });
  const result = await importCustomerMetaK2LarkSnapshot({
    body: validBody(),
    repository: { marker: 'repository' },
    syncEngine,
    tables: { mktAdsCreatives: 'tbl_customer_creatives' },
    createFingerprint: async () => contract.batchFingerprints[0],
  });
  assert.equal(syncEngine.calls[0].tableId, 'tbl_customer_creatives');
  assert.equal(syncEngine.calls[0].keyField, 'ads_creative_key');
  assert.equal(syncEngine.calls[0].rows.length, 50);
  assert.deepEqual(result.reconciliation, [{
    tableKey: 'mktAdsCreatives',
    batchIndex: 0,
    expected: 50,
    created: 50,
    updated: 0,
    skipped: 0,
    duplicateInputRows: 0,
  }]);
});

test('idempotent Customer K2 replay may skip the complete exact batch', async () => {
  const contract = listCustomerMetaK2LarkImportContracts().mktAdsCreatives;
  const syncEngine = fakeSyncEngine({ created: 0, updated: 0, skipped: 50, duplicateInputRows: 0 });
  const result = await importCustomerMetaK2LarkSnapshot({
    body: validBody(),
    repository: {},
    syncEngine,
    tables: { mktAdsCreatives: 'tbl_customer_creatives' },
    createFingerprint: async () => contract.batchFingerprints[0],
  });
  assert.equal(result.reconciliation[0].skipped, 50);
});

test('Customer K2 Daily accepts the canonical Bangkok epoch represented by its stable key date', async () => {
  const contract = listCustomerMetaK2LarkImportContracts().mktAdsDaily;
  const syncEngine = fakeSyncEngine({ created: 50, updated: 0, skipped: 0, duplicateInputRows: 0 });
  await importCustomerMetaK2LarkSnapshot({
    body: {
      snapshotId: CUSTOMER_META_K2_SNAPSHOT_ID,
      sourceAccountId: CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
      tableKey: 'mktAdsDaily',
      batchIndex: 0,
      batchCount: contract.batchCount,
      totalRows: contract.totalRows,
      batchFingerprint: contract.batchFingerprints[0],
      rows: dailyRows(),
    },
    repository: {},
    syncEngine,
    tables: { mktAdsDaily: 'tbl_customer_daily' },
    createFingerprint: async () => contract.batchFingerprints[0],
  });
  assert.equal(syncEngine.calls[0].rows[0].metric_date, 1_784_826_000_000);
});

test('Customer K2 Daily rejects epoch drift before planning Lark writes', async () => {
  const contract = listCustomerMetaK2LarkImportContracts().mktAdsDaily;
  const syncEngine = fakeSyncEngine({ created: 50, updated: 0, skipped: 0 });
  const rows = dailyRows();
  rows[0] = { ...rows[0], metric_date: rows[0].metric_date + 86_400_000 };
  await assert.rejects(
    () => importCustomerMetaK2LarkSnapshot({
      body: {
        snapshotId: CUSTOMER_META_K2_SNAPSHOT_ID,
        sourceAccountId: CUSTOMER_META_K2_SOURCE_ACCOUNT_ID,
        tableKey: 'mktAdsDaily',
        batchIndex: 0,
        batchCount: contract.batchCount,
        totalRows: contract.totalRows,
        batchFingerprint: contract.batchFingerprints[0],
        rows,
      },
      repository: {},
      syncEngine,
      tables: { mktAdsDaily: 'tbl_customer_daily' },
      createFingerprint: async () => contract.batchFingerprints[0],
    }),
    (error) => error?.code === 'CUSTOMER_META_K2_LARK_IMPORT_INVALID',
  );
  assert.equal(syncEngine.calls.length, 0);
});

test('Customer K2 import rejects fingerprint drift before planning Lark writes', async () => {
  const syncEngine = fakeSyncEngine({ created: 50, updated: 0, skipped: 0 });
  await assert.rejects(
    () => importCustomerMetaK2LarkSnapshot({
      body: validBody(),
      repository: {},
      syncEngine,
      tables: { mktAdsCreatives: 'tbl_customer_creatives' },
      createFingerprint: async () => '0'.repeat(64),
    }),
    (error) => error?.code === 'CUSTOMER_META_K2_LARK_IMPORT_INVALID',
  );
  assert.equal(syncEngine.calls.length, 0);
});

test('Customer K2 import rejects foreign account, table and fields', async () => {
  const contract = listCustomerMetaK2LarkImportContracts().mktAdsCreatives;
  const base = {
    repository: {},
    syncEngine: fakeSyncEngine({}),
    tables: { mktAdsCreatives: 'tbl_customer_creatives' },
    createFingerprint: async () => contract.batchFingerprints[0],
  };
  for (const body of [
    validBody({ sourceAccountId: 'foreign' }),
    validBody({ tableKey: 'mktAdsAds' }),
    validBody({ rows: creativeRows().map((row, index) => (
      index === 0 ? { ...row, foreign_field: 'forbidden' } : row
    )) }),
  ]) {
    await assert.rejects(
      () => importCustomerMetaK2LarkSnapshot({ ...base, body }),
      (error) => error?.code === 'CUSTOMER_META_K2_LARK_IMPORT_INVALID',
    );
  }
});

test('Customer K2 Daily projection preserves reviewed channels and omits unsupported values', () => {
  const projected = projectCustomerMetaK2RowsForLark('mktAdsDaily', [
    { ad_channel: 'facebook_ads', id: 1 },
    { ad_channel: 'audience_network_ads', id: 2 },
    { ad_channel: null, id: 3 },
  ]);
  assert.equal(projected[0].ad_channel, 'facebook_ads');
  assert.equal(Object.hasOwn(projected[1], 'ad_channel'), false);
  assert.equal(Object.hasOwn(projected[2], 'ad_channel'), false);
});

test('Worker route rejects disabled mode and foreign runtime before Lark initialization', async () => {
  const job = {
    body: {
      schemaVersion: 1,
      type: JOB_TYPES.CUSTOMER_META_K2_LARK_SNAPSHOT_IMPORT,
      trigger: JOB_TRIGGERS.CUSTOMER_META_K2_SNAPSHOT_IMPORT,
      tableKey: 'mktAdsCreatives',
    },
  };
  const runtime = {
    environment: 'production',
    profileKey: 'chemistry_k',
    customerKey: 'chemistry_k',
    infrastructureOwner: 'customer',
  };
  await assert.rejects(processJob({
    job,
    env: {},
    getRuntimeConfig: () => runtime,
    getInfrastructure: () => { throw new Error('must not initialize'); },
  }), (error) => error.code === 'CUSTOMER_META_K2_LARK_IMPORT_DISABLED');

  await assert.rejects(processJob({
    job,
    env: { MKT_CUSTOMER_META_K2_LARK_IMPORT_MODE: 'IMPORT_EXACT_K2_RECENT_MONTH_SNAPSHOT' },
    getRuntimeConfig: () => ({ ...runtime, profileKey: 'integration_workspace' }),
    getInfrastructure: () => { throw new Error('must not initialize'); },
  }), (error) => error.code === 'CUSTOMER_META_K2_LARK_IMPORT_FORBIDDEN');
});
