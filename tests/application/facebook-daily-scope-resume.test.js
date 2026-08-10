import assert from 'node:assert/strict';
import test from 'node:test';

import { processMetaEndToEndSync } from '../../packages/application/src/use-cases/process-meta-end-to-end-sync.js';

const REQUESTED_AT = Date.parse('2026-08-10T00:30:00Z');
const OPERATION = Object.freeze({
  operationId: 'facebook-dashboard-repair-20260809-v1',
  workKey: 'facebook:facebook-dashboard-repair-20260809-v1',
  generation: REQUESTED_AT,
  originalRequestedAt: REQUESTED_AT,
  stable: true,
});

function stagedPayload(datasetKey, rows, options = {}) {
  return Object.freeze({
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey,
    sourceEntityId: options.sourceEntityId ?? null,
    sourceStatus: options.sourceStatus ?? 'complete',
    sourceWatermark: options.sourceWatermark ?? null,
    pageNumber: options.pageNumber ?? 1,
    rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
  });
}

function createWorkStore({ state, units }) {
  const phaseKey = `${OPERATION.workKey}:meta_end_to_end_source_staging_v1`;
  const phases = new Map([[phaseKey, {
    workKey: OPERATION.workKey,
    phase: 'meta_end_to_end_source_staging_v1',
    state: structuredClone(state),
    complete: false,
  }]]);
  const bySequence = new Map(units.map((unit) => [unit.sequence, structuredClone(unit)]));

  return {
    phases,
    units: bySequence,
    async beginWork() {
      return { completed: false, superseded: false, resumed: true };
    },
    async loadPhase({ workKey, phase }) {
      return structuredClone(phases.get(`${workKey}:${phase}`) ?? null);
    },
    async savePhase(value) {
      const saved = structuredClone(value);
      phases.set(`${value.workKey}:${value.phase}`, saved);
      if (value.unit) bySequence.set(value.unit.sequence, structuredClone(value.unit));
      return saved;
    },
    async listPhaseUnits({ afterSequence = 0, limit }) {
      const values = [...bySequence.values()]
        .filter((unit) => unit.sequence >= afterSequence)
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, limit);
      const remaining = [...bySequence.values()]
        .some((unit) => unit.sequence > (values.at(-1)?.sequence ?? -1));
      return {
        units: structuredClone(values),
        nextSequence: values.length === limit && remaining
          ? values.at(-1).sequence + 1
          : null,
      };
    },
  };
}

function baseInput({ workStore, adapter }) {
  return {
    connectorKey: 'facebook',
    operation: OPERATION,
    syncRunId: 'meta:facebook:facebook:facebook-dashboard-repair-20260809-v1',
    cursorKey: 'integration_workspace:facebook:chemistry_k:repair',
    jobType: 'facebook.organic.sync',
    adapter,
    sourceAccountId: 'page_1',
    accountKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    dateRange: { since: '2026-08-09', until: '2026-08-09' },
    limits: {
      sourceMaxPages: 100,
      sourceMaxUnits: 2_500,
      sourceMaxRows: 50_000,
      sourceMaxUnitBytes: 524_288,
      d1RowsPerInvocation: 250,
      larkTablesPerInvocation: 1,
    },
    resumableWorkStore: workStore,
    sourceReadOnly: true,
    d1WriteEnabled: false,
    larkWriteEnabled: false,
    assertLockActive: async () => undefined,
  };
}

