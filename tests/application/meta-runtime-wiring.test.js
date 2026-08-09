import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_TRIGGERS,
  JOB_TYPES,
  getJobDefinition,
} from '../../packages/application/src/jobs/job-catalog.js';
import { resolveQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';
import { processMetaEndToEndSync } from '../../packages/application/src/use-cases/process-meta-end-to-end-sync.js';

const REQUESTED_AT = Date.parse('2026-07-26T00:00:00Z');

function createWorkStore() {
  const phases = new Map();
  const units = new Map();
  let completion = null;
  let fingerprint = null;
  return {
    async beginWork(input) {
      if (completion) return { completed: true, completion, superseded: false, resumed: true };
      if (fingerprint && fingerprint !== input.operationFingerprint) {
        throw new Error('operation fingerprint mismatch');
      }
      fingerprint = input.operationFingerprint;
      return { completed: false, superseded: false, resumed: Boolean(phases.size) };
    },
    async loadPhase({ workKey, phase }) {
      return phases.get(`${workKey}:${phase}`) ?? null;
    },
    async savePhase(value) {
      const key = `${value.workKey}:${value.phase}`;
      const saved = structuredClone(value);
      phases.set(key, saved);
      if (value.unit) {
        const bySequence = units.get(key) ?? new Map();
        bySequence.set(value.unit.sequence, structuredClone(value.unit));
        units.set(key, bySequence);
      }
      return saved;
    },
    async listPhaseUnits({ workKey, phase, afterSequence = 0, limit }) {
      const key = `${workKey}:${phase}`;
      const values = [...(units.get(key)?.values() ?? [])]
        .filter((unit) => unit.sequence >= afterSequence)
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, limit);
      return {
        units: values,
        nextSequence: values.length === limit ? values.at(-1).sequence + 1 : null,
      };
    },
    async completeWork({ completion: value }) {
      completion = structuredClone(value);
      return true;
    },
  };
}

function createAdapter() {
  const empty = async () => ({ rows: [], hasMore: false, nextCursor: null });
  const inventoryForbidden = async () => {
    throw new Error('full inventory must not be called by report-range activity sync');
  };
  return {
    async fetchAccount() {
      return {
        resource: {
          id: 'act_123456',
          account_id: '123456',
          name: 'Fixture Meta Ads',
          status: 'ACTIVE',
          currency: 'THB',
          timezone_name: 'Asia/Bangkok',
        },
      };
    },
    fetchCampaignsPage: inventoryForbidden,
    fetchAdSetsPage: inventoryForbidden,
    fetchAdsPage: inventoryForbidden,
    fetchCreativesPage: inventoryForbidden,
    fetchDailyInsightsPage: empty,
  };
}

function createHistoryStore() {
  const writes = [];
  return {
    writes,
    async upsertOrganicAccountDailyFact(row) { writes.push(['account_daily', row]); return { status: 'written' }; },
    async upsertAdsEntityState(row) { writes.push(['ads_entity', row]); return { status: 'written' }; },
    async upsertAdsDailyFact(row) { writes.push(['ads_daily', row]); return { status: 'written' }; },
    async saveCoverageRun(row) { writes.push(['coverage_run', row]); return { status: 'written' }; },
    async saveCoverageEntities(rows) { writes.push(['coverage_entity', rows[0]]); return [{ status: 'written' }]; },
  };
}

const TABLES = Object.freeze({
  rawAdsEntities: 'tbl_raw_entities',
  rawAdsDaily: 'tbl_raw_daily',
  mktAdsAccounts: 'tbl_ads_accounts',
  mktAdsCampaigns: 'tbl_ads_campaigns',
  mktAdsAdGroups: 'tbl_ads_adgroups',
  mktAdsAds: 'tbl_ads',
  mktAdsCreatives: 'tbl_ads_creatives',
  mktAdsDaily: 'tbl_ads_daily',
});

const OPERATION = Object.freeze({
  operationId: 'meta-uat-001',
  workKey: 'meta_ads:chemistry_k2:meta-uat-001',
  generation: REQUESTED_AT,
  originalRequestedAt: REQUESTED_AT,
  stable: true,
});

