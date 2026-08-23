import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTikTokCreatorNativeToLark } from '../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { InMemoryResumableWorkStore } from '../../packages/sync-engine/src/in-memory-resumable-work-store.js';

const WRITE_PHASE = 'tiktok_native_business_write_v1';
const PREFLIGHT_PHASE = 'tiktok_native_business_preflight_v1';

test('TikTok staged business retry resumes the failed unit without refetching completed source pages', async () => {
  const rawRecords = Array.from({ length: 1_000 }, (_, index) => (
    rawVideo('tt_account_1', `video_${String(index + 1).padStart(4, '0')}`)
  ));
  const repository = createIndexedRepository({
    rawRecords,
    dictionaryRecords: [dictionaryRow()],
    failDailyCreateCallOnce: 4,
  });
  const stateStore = createIncrementalStateStore();
  const workStore = new InMemoryResumableWorkStore({ now: () => 10_000 });
  const common = {
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-20',
    tables: tableIds(),
    incrementalEnabled: true,
    incrementalStateStore: stateStore,
    cursorKey: 'profile:tiktok:tt_account_1:native_import',
    customerProfile: 'profile',
    syncMode: 'auto',
    fullSyncIntervalMs: 86_400_000,
    resumableWorkStore: workStore,
    workKey: 'tiktok:message-staged-business-1',
    requestedAt: 1_000,
    generation: 1_000,
    sourcePageSize: 100,
    sourceMaxPages: 20,
  };

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      ...common,
      syncRunId: 'run-staged-attempt-1',
      now: () => 2_000,
    }),
    (error) => {
      assert.equal(error.code, 'SYNC_PARTIAL_WRITE');
      assert.equal(error.retryable, true);
      assert.equal(error.partialResult.content.created, 400);
      assert.equal(error.partialResult.dailySnapshots.created, 300);
      return true;
    },
  );

  const preflight = await workStore.loadPhase({
    workKey: common.workKey,
    phase: PREFLIGHT_PHASE,
  });
  const interruptedWrite = await workStore.loadPhase({
    workKey: common.workKey,
    phase: WRITE_PHASE,
  });
  assert.equal(preflight.complete, true);
  assert.equal(preflight.pagesProcessed, 10);
  assert.equal(interruptedWrite.complete, false);
  assert.equal(interruptedWrite.pagesProcessed, 3);
  assert.equal(interruptedWrite.processedItems, 300);
  assert.equal(repository.count('tbl_mkt_content'), 400);
  assert.equal(repository.count('tbl_mkt_content_daily'), 300);
  assert.equal(repository.maxCreateBatch, 100);

  const sourceCallsBeforeRetry = repository.pageCalls.length;
  const result = await syncTikTokCreatorNativeToLark({
    ...common,
    syncRunId: 'run-staged-attempt-2',
    now: () => 3_000,
  });

  assert.equal(result.mode, 'write');
  assert.equal(result.rawRecords, 1_000);
  assert.equal(result.processedRawRecords, 1_000);
  // Sync Log ของ Attempt ที่สองต้องนับเฉพาะ Write ที่เกิดใน Attempt นี้
  assert.equal(result.content.created, 600);
  assert.equal(result.content.skipped, 100);
  assert.equal(result.dailySnapshots.created, 700);
  assert.equal(result.dailySnapshots.skipped, 0);
  // ยอดสะสมทั้ง Durable work แยกไว้สำหรับ Reconciliation/Audit
  assert.equal(result.stagedBusiness.workTotals.content.created, 900);
  assert.equal(result.stagedBusiness.workTotals.content.skipped, 100);
  assert.equal(result.stagedBusiness.workTotals.dailySnapshots.created, 1_000);
  assert.equal(result.stagedBusiness.attemptUnitsCompleted, 7);
  assert.equal(result.stagedBusiness.workTotals.unitsCompleted, 10);
  assert.equal(result.stagedBusiness.bounded, true);
  assert.equal(result.stagedBusiness.unitsCompleted, 10);
  assert.equal(result.stagedBusiness.checkpointSaved, true);
  assert.equal(repository.pageCalls.length, sourceCallsBeforeRetry);
  assert.equal(repository.count('tbl_mkt_content'), 1_000);
  assert.equal(repository.count('tbl_mkt_content_daily'), 1_000);
  assert.equal(repository.duplicateCreates, 0);
  assert.equal(repository.maxCreateBatch, 100);
  assert.equal(stateStore.saveCalls.length, 1);
  assert.equal(stateStore.saveCalls[0].records.length, 1_000);
  assert.equal(workStore.works.get(common.workKey).lifecycleStatus, 'completed');
});


