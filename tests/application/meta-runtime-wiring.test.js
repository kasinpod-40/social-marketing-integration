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
    fetchCreativesPage: empty,
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
    [
      'tbl_ads_accounts',
      'tbl_ads_campaigns',
      'tbl_ads_adgroups',
      'tbl_ads',
      'tbl_ads_creatives',
      'tbl_ads_daily',
    ],
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

test('compacts completed Meta Ads source units in bounded post-source deliveries before building the write set', async () => {
  const workStore = createWorkStore();
  const sourceUnits = [
    {
      datasetKey: 'meta_ads.account.latest',
      rows: [{
        id: 'act_123456', account_id: '123456', name: 'Fixture Meta Ads', status: 'ACTIVE',
        currency: 'THB', timezone_name: 'Asia/Bangkok', unused_blob: 'x'.repeat(50_000),
      }],
    },
    {
      datasetKey: 'meta_ads.creatives.inventory',
      rows: [{ id: 'creative_1', name: 'Creative 1', object_story_spec: { body: 'x'.repeat(50_000) } }],
    },
    {
      datasetKey: 'meta_ads.creatives.inventory',
      rows: [{ id: 'creative_2', name: 'Creative 2', asset_feed_spec: { bodies: ['x'.repeat(50_000)] } }],
    },
    {
      datasetKey: 'meta_ads.performance.daily',
      rows: [{
        account_id: '123456', account_currency: 'THB', campaign_id: 'campaign_1',
        campaign_name: 'Campaign 1', objective: 'OUTCOME_TRAFFIC', adset_id: 'adset_1',
        adset_name: 'Ad Set 1', ad_id: 'ad_1', ad_name: 'Ad 1', date_start: '2026-07-25',
        date_stop: '2026-07-25', publisher_platform: 'facebook', spend: '1.000000',
        impressions: '10', reach: '8', clicks: '2', actions: [{ action_type: 'link_click', value: '2' }],
      }],
    },
  ];
  for (const [sequence, unit] of sourceUnits.entries()) {
    await workStore.savePhase({
      workKey: OPERATION.workKey,
      phase: 'meta_end_to_end_source_staging_v1',
      state: {
        stage: 'complete', pageState: null, contentIds: [], contentIndex: 0,
        unitCount: sourceUnits.length, rowCount: 4, sourceWatermark: 'watermark-1',
      },
      expectedItems: sourceUnits.length,
      processedItems: sourceUnits.length,
      pagesProcessed: sourceUnits.length,
      chunksProcessed: sourceUnits.length,
      complete: true,
      unit: {
        unitKey: `source:${sequence}`,
        sequence,
        payload: {
          schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
          sourceEntityId: null,
          sourceStatus: 'available',
          sourceWatermark: 'watermark-1',
          pageNumber: sequence + 1,
          ...unit,
        },
      },
    });
  }
  const historyStore = createHistoryStore();
  const input = baseInput({
    resumableWorkStore: workStore,
    historyStore,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    limits: {
      ...baseInput().limits,
      postSourceUnitsPerInvocation: 2,
      d1RowsPerInvocation: 100,
    },
  });

  const first = await processMetaEndToEndSync(input);
  assert.equal(first.status, 'materialization_continuation');
  assert.equal(first.materializedUnits, 2);
  const firstPage = await workStore.listPhaseUnits({
    workKey: OPERATION.workKey,
    phase: 'meta_ads_post_source_materialization_v2',
    afterSequence: 0,
    limit: 10,
  });
  assert.equal(firstPage.units.length, 2);
  assert.equal(JSON.stringify(firstPage.units).includes('unused_blob'), false);
  assert.equal(JSON.stringify(firstPage.units).includes('object_story_spec'), false);

  const second = await processMetaEndToEndSync(input);
  assert.equal(second.status, 'materialization_continuation');
  assert.equal(second.materializedUnits, 4);
  assert.equal(second.complete, true);
  const compact = await workStore.listPhaseUnits({
    workKey: OPERATION.workKey,
    phase: 'meta_ads_post_source_materialization_v2',
    afterSequence: 0,
    limit: 10,
  });
  assert.equal(compact.units.length, 4);
  assert.match(compact.units[0].payload.rows[0].__entity_metadata_hash, /^[a-f0-9]{64}$/u);
  assert.match(compact.units[1].payload.rows[0].__entity_metadata_hash, /^[a-f0-9]{64}$/u);
  assert.match(compact.units[3].payload.rows[0].__source_payload_hash, /^[a-f0-9]{64}$/u);

  const third = await processMetaEndToEndSync(input);
  assert.notEqual(third.status, 'materialization_continuation');
  assert.deepEqual(third.sourceSummary, {
    accountRows: 1,
    campaignRows: 1,
    adSetRows: 1,
    adRows: 1,
    creativeRows: 2,
    dailyRows: 1,
  });
  const creativeWrite = historyStore.writes.find(
    ([kind, row]) => kind === 'ads_entity' && row.external_entity_id === 'creative_1',
  );
  assert.equal(
    creativeWrite?.[1]?.metadata_hash,
    compact.units[1].payload.rows[0].__entity_metadata_hash,
  );
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

test('forwards the reviewed period to Instagram content inventory staging', async () => {
  const workStore = createWorkStore();
  const contentCalls = [];
  const operation = Object.freeze({
    operationId: 'instagram-period-001',
    workKey: 'instagram:instagram-period-001',
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
    stable: true,
  });
  const input = baseInput({
    connectorKey: 'instagram',
    jobType: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    operation,
    syncRunId: 'meta:instagram:instagram-period-001',
    cursorKey: 'integration_workspace:instagram:chemistry_k:period',
    adapter: {
      async fetchAccount() {
        return { resource: { id: 'instagram_1', name: 'Fixture Instagram' } };
      },
      async fetchContentPage(value) {
        contentCalls.push(value);
        return { rows: [], hasMore: false, nextCursor: null };
      },
    },
    sourceAccountId: 'instagram_1',
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
    dateRange: { since: '2026-07-26', until: '2026-07-26' },
  });

  await processMetaEndToEndSync(input);
  await processMetaEndToEndSync(input);

  assert.equal(contentCalls.length, 1);
  assert.equal(contentCalls[0].since, '2026-07-26');
  assert.equal(contentCalls[0].until, '2026-07-26');
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

test('accepts the reviewed large-inventory ceiling while respecting the D1 unit-page cap', async () => {
  const workStore = createWorkStore();
  const listPhaseUnits = workStore.listPhaseUnits.bind(workStore);
  const observedLimits = [];
  workStore.listPhaseUnits = async (input) => {
    observedLimits.push(input.limit);
    if (input.limit > 500) throw new RangeError('D1ResumableWorkStore limit must be from 1 to 500');
    return listPhaseUnits(input);
  };
  const emptyPage = async () => ({ rows: [], hasMore: false, nextCursor: null });
  const input = baseInput({
    connectorKey: 'instagram',
    jobType: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    operation: Object.freeze({
      operationId: 'instagram-large-ceiling-001',
      workKey: 'instagram:instagram-large-ceiling-001',
      generation: REQUESTED_AT,
      originalRequestedAt: REQUESTED_AT,
      stable: true,
    }),
    syncRunId: 'meta:instagram:instagram-large-ceiling-001',
    adapter: {
      async fetchAccount() {
        return { resource: { id: 'instagram_1', name: 'Fixture Instagram' } };
      },
      fetchContentPage: emptyPage,
      fetchAccountInsightsPage: emptyPage,
    },
    sourceAccountId: 'instagram_1',
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
    limits: {
      sourceMaxPages: 10,
      sourceMaxUnits: 2_500,
      sourceMaxRows: 50_000,
      sourceMaxUnitBytes: 100_000,
      d1RowsPerInvocation: 2,
      larkTablesPerInvocation: 2,
    },
  });

  let result;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = await processMetaEndToEndSync(input);
    if (result.status === 'source_validated') break;
  }

  assert.equal(result.status, 'source_validated');
  assert.ok(observedLimits.length > 0);
  assert.equal(Math.max(...observedLimits), 3);
});

test('reads more than 500 staged Meta units through bounded D1 pages', async () => {
  const workStore = createWorkStore();
  const listPhaseUnits = workStore.listPhaseUnits.bind(workStore);
  const reads = [];
  workStore.listPhaseUnits = async (input) => {
    reads.push({ afterSequence: input.afterSequence, limit: input.limit });
    if (input.limit > 500) throw new RangeError('D1ResumableWorkStore limit must be from 1 to 500');
    return listPhaseUnits(input);
  };
  const input = baseInput({
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
    limits: {
      sourceMaxPages: 10,
      sourceMaxUnits: 2_500,
      sourceMaxRows: 50_000,
      sourceMaxUnitBytes: 100_000,
      d1RowsPerInvocation: 2,
      larkTablesPerInvocation: 2,
    },
  });

  assert.equal((await processMetaEndToEndSync(input)).status, 'source_continuation');
  for (let sequence = 1; sequence <= 500; sequence += 1) {
    await workStore.savePhase({
      workKey: OPERATION.workKey,
      phase: 'meta_end_to_end_source_staging_v1',
      state: {
        stage: 'complete',
        pageState: null,
        contentIds: [],
        contentIndex: 0,
        unitCount: 501,
        rowCount: 1,
        sourceWatermark: null,
      },
      expectedItems: 501,
      processedItems: 501,
      pagesProcessed: 501,
      chunksProcessed: 501,
      complete: true,
      unit: {
        unitKey: `daily:${sequence}`,
        sequence,
        payload: {
          schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
          datasetKey: 'meta_ads.performance.daily',
          sourceEntityId: null,
          sourceStatus: 'no_data_confirmed',
          sourceWatermark: null,
          pageNumber: sequence,
          rows: [],
        },
      },
    });
  }

  const result = await processMetaEndToEndSync(input);
  assert.equal(result.status, 'source_validated');
  assert.deepEqual(reads, [
    { afterSequence: 0, limit: 500 },
    { afterSequence: 500, limit: 1 },
  ]);
});

test('Meta Ads stages account then creatives then July insights and derives only activity entities', async () => {
  const workStore = createWorkStore();
  const creativeCalls = [];
  const calls = [];
  const adapter = createAdapter();
  adapter.fetchCreativesPage = async (input) => {
    creativeCalls.push(input);
    return { rows: [], hasMore: false, nextCursor: null };
  };
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
  assert.equal(creativeCalls.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].since, '2026-07-25');
  assert.equal(calls[0].until, '2026-07-25');
});

test('Meta Ads scheduled source reads Daily first and fetches creatives only for active ads', async () => {
  const workStore = createWorkStore();
  const fullInventoryCalls = [];
  const activityCreativeCalls = [];
  const adapter = createAdapter();
  adapter.fetchCreativesPage = async (input) => {
    fullInventoryCalls.push(input);
    throw new Error('scheduled incremental source must not enumerate full Creative inventory');
  };
  adapter.fetchDailyInsightsPage = async () => ({
    rows: [
      {
        account_id: '123456',
        campaign_id: '100',
        campaign_name: 'Campaign',
        adset_id: '200',
        adset_name: 'Ad Set',
        ad_id: '301',
        ad_name: 'Ad 301',
        date_start: '2026-07-25',
        date_stop: '2026-07-25',
        publisher_platform: 'facebook',
        spend: '1',
        impressions: '10',
        reach: '8',
        clicks: '2',
      },
      {
        account_id: '123456',
        campaign_id: '100',
        campaign_name: 'Campaign',
        adset_id: '200',
        adset_name: 'Ad Set',
        ad_id: '301',
        ad_name: 'Ad 301',
        date_start: '2026-07-25',
        date_stop: '2026-07-25',
        publisher_platform: 'instagram',
        spend: '2',
        impressions: '20',
        reach: '16',
        clicks: '4',
      },
    ],
    hasMore: false,
    nextCursor: null,
  });
  adapter.fetchActivityCreative = async ({ adId }) => {
    activityCreativeCalls.push(adId);
    return {
      resource: {
        id: '401',
        name: 'Creative 401',
        object_type: 'VIDEO',
      },
    };
  };
  const input = baseInput({
    adapter,
    adsSourceMode: 'daily_activity_scoped_creatives_v1',
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
  });

  assert.equal((await processMetaEndToEndSync(input)).continuationPhase, 'daily');
  assert.equal((await processMetaEndToEndSync(input)).continuationPhase, 'activity_creatives');
  const result = await processMetaEndToEndSync(input);

  assert.equal(result.status, 'source_validated');
  assert.equal(fullInventoryCalls.length, 0);
  assert.deepEqual(activityCreativeCalls, ['301']);
  assert.deepEqual(result.sourceSummary, {
    accountRows: 1,
    campaignRows: 1,
    adSetRows: 1,
    adRows: 1,
    creativeRows: 1,
    dailyRows: 2,
  });
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
