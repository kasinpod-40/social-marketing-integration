import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { processMetaEndToEndSync } from '../../packages/application/src/use-cases/process-meta-end-to-end-sync.js';
import {
  META_PAID_DIRECT_LARK_D1_PHASE,
  META_PAID_DIRECT_LARK_SOURCE_PHASE,
  META_PAID_DIRECT_LARK_TABLE_KEYS,
  buildMetaPaidDirectCandidateSql,
  buildMetaPaidDirectUnitsSql,
  createForbiddenMetaPaidDirectAdapter,
  createForbiddenMetaPaidDirectHistoryStore,
  createSeededMetaPaidDirectWorkStore,
  normalizeMetaPaidDirectCandidate,
  normalizeMetaPaidDirectUnits,
  parseWranglerD1Rows,
  selectNewestMetaPaidDirectSnapshot,
  validateMetaPaidDirectLarkResult,
  validateMetaPaidDirectSourceSnapshot,
} from '../../scripts/lib/meta-paid-direct-lark-materializer.js';

const GENERATION = Date.parse('2026-08-20T06:00:00Z');
const WORK_KEY = 'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-123456abcdef';
const OPERATION_ID = WORK_KEY.split(':').at(-1);

function candidateRow(overrides = {}) {
  return {
    work_key: WORK_KEY,
    cursor_key: 'meta:integration_workspace:meta_ads:chemistry_k',
    work_type: 'meta_ads_sync',
    generation: GENERATION,
    requested_at: GENERATION,
    lifecycle_status: 'active',
    work_created_at: GENERATION,
    work_updated_at: GENERATION + 1000,
    source_state_json: JSON.stringify({
      stage: 'complete',
      pageState: null,
      contentIds: [],
      contentIndex: 0,
      unitCount: 3,
      rowCount: 3,
      sourceWatermark: '2026-07-31T23:59:59Z',
    }),
    source_expected_items: 3,
    source_processed_items: 3,
    source_pages_processed: 3,
    source_chunks_processed: 3,
    source_complete: 1,
    source_created_at: GENERATION,
    source_updated_at: GENERATION + 1000,
    d1_state_json: JSON.stringify({
      organicHistoryDone: false,
      organicHistory: null,
      nextIndex: 18,
      counts: {
        written: 18,
        created: 0,
        skipped: 0,
        account_daily: 0,
        ads_entity: 5,
        ads_daily: 1,
        coverage_run: 6,
        coverage_entity: 6,
      },
    }),
    d1_expected_items: 18,
    d1_processed_items: 18,
    d1_pages_processed: 0,
    d1_chunks_processed: 1,
    d1_complete: 1,
    d1_created_at: GENERATION,
    d1_updated_at: GENERATION + 1000,
    ...overrides,
  };
}

function stagedPayload(datasetKey, rows, sourceEntityId = null) {
  return {
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey,
    sourceEntityId,
    sourceStatus: 'complete',
    sourceWatermark: '2026-07-31T23:59:59Z',
    pageNumber: 1,
    rows,
  };
}

function unitRows(overrides = {}) {
  const account = {
    id: 'act_987650001',
    account_id: '987650001',
    name: 'Fixture Ad Account',
    account_status: 1,
    currency: 'THB',
    timezone_name: 'Asia/Bangkok',
  };
  const creative = {
    id: 'creative_fixture_001',
    name: 'Fixture Creative',
    object_type: 'IMAGE',
    effective_object_story_id: 'page_1_post_1',
  };
  const daily = {
    account_id: '987650001',
    account_currency: 'THB',
    campaign_id: 'campaign_1',
    campaign_name: 'July Campaign',
    adset_id: 'adset_1',
    adset_name: 'July Ad Set',
    ad_id: 'ad_1',
    ad_name: 'July Ad',
    date_start: '2026-07-31',
    date_stop: '2026-07-31',
    publisher_platform: 'facebook',
    spend: '1.000000',
    impressions: '10',
    reach: '8',
    clicks: '2',
  };
  return [
    {
      unit_key: 'account:1',
      sequence: 0,
      payload_json: JSON.stringify(stagedPayload('meta_ads.account.latest', [account], '987650001')),
    },
    {
      unit_key: 'creatives:1',
      sequence: 1,
      payload_json: JSON.stringify(stagedPayload('meta_ads.creatives.inventory', [creative], '987650001')),
    },
    {
      unit_key: 'daily:1',
      sequence: 2,
      payload_json: JSON.stringify(stagedPayload('meta_ads.performance.daily', [daily], '987650001')),
    },
  ].map((row) => ({ ...row, ...(overrides[row.unit_key] ?? {}) }));
}