test('TikTok staged retry after checkpoint persistence finishes completion without business writes', async () => {
  const repository = createIndexedRepository({
    rawRecords: Array.from({ length: 200 }, (_, index) => (
      rawVideo('tt_account_1', `checkpoint_${String(index + 1).padStart(3, '0')}`)
    )),
    dictionaryRecords: [dictionaryRow()],
  });
  const stateStore = createIncrementalStateStore();
  const workStore = failCompletionPhaseOnce(new InMemoryResumableWorkStore({ now: () => 30_000 }));
  const common = stagedSyncInput({
    repository,
    stateStore,
    workStore,
    workKey: 'tiktok:message-checkpoint-replay',
    requestedAt: 3_000,
  });

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      ...common,
      syncRunId: 'run-checkpoint-replay-1',
      now: () => 4_000,
    }),
    /synthetic completion phase interruption/,
  );

  const writesBeforeRetry = repository.writeCalls.length;
  assert.equal(repository.count('tbl_mkt_content'), 200);
  assert.equal(repository.count('tbl_mkt_content_daily'), 200);
  assert.equal(stateStore.saveCalls.length, 1);

  const result = await syncTikTokCreatorNativeToLark({
    ...common,
    syncRunId: 'run-checkpoint-replay-2',
    now: () => 5_000,
  });

  assert.equal(repository.writeCalls.length, writesBeforeRetry);
  assert.equal(stateStore.saveCalls.length, 1);
  assert.equal(result.content.created, 0);
  assert.equal(result.dailySnapshots.created, 0);
  assert.equal(result.stagedBusiness.durableReplay, true);
  assert.equal(result.stagedBusiness.workTotals.content.created, 200);
  assert.equal(result.stagedBusiness.workTotals.dailySnapshots.created, 200);
  assert.equal(workStore.works.get(common.workKey).lifecycleStatus, 'completed');
});

test('TikTok staged completion-phase replay survives completeWork interruption without business writes', async () => {
  const repository = createIndexedRepository({
    rawRecords: Array.from({ length: 200 }, (_, index) => (
      rawVideo('tt_account_1', `completion_${String(index + 1).padStart(3, '0')}`)
    )),
    dictionaryRecords: [dictionaryRow()],
  });
  const stateStore = createIncrementalStateStore();
  const workStore = failCompleteWorkOnce(new InMemoryResumableWorkStore({ now: () => 40_000 }));
  const common = stagedSyncInput({
    repository,
    stateStore,
    workStore,
    workKey: 'tiktok:message-completion-replay',
    requestedAt: 4_000,
  });

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      ...common,
      syncRunId: 'run-completion-replay-1',
      now: () => 5_000,
    }),
    /synthetic completeWork interruption/,
  );

  const writesBeforeRetry = repository.writeCalls.length;
  const result = await syncTikTokCreatorNativeToLark({
    ...common,
    syncRunId: 'run-completion-replay-2',
    now: () => 6_000,
  });

  assert.equal(repository.writeCalls.length, writesBeforeRetry);
  assert.equal(stateStore.saveCalls.length, 1);
  assert.equal(result.content.created, 0);
  assert.equal(result.dailySnapshots.created, 0);
  assert.equal(result.stagedBusiness.completionPhaseReplay, true);
  assert.equal(result.stagedBusiness.durableReplay, true);
  assert.equal(result.stagedBusiness.workTotals.content.created, 200);
  assert.equal(result.stagedBusiness.workTotals.dailySnapshots.created, 200);
  assert.equal(workStore.works.get(common.workKey).lifecycleStatus, 'completed');
});

test('TikTok staged planner blocks duplicate content identities across different source pages before writes', async () => {
  const repository = createIndexedRepository({
    rawRecords: [
      rawVideo('tt_account_1', 'video_duplicate', 'raw_1'),
      rawVideo('tt_account_1', 'video_duplicate', 'raw_2'),
    ],
    dictionaryRecords: [dictionaryRow()],
  });
  const workStore = new InMemoryResumableWorkStore({ now: () => 20_000 });

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      syncRunId: 'run-duplicate-staged',
      repository,
      syncEngine: new TableSyncEngine(),
      accountId: 'tt_account_1',
      sourceHandle: 'tt_account_1',
      metricDate: '2026-07-20',
      tables: tableIds(),
      incrementalEnabled: false,
      cursorKey: 'profile:tiktok:tt_account_1:native_import',
      resumableWorkStore: workStore,
      workKey: 'tiktok:message-duplicate-staged',
      requestedAt: 2_000,
      generation: 2_000,
      sourcePageSize: 1,
      sourceMaxPages: 10,
    }),
    (error) => error?.code === 'TIKTOK_SYNC_NOT_READY'
      && /duplicate content identities/i.test(error.message),
  );

  assert.equal(repository.writeCalls.length, 0);
  assert.equal(repository.count('tbl_mkt_content'), 0);
  assert.equal(repository.count('tbl_mkt_content_daily'), 0);
});