test('migrates an in-progress pre-v2 Facebook daily Content cursor without deleting staged evidence', async () => {
  const workStore = createWorkStore({
    state: {
      stage: 'content',
      pageState: {
        after: 'legacy-unbounded-cursor',
        visitedCursors: ['older-legacy-cursor'],
        pageNumber: 23,
      },
      contentIds: [],
      contentIndex: 0,
      unitCount: 22,
      rowCount: 2101,
      sourceWatermark: '2026-08-10T00:10:00+0000',
    },
    units: [],
  });
  const contentCalls = [];
  const adapter = {
    async fetchContentPage(input) {
      contentCalls.push(input);
      return {
        rows: [{ id: 'scoped_post_1', created_time: '2026-08-09T12:00:00+0000' }],
        hasMore: true,
        nextCursor: 'bounded-cursor-1',
      };
    },
  };

  const result = await processMetaEndToEndSync(baseInput({ workStore, adapter }));
  const saved = workStore.phases.get(`${OPERATION.workKey}:meta_end_to_end_source_staging_v1`);

  assert.equal(result.status, 'source_continuation');
  assert.equal(contentCalls.length, 1);
  assert.equal(contentCalls[0].after, null);
  assert.deepEqual(contentCalls[0].visitedCursors, []);
  assert.equal(contentCalls[0].since, '2026-08-09');
  assert.equal(contentCalls[0].until, '2026-08-09');
  assert.equal(saved.state.contentInventoryScope, 'facebook_daily_dashboard_lookback_v1');
  assert.equal(saved.state.contentInventoryStartSequence, 22);
  assert.equal(saved.state.unitCount, 23);
  assert.equal(saved.state.pageState.after, 'bounded-cursor-1');
  assert.equal(workStore.units.get(22).payload.rows[0].id, 'scoped_post_1');
});

test('same-operation resume excludes pre-marker unbounded Content rows from IDs and final source snapshot', async () => {
  const workStore = createWorkStore({
    state: {
      stage: 'content',
      pageState: {
        after: 'legacy-unbounded-cursor',
        visitedCursors: [],
        pageNumber: 2,
      },
      contentIds: [],
      contentIndex: 0,
      unitCount: 2,
      rowCount: 101,
      sourceWatermark: '2026-08-10T00:10:00+0000',
    },
    units: [
      {
        sequence: 0,
        unitKey: 'facebook:facebook.account.latest:page_1:account:page_1:start',
        payload: stagedPayload('facebook.account.latest', [{ id: 'page_1', name: 'Fixture Page' }]),
      },
      {
        sequence: 1,
        unitKey: 'facebook:facebook.content.inventory:page_1:account:page_1:start',
        payload: stagedPayload('facebook.content.inventory', [
          { id: 'legacy_post_1', created_time: '2020-01-01T00:00:00+0000' },
        ]),
      },
    ],
  });

  const contentCalls = [];
  const adapter = {
    async fetchContentPage(input) {
      contentCalls.push(input);
      return {
        rows: [{ id: 'scoped_post_1', created_time: '2026-08-09T12:00:00+0000' }],
        hasMore: false,
        nextCursor: null,
      };
    },
    async fetchAccountInsightsPage() {
      return { rows: [], hasMore: false, nextCursor: null };
    },
    async fetchContentInsightsPage({ contentId }) {
      assert.equal(contentId, 'scoped_post_1');
      return {
        rows: [{
          name: 'post_media_view',
          period: 'lifetime',
          values: [{ value: 11, end_time: '2026-08-10T00:00:00+0000' }],
        }],
        hasMore: false,
        nextCursor: null,
      };
    },
  };

  let result = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = await processMetaEndToEndSync(baseInput({ workStore, adapter }));
    if (result.status === 'source_validated') break;
  }

  assert.equal(result.status, 'source_validated');
  assert.equal(contentCalls.length, 1);
  assert.equal(contentCalls[0].after, null);
  assert.equal(result.sourceSummary.contentRows, 1);
  assert.equal(result.sourceSummary.contentInsightEntities, 1);
  assert.equal(result.sourceSummary.contentInsightRows, 1);
  assert.equal(result.sourceSummary.accountInsightRows, 0);

  const finalState = workStore.phases.get(
    `${OPERATION.workKey}:meta_end_to_end_source_staging_v1`,
  ).state;
  assert.deepEqual(finalState.contentIds, ['scoped_post_1']);
  assert.equal(finalState.contentInventoryStartSequence, 2);
  assert.equal(finalState.contentInventoryScope, 'facebook_daily_dashboard_lookback_v1');
  assert.ok([...workStore.units.values()].some(
    (unit) => unit.payload.rows?.some?.((row) => row.id === 'legacy_post_1'),
  ));
});