function validatedSnapshot() {
  const candidate = normalizeMetaPaidDirectCandidate(candidateRow(), 'chemistry_k2');
  return validateMetaPaidDirectSourceSnapshot(candidate, normalizeMetaPaidDirectUnits(unitRows()));
}

test('direct D1 discovery SQL is SELECT-only and exact-scope', () => {
  const candidateSql = buildMetaPaidDirectCandidateSql('chemistry_k2');
  const unitsSql = buildMetaPaidDirectUnitsSql(WORK_KEY);
  for (const sql of [candidateSql, unitsSql]) {
    assert.match(sql, /^SELECT\b/u);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA)\b/iu);
  }
  assert.match(candidateSql, /meta_end_to_end_source_staging_v1/u);
  assert.match(candidateSql, /meta_end_to_end_d1_write_v1/u);
  assert.match(candidateSql, /meta-chemistry_k2-history-20260701-20260731-/u);
});

test('parses Wrangler D1 JSON rows without accepting unknown envelopes', () => {
  const rows = parseWranglerD1Rows(JSON.stringify([{ success: true, results: [{ value: 1 }] }]));
  assert.deepEqual(rows, [{ value: 1 }]);
  assert.throws(
    () => parseWranglerD1Rows(JSON.stringify({ unexpected: [] })),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_D1_JSON_INVALID',
  );
});

test('validates exact persisted Creative + Daily July source and derives account identity', () => {
  const snapshot = validatedSnapshot();
  assert.equal(snapshot.target, 'chemistry_k2');
  assert.equal(snapshot.operationId, OPERATION_ID);
  assert.equal(snapshot.sourceAccountId, '987650001');
  assert.deepEqual(snapshot.sourceSummary, {
    sourceUnits: 3,
    accountRows: 1,
    creativeUnits: 1,
    creativeRows: 1,
    dailyUnits: 1,
    dailyRows: 1,
  });
});

test('fails closed when durable Creative inventory is absent', () => {
  const candidate = normalizeMetaPaidDirectCandidate(candidateRow({
    source_state_json: JSON.stringify({ stage: 'complete', unitCount: 2, rowCount: 2 }),
    source_expected_items: 2,
    source_processed_items: 2,
  }), 'chemistry_k2');
  const rows = unitRows().filter((row) => row.unit_key !== 'creatives:1').map((row, index) => ({
    ...row,
    sequence: index,
  }));
  assert.throws(
    () => validateMetaPaidDirectSourceSnapshot(candidate, normalizeMetaPaidDirectUnits(rows)),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_SOURCE_INELIGIBLE',
  );
});

test('fails closed when persisted Daily source escapes July', () => {
  const rows = unitRows({
    'daily:1': {
      payload_json: JSON.stringify(stagedPayload('meta_ads.performance.daily', [{
        account_id: '987650001',
        campaign_id: 'campaign_1',
        adset_id: 'adset_1',
        ad_id: 'ad_1',
        date_start: '2026-08-01',
        date_stop: '2026-08-01',
      }], '987650001')),
    },
  });
  const candidate = normalizeMetaPaidDirectCandidate(candidateRow(), 'chemistry_k2');
  assert.throws(
    () => validateMetaPaidDirectSourceSnapshot(candidate, normalizeMetaPaidDirectUnits(rows)),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_SOURCE_INELIGIBLE',
  );
});

test('newest eligible snapshot selection fails on same-generation ambiguity', () => {
  const first = validatedSnapshot();
  const second = {
    ...first,
    workKey: first.workKey.replace('123456abcdef', 'abcdef123456'),
    operationId: first.operationId.replace('123456abcdef', 'abcdef123456'),
  };
  assert.throws(
    () => selectNewestMetaPaidDirectSnapshot([first, second], 'chemistry_k2'),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_SOURCE_AMBIGUOUS',
  );
});

test('seeded store resumes source and D1 locally without provider or remote history writes', async () => {
  const snapshot = validatedSnapshot();
  const store = await createSeededMetaPaidDirectWorkStore(snapshot);
  const source = await store.loadPhase({ workKey: WORK_KEY, phase: META_PAID_DIRECT_LARK_SOURCE_PHASE });
  const d1 = await store.loadPhase({ workKey: WORK_KEY, phase: META_PAID_DIRECT_LARK_D1_PHASE });
  const units = await store.listPhaseUnits({
    workKey: WORK_KEY,
    phase: META_PAID_DIRECT_LARK_SOURCE_PHASE,
    afterSequence: 0,
    limit: 10,
  });
  assert.equal(source.complete, true);
  assert.equal(d1.complete, true);
  assert.equal(d1.state.nextIndex, 18);
  assert.equal(units.units.length, 3);
  assert.throws(
    () => createForbiddenMetaPaidDirectAdapter().fetchAccount(),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_PROVIDER_READ_FORBIDDEN',
  );
  assert.throws(
    () => createForbiddenMetaPaidDirectHistoryStore().writeMetaD1Operations([]),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_D1_WRITE_FORBIDDEN',
  );
});