test('TikTok bounded continuation completes source, plan, preflight and write one durable unit at a time', async () => {
  const repository = createIndexedRepository({
    rawRecords: Array.from({ length: 3 }, (_, index) => (
      rawVideo('tt_account_1', `bounded_${index + 1}`)
    )),
    dictionaryRecords: [dictionaryRow()],
  });
  const stateStore = createIncrementalStateStore();
  const workStore = new InMemoryResumableWorkStore({ now: () => 50_000 });
  const common = {
    ...stagedSyncInput({
      repository,
      stateStore,
      workStore,
      workKey: 'tiktok:bounded-continuation',
      requestedAt: 5_000,
    }),
    sourcePageSize: 1,
    maxSourcePagesPerInvocation: 1,
    maxBusinessUnitsPerInvocation: 1,
  };
  const phases = [];
  let sequence = 0;
  let result = null;

  for (let invocation = 0; invocation < 20; invocation += 1) {
    result = await syncTikTokCreatorNativeToLark({
      ...common,
      syncRunId: `run-bounded-${invocation}`,
      continuationSequence: sequence,
      now: () => 6_000 + invocation,
    });
    if (result.continuationRequired !== true) break;
    phases.push(result.continuationPhase);
    assert.equal(result.continuationSequence, sequence + 1);
    sequence = result.continuationSequence;
  }

  assert.deepEqual(phases, [
    'source_staging',
    'source_staging',
    'source_complete',
    'business_plan_scan',
    'business_plan_scan',
    'business_plan_scan',
    'business_plan',
    'business_preflight',
    'business_preflight',
    'business_preflight',
    'business_write',
    'business_write',
    'business_finalize',
  ]);
  assert.equal(result.mode, 'write');
  // Final continuation logs only writes from that delivery; cumulative proof lives in workTotals.
  assert.equal(result.content.created, 0);
  assert.equal(result.dailySnapshots.created, 0);
  assert.equal(result.stagedBusiness.workTotals.content.created, 3);
  assert.equal(result.stagedBusiness.workTotals.dailySnapshots.created, 3);
  assert.equal(repository.pageCalls.length, 3);
  assert.equal(repository.count('tbl_mkt_content'), 3);
  assert.equal(repository.count('tbl_mkt_content_daily'), 3);
  assert.equal(stateStore.saveCalls.length, 1);
  assert.equal(workStore.works.get(common.workKey).lifecycleStatus, 'completed');
});

test('TikTok retries an ambiguous pending continuation without advancing durable work twice', async () => {
  const repository = createIndexedRepository({
    rawRecords: [rawVideo('tt_account_1', 'pending_1'), rawVideo('tt_account_1', 'pending_2')],
    dictionaryRecords: [dictionaryRow()],
  });
  const workStore = new InMemoryResumableWorkStore({ now: () => 60_000 });
  const common = {
    ...stagedSyncInput({
      repository,
      stateStore: createIncrementalStateStore(),
      workStore,
      workKey: 'tiktok:pending-continuation',
      requestedAt: 6_000,
    }),
    sourcePageSize: 1,
    maxSourcePagesPerInvocation: 1,
    maxBusinessUnitsPerInvocation: 1,
    continuationSequence: 0,
  };

  const first = await syncTikTokCreatorNativeToLark({ ...common, syncRunId: 'pending-first' });
  const replay = await syncTikTokCreatorNativeToLark({ ...common, syncRunId: 'pending-replay' });

  assert.equal(first.continuationSequence, 1);
  assert.equal(replay.continuationSequence, 1);
  assert.equal(replay.continuationReplay, true);
  assert.equal(repository.pageCalls.length, 1);
  assert.equal(repository.writeCalls.length, 0);
});