function baseInput(overrides = {}) {
  return {
    connectorKey: 'meta_ads',
    jobType: JOB_TYPES.META_ADS_SYNC,
    operation: OPERATION,
    syncRunId: 'meta:meta-uat-001',
    cursorKey: 'integration_workspace:meta_ads:chemistry_k:manual_end_to_end',
    adapter: createAdapter(),
    sourceAccountId: '123456',
    accountKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    dateRange: { since: '2026-07-25', until: '2026-07-25' },
    limits: {
      sourceMaxPages: 10,
      sourceMaxUnits: 20,
      sourceMaxRows: 100,
      sourceMaxUnitBytes: 100_000,
      d1RowsPerInvocation: 2,
      larkTablesPerInvocation: 2,
    },
    assertLockActive: async () => undefined,
    ...overrides,
  };
}

test('registers reviewed Meta Organic and Ads jobs as active with stable operations', () => {
  for (const type of [JOB_TYPES.FACEBOOK_ORGANIC_SYNC, JOB_TYPES.INSTAGRAM_ORGANIC_SYNC]) {
    const definition = getJobDefinition(type);
    assert.equal(definition.implementationStatus, JOB_IMPLEMENTATION_STATUS.ACTIVE);
    assert.notEqual(definition.manualOnly, true);
    assert.deepEqual(definition.allowedTriggers, [
      JOB_TRIGGERS.META_MANUAL_UAT,
      JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
    ]);
    const operation = resolveQueueOperation({
      job: {
        body: {
          type,
          operationId: 'operation-1',
          requestedAt: '2026-07-26T00:00:00.000Z',
          generation: REQUESTED_AT,
        },
      },
    });
    assert.equal(operation.stable, true);
    assert.equal(operation.workKey, `${type.startsWith('facebook.') ? 'facebook' : 'instagram'}:operation-1`);
  }

  const ads = getJobDefinition(JOB_TYPES.META_ADS_SYNC);
  assert.equal(ads.implementationStatus, JOB_IMPLEMENTATION_STATUS.ACTIVE);
  assert.notEqual(ads.manualOnly, true);
  assert.deepEqual(ads.allowedTriggers, [
    JOB_TRIGGERS.META_MANUAL_UAT,
    JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
  ]);
  const adsOperation = resolveQueueOperation({
    job: {
      body: {
        type: JOB_TYPES.META_ADS_SYNC,
        sourceAccountKey: 'chemistry_k2',
        operationId: 'operation-1',
        requestedAt: '2026-07-26T00:00:00.000Z',
        generation: REQUESTED_AT,
      },
    },
  });
  assert.equal(adsOperation.stable, true);
  assert.equal(adsOperation.workKey, 'meta_ads:chemistry_k2:operation-1');
});

test('durably stages one Meta page per invocation, completes D1-only, then resumes Lark', async () => {
  const workStore = createWorkStore();
  const historyStore = createHistoryStore();
  const tableWrites = [];
  let result = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await processMetaEndToEndSync(baseInput({
      resumableWorkStore: workStore,
      historyStore,
      d1WriteEnabled: true,
      larkWriteEnabled: false,
    }));
    if (result.status === 'lark_gate_disabled') break;
  }

  assert.equal(result.status, 'lark_gate_disabled');
  assert.equal(result.continuationRequired, true);
  assert.ok(historyStore.writes.length > 0);
  assert.deepEqual(tableWrites, []);
  assert.equal(result.sourceSummary.campaignRows, 0);
  assert.equal(result.sourceSummary.dailyRows, 0);

  const syncEngine = {
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
      tableWrites.push(plan.tableId);
      return {
        created: plan.createRows.length,
        updated: 0,
        skipped: 0,
        duplicateInputRows: 0,
      };
    },
  };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await processMetaEndToEndSync(baseInput({
      resumableWorkStore: workStore,
      historyStore,
      d1WriteEnabled: true,
      larkWriteEnabled: true,
      repository: {},
      syncEngine,
      tables: TABLES,
    }));
    if (result.status === 'completed') break;
  }

  assert.equal(result.status, 'completed');
  assert.deepEqual(
    [...new Set(tableWrites)],
    ['tbl_ads_accounts', 'tbl_ads_campaigns', 'tbl_ads_adgroups', 'tbl_ads'],
  );
  const replay = await processMetaEndToEndSync(baseInput({
    resumableWorkStore: workStore,
    historyStore,
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    repository: {},
    syncEngine,
    tables: TABLES,
  }));
  assert.equal(replay.status, 'completed_idempotent');
});