test('existing Meta pipeline writes only Creatives + Daily then fresh replay is fully skipped', async () => {
  const snapshot = validatedSnapshot();
  const destination = new Map();
  const syncEngine = createStatefulFakeSyncEngine(destination);
  const tables = Object.freeze({
    mktAdsCreatives: 'tbl_creatives',
    mktAdsDaily: 'tbl_daily',
    __metaLarkTableKeys: [...META_PAID_DIRECT_LARK_TABLE_KEYS],
  });

  const firstStore = await createSeededMetaPaidDirectWorkStore(snapshot);
  const first = await runPipeline(snapshot, firstStore, syncEngine, tables);
  const firstCheck = validateMetaPaidDirectLarkResult(first);
  assert.deepEqual(firstCheck.larkResults.map((entry) => entry.tableKey), [
    'mktAdsCreatives',
    'mktAdsDaily',
  ]);
  assert.deepEqual(firstCheck.larkResults.map((entry) => entry.created), [1, 1]);
  assert.deepEqual([...destination.keys()].sort(), ['tbl_creatives', 'tbl_daily']);

  const secondStore = await createSeededMetaPaidDirectWorkStore(snapshot);
  const second = await runPipeline(snapshot, secondStore, syncEngine, tables);
  const replay = validateMetaPaidDirectLarkResult(second, { idempotent: true });
  assert.deepEqual(replay.larkResults.map((entry) => entry.created), [0, 0]);
  assert.deepEqual(replay.larkResults.map((entry) => entry.updated), [0, 0]);
  assert.deepEqual(replay.larkResults.map((entry) => entry.skipped), [1, 1]);
});

async function runPipeline(snapshot, store, syncEngine, tables) {
  const input = {
    connectorKey: 'meta_ads',
    jobType: JOB_TYPES.META_ADS_SYNC,
    operation: {
      operationId: snapshot.operationId,
      workKey: snapshot.workKey,
      generation: snapshot.generation,
      originalRequestedAt: snapshot.requestedAt,
      stable: true,
    },
    syncRunId: `meta:meta_ads:${snapshot.target}:${snapshot.operationId}`,
    cursorKey: snapshot.cursorKey,
    assertLockActive: async () => undefined,
    adapter: createForbiddenMetaPaidDirectAdapter(),
    sourceAccountId: snapshot.sourceAccountId,
    accountKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    dateRange: { since: '2026-07-01', until: '2026-07-31' },
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    resumableWorkStore: store,
    historyStore: createForbiddenMetaPaidDirectHistoryStore(),
    organicHistoryGateway: null,
    repository: {},
    syncEngine,
    tables,
    limits: {
      sourceMaxPages: 100,
      sourceMaxUnits: 2_500,
      sourceMaxRows: 50_000,
      sourceMaxUnitBytes: 1_048_576,
      d1RowsPerInvocation: 1_000,
      larkTablesPerInvocation: 2,
    },
  };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await processMetaEndToEndSync(input);
    if (['completed', 'completed_idempotent'].includes(result.status)) return result;
  }
  throw new Error('Meta paid direct pipeline did not complete within the bounded test attempts');
}

function createStatefulFakeSyncEngine(destination) {
  return {
    async planByKey({ tableId, keyField, rows }) {
      const stored = destination.get(tableId) ?? new Set();
      const createRows = [];
      let skipped = 0;
      for (const row of rows) {
        const key = String(row[keyField]);
        if (stored.has(key)) skipped += 1;
        else createRows.push(row);
      }
      return {
        tableId,
        keyField,
        createRows,
        updateRows: [],
        skipped,
        duplicateInputRows: 0,
      };
    },
    async executePlan(plan, options = {}) {
      if (plan.createRows.length > 0) await options.beforeWriteChunk?.();
      const stored = destination.get(plan.tableId) ?? new Set();
      for (const row of plan.createRows) stored.add(String(row[plan.keyField]));
      destination.set(plan.tableId, stored);
      return {
        created: plan.createRows.length,
        updated: 0,
        skipped: plan.skipped,
        duplicateInputRows: 0,
      };
    },
  };
}