test('TikTok rejects a continuation sequence ahead of its durable checkpoint', async () => {
  const repository = createIndexedRepository({
    rawRecords: [rawVideo('tt_account_1', 'ahead_1')],
    dictionaryRecords: [dictionaryRow()],
  });
  const common = {
    ...stagedSyncInput({
      repository,
      stateStore: createIncrementalStateStore(),
      workStore: new InMemoryResumableWorkStore({ now: () => 70_000 }),
      workKey: 'tiktok:ahead-continuation',
      requestedAt: 7_000,
    }),
    maxSourcePagesPerInvocation: 1,
    maxBusinessUnitsPerInvocation: 1,
    continuationSequence: 2,
  };

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({ ...common, syncRunId: 'ahead-run' }),
    (error) => error?.code === 'TIKTOK_CONTINUATION_SEQUENCE_AHEAD',
  );
  assert.equal(repository.pageCalls.length, 0);
  assert.equal(repository.writeCalls.length, 0);
});


function stagedSyncInput(input) {
  return {
    repository: input.repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-20',
    tables: tableIds(),
    incrementalEnabled: true,
    incrementalStateStore: input.stateStore,
    cursorKey: 'profile:tiktok:tt_account_1:native_import',
    customerProfile: 'profile',
    syncMode: 'auto',
    fullSyncIntervalMs: 86_400_000,
    resumableWorkStore: input.workStore,
    workKey: input.workKey,
    requestedAt: input.requestedAt,
    generation: input.requestedAt,
    sourcePageSize: 100,
    sourceMaxPages: 20,
  };
}

function failCompletionPhaseOnce(store) {
  const savePhase = store.savePhase.bind(store);
  let failed = false;
  store.savePhase = async (input) => {
    if (!failed && input.phase === 'tiktok_native_business_completion_v1') {
      failed = true;
      throw new Error('synthetic completion phase interruption');
    }
    return savePhase(input);
  };
  return store;
}

function failCompleteWorkOnce(store) {
  const completeWork = store.completeWork.bind(store);
  let failed = false;
  store.completeWork = async (input) => {
    if (!failed) {
      failed = true;
      throw new Error('synthetic completeWork interruption');
    }
    return completeWork(input);
  };
  return store;
}

function createIndexedRepository(input) {
  const recordsByTable = new Map([
    ['tbl_mkt_accounts', new Map()],
    ['tbl_mkt_content', new Map()],
    ['tbl_mkt_content_daily', new Map()],
  ]);
  const externalIndexByTable = new Map([
    ['tbl_mkt_accounts', new Map()],
    ['tbl_mkt_content', new Map()],
    ['tbl_mkt_content_daily', new Map()],
  ]);
  let nextRecordId = 1;
  let dailyCreateCalls = 0;
  let failedDailyCreate = false;
  const repository = {
    rawRecords: input.rawRecords,
    dictionaryRecords: input.dictionaryRecords,
    pageCalls: [],
    writeCalls: [],
    duplicateCreates: 0,
    maxCreateBatch: 0,
    count(tableId) {
      return recordsByTable.get(tableId)?.size ?? 0;
    },
    async listAll(tableId) {
      if (tableId === 'tbl_raw_tiktok_creator') {
        throw new Error('Staged business path must not aggregate RAW records with listAll');
      }
      if (tableId === 'tbl_dictionary') return repository.dictionaryRecords;
      return [...(recordsByTable.get(tableId)?.values() ?? [])];
    },
    async listPage(tableId, options = {}) {
      if (tableId !== 'tbl_raw_tiktok_creator') throw new Error(`Unexpected paged table ${tableId}`);
      const pageToken = options.pageToken ?? null;
      const start = pageToken === null ? 0 : Number(pageToken);
      const pageSize = Number(options.pageSize ?? 500);
      repository.pageCalls.push({ pageToken, pageSize });
      const records = repository.rawRecords.slice(start, start + pageSize);
      const nextOffset = start + records.length;
      const hasMore = nextOffset < repository.rawRecords.length;
      return {
        records,
        hasMore,
        nextPageToken: hasMore ? String(nextOffset) : null,
      };
    },
    async listByFieldValues(tableId, fieldName, values) {
      const stableIndex = recordsByTable.get(tableId) ?? new Map();
      const externalIndex = externalIndexByTable.get(tableId) ?? new Map();
      const index = fieldName === 'external_content_id' ? externalIndex : stableIndex;
      const found = [];
      for (const value of values) {
        const record = index.get(String(value));
        if (record) found.push(record);
      }
      return found;
    },
    async prepareRows(_tableId, rows) {
      return rows;
    },
    async createMany(tableId, rows) {
      repository.writeCalls.push({ operation: 'create', tableId, rows: rows.length });
      repository.maxCreateBatch = Math.max(repository.maxCreateBatch, rows.length);
      if (tableId === 'tbl_mkt_content_daily') {
        dailyCreateCalls += 1;
        if (!failedDailyCreate && dailyCreateCalls === input.failDailyCreateCallOnce) {
          failedDailyCreate = true;
          throw Object.assign(new Error('synthetic daily write interruption'), {
            code: 'LARK_TRANSIENT_API_ERROR',
            retryable: true,
          });
        }
      }
      const stableField = tableId === 'tbl_mkt_accounts'
        ? 'account_key'
        : tableId === 'tbl_mkt_content' ? 'content_key' : 'content_daily_key';
      const stableIndex = recordsByTable.get(tableId);
      const externalIndex = externalIndexByTable.get(tableId);
      for (const fields of rows) {
        const stableKey = fields[stableField];
        if (stableIndex.has(stableKey)) {
          repository.duplicateCreates += 1;
          throw new Error(`Duplicate create ${stableKey}`);
        }
        const record = { recordId: `record-${nextRecordId++}`, fields: { ...fields } };
        stableIndex.set(stableKey, record);
        if (fields.external_content_id) externalIndex.set(fields.external_content_id, record);
      }
      return { created: rows.length };
    },
    async updateMany(tableId, rows) {
      repository.writeCalls.push({ operation: 'update', tableId, rows: rows.length });
      const stableField = tableId === 'tbl_mkt_accounts'
        ? 'account_key'
        : tableId === 'tbl_mkt_content' ? 'content_key' : 'content_daily_key';
      const stableIndex = recordsByTable.get(tableId);
      const externalIndex = externalIndexByTable.get(tableId);
      for (const update of rows) {
        const record = [...stableIndex.values()].find((item) => item.recordId === update.recordId);
        if (!record) throw new Error(`Missing destination record ${update.recordId}`);
        const previousKey = record.fields[stableField];
        stableIndex.delete(previousKey);
        record.fields = { ...update.fields };
        stableIndex.set(record.fields[stableField], record);
        if (record.fields.external_content_id) {
          externalIndex.set(record.fields.external_content_id, record);
        }
      }
      return { updated: rows.length };
    },
  };
  return repository;
}