test('forwards the reviewed period to Facebook content inventory staging', async () => {
  const workStore = createWorkStore();
  const contentCalls = [];
  const operation = Object.freeze({
    operationId: 'facebook-period-001',
    workKey: 'facebook:facebook-period-001',
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
    stable: true,
  });
  const input = baseInput({
    connectorKey: 'facebook',
    jobType: JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
    operation,
    syncRunId: 'meta:facebook:facebook-period-001',
    cursorKey: 'integration_workspace:facebook:chemistry_k:period',
    adapter: {
      async fetchAccount() {
        return { resource: { id: 'page_1', name: 'Fixture Page' } };
      },
      async fetchContentPage(value) {
        contentCalls.push(value);
        return { rows: [], hasMore: false, nextCursor: null };
      },
    },
    sourceAccountId: 'page_1',
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
    dateRange: { since: '2026-07-01', until: '2026-07-27' },
  });

  await processMetaEndToEndSync(input);
  await processMetaEndToEndSync(input);

  assert.equal(contentCalls.length, 1);
  assert.equal(contentCalls[0].since, '2026-07-01');
  assert.equal(contentCalls[0].until, '2026-07-27');
});


test('fails before another Provider call when the durable source-unit limit is reached', async () => {
  const workStore = createWorkStore();
  let calls = 0;
  const adapter = createAdapter();
  const countedAdapter = Object.fromEntries(Object.entries(adapter).map(([key, handler]) => [
    key,
    async (...args) => {
      calls += 1;
      return handler(...args);
    },
  ]));
  const input = baseInput({
    adapter: countedAdapter,
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
    limits: {
      sourceMaxPages: 10,
      sourceMaxUnits: 1,
      sourceMaxRows: 100,
      sourceMaxUnitBytes: 100_000,
      d1RowsPerInvocation: 2,
      larkTablesPerInvocation: 2,
    },
  });

  const first = await processMetaEndToEndSync(input);
  assert.equal(first.status, 'source_continuation');
  assert.equal(calls, 1);
  await assert.rejects(
    processMetaEndToEndSync(input),
    (error) => error.code === 'META_END_TO_END_SOURCE_UNIT_LIMIT',
  );
  assert.equal(calls, 1);
});

test('Meta Ads stages account then July insights and derives only activity entities', async () => {
  const workStore = createWorkStore();
  const calls = [];
  const adapter = createAdapter();
  adapter.fetchDailyInsightsPage = async (input) => {
    calls.push(input);
    return {
      rows: [{
        account_id: '123456',
        account_currency: 'THB',
        campaign_id: 'campaign_1',
        campaign_name: 'July Campaign',
        objective: 'OUTCOME_TRAFFIC',
        adset_id: 'adset_1',
        adset_name: 'July Ad Set',
        ad_id: 'ad_1',
        ad_name: 'July Ad',
        date_start: '2026-07-25',
        date_stop: '2026-07-25',
        publisher_platform: 'facebook',
        spend: '1.000000',
        impressions: '10',
        reach: '8',
        clicks: '2',
      }],
      hasMore: false,
      nextCursor: null,
    };
  };
  const input = baseInput({
    adapter,
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
  });

  assert.equal((await processMetaEndToEndSync(input)).status, 'source_continuation');
  const result = await processMetaEndToEndSync(input);
  assert.equal(result.status, 'source_validated');
  assert.deepEqual(result.sourceSummary, {
    accountRows: 1,
    campaignRows: 1,
    adSetRows: 1,
    adRows: 1,
    creativeRows: 0,
    dailyRows: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].since, '2026-07-25');
  assert.equal(calls[0].until, '2026-07-25');
});

test('Meta Ads rejects more than 31 inclusive days before Provider access', async () => {
  let calls = 0;
  const adapter = createAdapter();
  adapter.fetchAccount = async () => {
    calls += 1;
    return { resource: {} };
  };
  await assert.rejects(
    processMetaEndToEndSync(baseInput({
      adapter,
      resumableWorkStore: createWorkStore(),
      sourceReadOnly: true,
      d1WriteEnabled: false,
      dateRange: { since: '2026-05-01', until: '2026-07-31' },
    })),
    (error) => error.code === 'META_ADS_REPORT_RANGE_TOO_LARGE',
  );
  assert.equal(calls, 0);
});
