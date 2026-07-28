import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_IMPLEMENTATION_STATUS,
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
    fetchCampaignsPage: empty,
    fetchAdSetsPage: empty,
    fetchAdsPage: empty,
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

test('registers all Meta jobs as protected manual UAT and stable Queue operations', () => {
  for (const type of [
    JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
    JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    JOB_TYPES.META_ADS_SYNC,
  ]) {
    const definition = getJobDefinition(type);
    assert.equal(definition.implementationStatus, JOB_IMPLEMENTATION_STATUS.UAT_PENDING);
    assert.equal(definition.manualOnly, true);
    const operation = resolveQueueOperation({
      job: {
        body: {
          type,
          ...(type === JOB_TYPES.META_ADS_SYNC ? { sourceAccountKey: 'chemistry_k2' } : {}),
          operationId: 'operation-1',
          requestedAt: '2026-07-26T00:00:00.000Z',
          generation: REQUESTED_AT,
        },
      },
    });
    assert.equal(operation.stable, true);
    assert.equal(operation.workKey, type === JOB_TYPES.META_ADS_SYNC
      ? 'meta_ads:chemistry_k2:operation-1'
      : `${type.startsWith('facebook.') ? 'facebook' : 'instagram'}:operation-1`);
  }
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
  assert.equal(new Set(tableWrites).size, 8);
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
