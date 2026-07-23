import test from 'node:test';
import assert from 'node:assert/strict';
import { writeAllUnits } from '../../packages/application/src/use-cases/tiktok-staged-business-phases.js';

const SOURCE_PHASE = 'tiktok_native_source_pages';
const START = Date.parse('2026-07-23T03:00:00.000Z');

test('D1 unit failure prevents every Lark write', async () => {
  const events = [];
  const context = createContext();
  const historyHooks = createHistoryHooks(events, { failD1: true });
  const syncEngine = createSyncEngine(events);

  await assert.rejects(
    () => writeAllUnits(createInput({ context, historyHooks, syncEngine, events })),
    /D1 unavailable/u,
  );
  assert.deepEqual(events, ['d1']);
  assert.equal(context.savedWritePhases.length, 0);
});

test('Lark failure after D1 success retries D1 idempotently and repairs Lark', async () => {
  const events = [];
  const context = createContext();
  const historyHooks = createHistoryHooks(events);
  const syncEngine = createSyncEngine(events, { failContentOnce: true });
  const input = createInput({ context, historyHooks, syncEngine, events });

  await assert.rejects(
    () => writeAllUnits(input),
    (error) => error.code === 'SYNC_PARTIAL_WRITE'
      && error.details.failedPhase === 'content'
      && error.details.d1ContentRowsDurable === 1,
  );
  assert.deepEqual(events, ['d1', 'lark:content']);
  assert.equal(context.savedWritePhases.length, 0);

  events.length = 0;
  const result = await writeAllUnits(input);
  assert.deepEqual(events, ['d1', 'lark:content', 'lark:daily']);
  assert.equal(historyHooks.calls, 2);
  assert.equal(result.historyResult.contentRowsDurable, 1);
  assert.equal(result.historyResult.observationRowsDurable, 1);
  assert.equal(result.historyResult.observationsCreated, 0);
  assert.equal(result.historyResult.observationsSkipped, 1);
  assert.equal(result.contentResult.created, 1);
  assert.equal(result.dailyResult.created, 1);
  assert.equal(context.savedWritePhases.at(-1).complete, true);
});

function createInput(input) {
  return {
    context: input.context,
    repository: createRepository(),
    syncEngine: input.syncEngine,
    tables: {
      rawTikTokCreatorVideos: 'raw-tiktok',
      mktContent: 'mkt-content',
      mktContentDaily: 'mkt-content-daily',
      mktClassificationDictionary: 'mkt-dictionary',
    },
    accountId: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    metricDate: '2026-07-23',
    dictionaryAnalysis: dictionaryAnalysis(),
    incrementalPlan: {
      enabled: false,
      mode: 'full',
      reason: 'manual_full',
      requestedMode: 'full',
      sourceRecords: 1,
      selectedRecords: 1,
      changedRecords: 1,
      unchangedRecords: 0,
      removedRecords: 0,
      dictionaryChanged: false,
      metricDateChanged: false,
      fullSnapshot: true,
      sourceSkippedPerTable: 0,
      selectedExternalContentIds: Object.freeze(['video-1']),
    },
    selectedExternalIds: new Set(['video-1']),
    planFingerprint: 'plan-fingerprint',
    sourceSummary: {
      durable: true,
      complete: true,
      records: 1,
      pagesProcessed: 1,
      resumedPages: 0,
      pageSize: 100,
      maxPages: 10,
    },
    historyHooks: input.historyHooks,
    onProgress: () => undefined,
    syncRunId: 'attempt-1',
  };
}

