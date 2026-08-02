import test from 'node:test';
import assert from 'node:assert/strict';
import { processMetaEndToEndGeneration } from '../../packages/application/src/use-cases/process-meta-end-to-end-generation.js';

function createWorkStore() {
  const phases = new Map();
  let completions = 0;
  return {
    phases,
    get completions() { return completions; },
    async loadPhase({ workKey, phase }) {
      return phases.get(`${workKey}:${phase}`) ?? null;
    },
    async savePhase(value) {
      const saved = structuredClone(value);
      phases.set(`${value.workKey}:${value.phase}`, saved);
      return saved;
    },
    async completeWork() {
      completions += 1;
    },
  };
}

function writeSet() {
  return {
    operationId: 'meta_operation_1',
    connectorKey: 'meta_ads',
    context: {
      customerKey: 'chemistry_k',
      platform: 'meta_ads',
      accountKey: 'chemistry_k_meta_ads',
      sourceAccountId: '987650001',
      sourceTimezone: 'Asia/Bangkok',
      fetchedAt: 1784829780000,
      syncRunId: 'sync_1',
      sourceRevision: 'revision_1',
    },
    raw: {
      organicAccounts: [], organicContent: [], organicMetrics: [],
      adsEntities: [{ raw_ads_entity_key: 'meta_ads:987650001:account:987650001' }],
      adsDaily: [],
    },
    canonical: {
      accounts: [], accountDaily: [], content: [], contentDaily: [],
      adsAccounts: [{ ads_account_key: 'meta_ads:987650001:account:987650001' }],
      adsCampaigns: [], adsAdGroups: [], adsAds: [], adsCreatives: [], adsDaily: [],
    },
    d1: {
      organicHistoryBatch: null,
      accountDailyFacts: [],
      adsEntities: [],
      adsDailyFacts: [],
      coverageRuns: [{ coverage_run_id: 'coverage_1' }, { coverage_run_id: 'coverage_2' }],
      coverageEntities: [],
    },
    reconciliation: { sourceStatus: 'no_data_confirmed' },
  };
}

const TABLES = {
  rawAdsEntities: 'tbl_raw_entities',
  rawAdsDaily: 'tbl_raw_daily',
  mktAdsAccounts: 'tbl_accounts',
  mktAdsCampaigns: 'tbl_campaigns',
  mktAdsAdGroups: 'tbl_adgroups',
  mktAdsAds: 'tbl_ads',
  mktAdsCreatives: 'tbl_creatives',
  mktAdsDaily: 'tbl_daily',
};

test('durably resumes D1 and Lark phases without owning Queue retry or DLQ', async () => {
  const workStore = createWorkStore();
  const writes = [];
  const historyStore = {
    async upsertOrganicAccountDailyFact(row) { writes.push(['account_daily', row]); return { status: 'written' }; },
    async upsertAdsEntityState(row) { writes.push(['ads_entity', row]); return { status: 'written' }; },
    async upsertAdsDailyFact(row) { writes.push(['ads_daily', row]); return { status: 'written' }; },
    async saveCoverageRun(row) { writes.push(['coverage_run', row]); return { status: 'written' }; },
    async saveCoverageEntities(rows) { writes.push(['coverage_entity', rows[0]]); return [{ status: 'written' }]; },
  };
  const tableWrites = [];
  const syncEngine = {
    async planByKey({ tableId, keyField, rows }) {
      return {
        tableId,
        keyField,
        inputRows: rows.length,
        createRows: rows,
        updateRows: [],
        skipped: 0,
        duplicateInputRows: 0,
      };
    },
    async executePlan(plan) {
      tableWrites.push(plan.tableId);
      return { created: plan.createRows.length, updated: 0, skipped: 0, duplicateInputRows: 0 };
    },
  };
  let lockChecks = 0;
  const input = {
    writeSet: writeSet(),
    resumableWorkStore: workStore,
    historyStore,
    repository: {},
    syncEngine,
    tables: TABLES,
    workKey: 'meta:work:1',
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    maxD1RowsPerInvocation: 1,
    maxLarkTablesPerInvocation: 2,
    assertLockActive: async () => { lockChecks += 1; },
  };

  const d1OnlyStatuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await processMetaEndToEndGeneration(input);
    d1OnlyStatuses.push(result.status);
    if (result.status === 'lark_gate_disabled') break;
  }
  assert.ok(d1OnlyStatuses.includes('d1_continuation'));
  assert.equal(d1OnlyStatuses.at(-1), 'lark_gate_disabled');
  assert.deepEqual(writes.map(([kind]) => kind), ['coverage_run', 'coverage_run']);
  assert.equal(tableWrites.length, 0);
  input.larkWriteEnabled = true;

  const statuses = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await processMetaEndToEndGeneration(input);
    statuses.push(result.status);
    if (result.status === 'completed') break;
  }

  assert.deepEqual(writes.map(([kind]) => kind), ['coverage_run', 'coverage_run']);
  assert.deepEqual(
    [...new Set(tableWrites)],
    ['tbl_accounts', 'tbl_campaigns', 'tbl_adgroups', 'tbl_ads'],
  );
  assert.equal(workStore.completions, 1);
  assert.ok(statuses.includes('lark_continuation'));
  assert.equal(statuses.at(-1), 'completed');
  assert.ok(lockChecks > 4);

  const replay = await processMetaEndToEndGeneration(input);
  assert.equal(replay.status, 'completed_idempotent');
  assert.equal(writes.length, 2);
  assert.equal(workStore.completions, 1);
});

test('fails closed when workstream write gates remain false', async () => {
  await assert.rejects(
    processMetaEndToEndGeneration({
      writeSet: writeSet(),
      resumableWorkStore: createWorkStore(),
      historyStore: {
        upsertOrganicAccountDailyFact() {}, upsertAdsEntityState() {}, upsertAdsDailyFact() {},
        saveCoverageRun() {}, saveCoverageEntities() {},
      },
      repository: {},
      syncEngine: { planByKey() {}, executePlan() {} },
      tables: TABLES,
      workKey: 'meta:work:disabled',
      d1WriteEnabled: false,
      larkWriteEnabled: false,
    }),
    (error) => error.code === 'META_END_TO_END_PROCESSING_GATES_DISABLED',
  );
});
