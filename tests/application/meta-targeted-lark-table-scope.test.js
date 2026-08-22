import test from 'node:test';
import assert from 'node:assert/strict';
import { processMetaEndToEndGeneration } from '../../packages/application/src/use-cases/process-meta-end-to-end-generation.js';

function createWorkStore() {
  const phases = new Map();
  let completion = null;
  return {
    async loadPhase({ workKey, phase }) {
      return phases.get(`${workKey}:${phase}`) ?? null;
    },
    async savePhase(value) {
      const saved = structuredClone(value);
      phases.set(`${value.workKey}:${value.phase}`, saved);
      return saved;
    },
    async completeWork({ completion: value }) {
      completion = structuredClone(value);
      return completion;
    },
  };
}

function createHistoryStore() {
  return {
    async upsertOrganicAccountDailyFact() { return { status: 'skipped' }; },
    async upsertAdsEntityState() { return { status: 'skipped' }; },
    async upsertAdsDailyFact() { return { status: 'skipped' }; },
    async saveCoverageRun() { return { status: 'skipped' }; },
    async saveCoverageEntities() { return [{ status: 'skipped' }]; },
  };
}

function createWriteSet() {
  return {
    operationId: 'meta-targeted-lark-001',
    connectorKey: 'meta_ads',
    raw: {},
    canonical: {
      adsAccounts: [{ ads_account_key: 'meta_ads:account:1' }],
      adsCampaigns: [{ ads_campaign_key: 'meta_ads:campaign:1' }],
      adsAdGroups: [{ ads_ad_group_key: 'meta_ads:ad_group:1' }],
      adsAds: [{ ads_ad_key: 'meta_ads:ad:1' }],
      adsCreatives: [{ ads_creative_key: 'meta_ads:creative:1' }],
      adsDaily: [{ ads_daily_key: 'meta_ads:daily:1' }],
    },
    d1: {
      organicHistoryBatch: null,
      accountDailyFacts: [],
      adsEntities: [],
      adsDailyFacts: [],
      coverageRuns: [],
      coverageEntities: [],
    },
    context: {},
    reconciliation: {
      larkProjectionMode: 'curated_reports',
    },
  };
}

const TABLES = Object.freeze({
  mktAdsAccounts: 'tbl_ads_accounts',
  mktAdsCampaigns: 'tbl_ads_campaigns',
  mktAdsAdGroups: 'tbl_ads_adgroups',
  mktAdsAds: 'tbl_ads',
  mktAdsCreatives: 'tbl_ads_creatives',
  mktAdsDaily: 'tbl_ads_daily',
});

function createSyncEngine(executedTableIds) {
  return {
    async planByKey({ tableId, keyField, rows }) {
      return {
        tableId,
        keyField,
        createRows: rows,
        updateRows: [],
        skipped: 0,
        duplicateInputRows: 0,
      };
    },
    async executePlan(plan) {
      executedTableIds.push(plan.tableId);
      return {
        created: plan.createRows.length,
        updated: 0,
        skipped: 0,
        duplicateInputRows: 0,
      };
    },
  };
}

function baseInput(tableScope) {
  const executedTableIds = [];
  return {
    executedTableIds,
    input: {
      writeSet: createWriteSet(),
      resumableWorkStore: createWorkStore(),
      historyStore: createHistoryStore(),
      repository: {},
      syncEngine: createSyncEngine(executedTableIds),
      tables: {
        ...TABLES,
        __metaLarkTableKeys: tableScope,
      },
      workKey: 'meta_ads:chemistry_k2:meta-targeted-lark-001',
      d1WriteEnabled: true,
      larkWriteEnabled: true,
      maxD1RowsPerInvocation: 250,
      maxLarkTablesPerInvocation: 4,
      assertLockActive: async () => undefined,
    },
  };
}

test('Meta Ads targeted Lark scope plans and writes only Creatives and Daily', async () => {
  const { input, executedTableIds } = baseInput(['mktAdsCreatives', 'mktAdsDaily']);
  const result = await processMetaEndToEndGeneration(input);

  assert.equal(result.status, 'completed');
  assert.deepEqual(executedTableIds, ['tbl_ads_creatives', 'tbl_ads_daily']);
  assert.deepEqual(
    result.reconciliation.lark.map((entry) => entry.tableKey),
    ['mktAdsCreatives', 'mktAdsDaily'],
  );
  assert.equal(executedTableIds.includes('tbl_ads_adgroups'), false);
  assert.equal(executedTableIds.includes('tbl_ads_accounts'), false);
  assert.equal(executedTableIds.includes('tbl_ads_campaigns'), false);
  assert.equal(executedTableIds.includes('tbl_ads'), false);
});

test('Meta Ads targeted Lark scope rejects an organic table before planning', async () => {
  const { input, executedTableIds } = baseInput(['mktAdsCreatives', 'mktContent']);
  await assert.rejects(
    processMetaEndToEndGeneration(input),
    (error) => error.code === 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
  );
  assert.deepEqual(executedTableIds, []);
});

test('Meta Ads targeted Lark scope rejects duplicate table keys before planning', async () => {
  const { input, executedTableIds } = baseInput(['mktAdsDaily', 'mktAdsDaily']);
  await assert.rejects(
    processMetaEndToEndGeneration(input),
    (error) => error.code === 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
  );
  assert.deepEqual(executedTableIds, []);
});