function createContext() {
  const phases = new Map([[SOURCE_PHASE, {
    state: { pageToken: null, visitedPageTokens: [] },
    expectedItems: 1,
    processedItems: 1,
    pagesProcessed: 1,
    chunksProcessed: 1,
    complete: true,
  }]]);
  const savedWritePhases = [];
  return {
    workKey: 'tiktok:message-1',
    requestedAt: START,
    savedWritePhases,
    async assertCurrent() { return true; },
    store: {
      async loadPhase(input) {
        return structuredClone(phases.get(input.phase) ?? null);
      },
      async savePhase(input) {
        const phase = {
          state: structuredClone(input.state ?? {}),
          expectedItems: input.expectedItems,
          processedItems: input.processedItems,
          pagesProcessed: input.pagesProcessed,
          chunksProcessed: input.chunksProcessed,
          complete: input.complete === true,
        };
        phases.set(input.phase, phase);
        if (input.phase === 'tiktok_native_business_write_v1') {
          savedWritePhases.push(structuredClone(phase));
        }
        return structuredClone(phase);
      },
      async listPhaseUnits(input) {
        if (input.phase !== SOURCE_PHASE || input.afterSequence > 0) {
          return { units: [], nextSequence: null };
        }
        return {
          units: [{
            unitKey: 'page:1',
            sequence: 0,
            payload: { records: [rawRecord()] },
          }],
          nextSequence: null,
        };
      },
    },
  };
}

function createHistoryHooks(events, input = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async writeUnit() {
      calls += 1;
      events.push('d1');
      if (input.failD1) throw new Error('D1 unavailable');
      return calls === 1
        ? historyResult({ observationsCreated: 1 })
        : historyResult({ observationsSkipped: 1 });
    },
  };
}

function createSyncEngine(events, input = {}) {
  let contentAttempts = 0;
  return {
    async planByKey(value) {
      return Object.freeze({
        tableId: value.tableId,
        inputRows: value.rows.length,
        createRows: Object.freeze([...value.rows]),
        updateRows: Object.freeze([]),
        skipped: 0,
        duplicateInputRows: 0,
        existingRecordsRead: 0,
        existingReadStrategy: 'focused_test',
      });
    },
    async executePlan(plan) {
      const role = plan.tableId === 'mkt-content' ? 'content' : 'daily';
      events.push(`lark:${role}`);
      if (role === 'content') {
        contentAttempts += 1;
        if (input.failContentOnce && contentAttempts === 1) {
          throw new Error('Lark content unavailable');
        }
      }
      return Object.freeze({
        created: plan.createRows.length,
        updated: 0,
        skipped: plan.skipped,
        duplicateInputRows: plan.duplicateInputRows,
      });
    },
  };
}

function createRepository() {
  return {
    async listAll() { return []; },
    async prepareRows(_tableId, rows) { return rows; },
    async createMany(_tableId, rows) { return { created: rows.length }; },
    async updateMany(_tableId, rows) { return { updated: rows.length }; },
  };
}

function dictionaryAnalysis() {
  return Object.freeze({
    totalRows: 1,
    disabledRows: 0,
    invalidRows: Object.freeze([]),
    rules: Object.freeze([Object.freeze({
      rule_key: 'lesson-theme',
      target_field: 'content_theme',
      output_value: 'lesson',
      aliases: Object.freeze(['lesson']),
      match_type: 'contains',
      compiled_regexes: Object.freeze([]),
      platform: Object.freeze(['tiktok']),
      applies_to: Object.freeze(['organic']),
      priority: 1,
      confidence: 0.9,
      enabled: true,
      note: null,
    })]),
  });
}

function rawRecord() {
  return Object.freeze({
    recordId: 'raw-video-1',
    fields: Object.freeze({
      video_id: 'video-1',
      published_at: '2026-07-01T00:00:00Z',
      description: 'Chemistry K lesson',
      shareable_url: 'https://www.tiktok.com/@chemistry_k/video/video-1',
      duration_seconds: 30,
      views: 100,
      likes: 10,
      comments: 1,
      shares: 2,
      average_play_duration: 3,
      total_play_duration: 300,
      completion_rate: 0.5,
    }),
  });
}

function historyResult(input = {}) {
  return Object.freeze({
    contentRows: 1,
    stateWritten: input.stateWritten ?? 0,
    stateSkipped: input.stateSkipped ?? 1,
    observationsCreated: input.observationsCreated ?? 0,
    observationsSkipped: input.observationsSkipped ?? 0,
    observationsNotRequired: 0,
    coverageEntitiesWritten: input.coverageEntitiesWritten ?? 0,
    coverageEntitiesSkipped: input.coverageEntitiesSkipped ?? 1,
  });
}