function createIncrementalStateStore() {
  let checkpoint = { cursor: null, recordStates: [] };
  const saveCalls = [];
  return {
    saveCalls,
    async loadCheckpoint() {
      return {
        cursor: checkpoint.cursor ? { ...checkpoint.cursor } : null,
        recordStates: checkpoint.recordStates.map((record) => ({ ...record })),
      };
    },
    async saveCheckpoint(value) {
      saveCalls.push(value);
      const states = value.fullSnapshot
        ? new Map()
        : new Map(checkpoint.recordStates.map((record) => [record.sourceRecordId, record]));
      for (const record of value.records) {
        states.set(record.sourceRecordId, {
          ...record,
          lastSeenSyncRunId: value.cursor.lastSyncRunId,
          lastSeenAt: value.cursor.lastSuccessfulSyncAt,
        });
      }
      checkpoint = {
        cursor: { ...value.cursor },
        recordStates: [...states.values()],
      };
      return { cursorKey: value.cursor.cursorKey, recordsSaved: value.records.length };
    },
  };
}

function rawVideo(handle, id, recordId = `raw_${id}`) {
  return {
    recordId,
    fields: {
      'Unique identifier of the video': id,
      'Date and time the video was published': 1782873000000,
      'Video Description': 'Demo video',
      'Shareable URL': `https://www.tiktok.com/@${handle}/video/${id}`,
      'Video duration in seconds, rounded to three decimal places': 15,
      'Total video views': 100,
      'Total number of likes the video received': 12,
      'Percentage of video watched completely': '50%',
    },
  };
}

function dictionaryRow() {
  return {
    recordId: 'dict_1',
    fields: {
      rule_key: 'theme_demo',
      target_field: 'content_theme',
      output_value: 'สรุปเนื้อหา',
      aliases: 'demo',
      match_type: 'contains',
      platform: ['tiktok'],
      applies_to: ['organic'],
      priority: 50,
      confidence: 80,
      enabled: true,
    },
  };
}

function tableIds() {
  return {
    rawTikTokCreatorVideos: 'tbl_raw_tiktok_creator',
    mktAccounts: 'tbl_mkt_accounts',
    mktContent: 'tbl_mkt_content',
    mktContentDaily: 'tbl_mkt_content_daily',
    mktClassificationDictionary: 'tbl_dictionary',
  };
}
