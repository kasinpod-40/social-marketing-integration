import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTikTokCreatorNativeToLark } from '../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

test('preflights both tables before writing and then creates content plus daily snapshots', async () => {
  const writes = [];
  const repository = createRepository({
    rawRecords: [rawVideo('tt_account_1', 'video_1')],
    dictionaryRecords: [dictionaryRow()],
    async createMany(tableId, rows) {
      writes.push({ tableId, rows });
      return { created: rows.length };
    },
  });

  const result = await syncTikTokCreatorNativeToLark({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-07',
    tables: tableIds(),
  });

  assert.equal(result.mode, 'write');
  assert.equal(result.content.created, 1);
  assert.equal(result.dailySnapshots.created, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].tableId, 'tbl_mkt_content');
  assert.equal(writes[0].rows[0].content_key, 'tiktok:tt_account_1:video_1');
  assert.equal(writes[1].tableId, 'tbl_mkt_content_daily');
  assert.equal(writes[1].rows[0].completion_rate, 0.5);
});

test('does not write content when daily snapshot preflight fails', async () => {
  let writeCalls = 0;
  const repository = createRepository({
    rawRecords: [rawVideo('tt_account_1', 'video_1')],
    dictionaryRecords: [dictionaryRow()],
    async prepareRows(tableId, rows) {
      if (tableId === 'tbl_mkt_content_daily') throw new Error('daily schema broken');
      return rows;
    },
    async createMany() { writeCalls += 1; return { created: 1 }; },
  });

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      repository,
      syncEngine: new TableSyncEngine(),
      accountId: 'tt_account_1',
      sourceHandle: 'tt_account_1',
      metricDate: '2026-07-07',
      tables: tableIds(),
    }),
    /daily schema broken/,
  );
  assert.equal(writeCalls, 0);
});

test('refuses the whole write when any raw row fails normalization', async () => {
  let writeCalls = 0;
  const repository = createRepository({
    rawRecords: [
      rawVideo('tt_account_1', 'video_1'),
      { recordId: 'bad', fields: { 'Unique identifier of the video': '' } },
    ],
    dictionaryRecords: [dictionaryRow()],
    async createMany() { writeCalls += 1; return { created: 1 }; },
  });

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      repository,
      syncEngine: new TableSyncEngine(),
      accountId: 'tt_account_1',
      sourceHandle: 'tt_account_1',
      metricDate: '2026-07-07',
      tables: tableIds(),
    }),
    /failed normalization/,
  );
  assert.equal(writeCalls, 0);
});

test('refuses a different source account before any destination schema or lookup request', async () => {
  let destinationCalls = 0;
  const repository = createRepository({
    rawRecords: [rawVideo('wrong', 'v1')],
    dictionaryRecords: [dictionaryRow()],
    async prepareRows() { destinationCalls += 1; return []; },
  });
  const originalListByFieldValues = repository.listByFieldValues;
  repository.listByFieldValues = async (...args) => {
    destinationCalls += 1;
    return originalListByFieldValues(...args);
  };

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      repository,
      syncEngine: new TableSyncEngine(),
      accountId: 'chemistry_k',
      sourceHandle: 'chemistry_k',
      metricDate: '2026-07-11',
      tables: tableIds(),
    }),
    /source handle mismatch/i,
  );
  assert.equal(destinationCalls, 0);
});

function createRepository(input) {
  const destinationRecords = input.destinationRecords ?? [];
  return {
    async listAll(tableId) {
      if (tableId === 'tbl_raw_tiktok_creator') return input.rawRecords;
      if (tableId === 'tbl_dictionary') return input.dictionaryRecords;
      return destinationRecords;
    },
    async listByFieldValues(_tableId, fieldName, values) {
      const allowed = new Set(values);
      return destinationRecords.filter((record) => allowed.has(String(record.fields?.[fieldName] ?? '')));
    },
    async prepareRows(tableId, rows) {
      return input.prepareRows ? input.prepareRows(tableId, rows) : rows;
    },
    async createMany(tableId, rows) {
      return input.createMany ? input.createMany(tableId, rows) : { created: rows.length };
    },
    async updateMany(_tableId, rows) { return { updated: rows.length }; },
  };
}

function rawVideo(handle, id) {
  return {
    recordId: `raw_${id}`,
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
    mktContent: 'tbl_mkt_content',
    mktContentDaily: 'tbl_mkt_content_daily',
    mktClassificationDictionary: 'tbl_dictionary',
  };
}

test('detects missing daily snapshots and reconciles them on the normal rerun path', async () => {
  const existingContent = {
    recordId: 'content_1',
    fields: {
      content_key: 'tiktok:tt_account_1:video_1',
      platform: 'tiktok',
      account_id: 'tt_account_1',
      external_content_id: 'video_1',
    },
  };
  const recordsByTable = {
    tbl_mkt_content: [existingContent],
    tbl_mkt_content_daily: [],
  };
  const writes = [];
  const repository = {
    async listAll(tableId) {
      if (tableId === 'tbl_raw_tiktok_creator') return [rawVideo('tt_account_1', 'video_1')];
      if (tableId === 'tbl_dictionary') return [dictionaryRow()];
      return recordsByTable[tableId] ?? [];
    },
    async listByFieldValues(tableId, fieldName, values) {
      const allowed = new Set(values.map(String));
      return (recordsByTable[tableId] ?? []).filter((record) => allowed.has(String(record.fields?.[fieldName] ?? '')));
    },
    async prepareRows(_tableId, rows) { return rows; },
    async createMany(tableId, rows) { writes.push({ operation: 'create', tableId, rows }); return { created: rows.length }; },
    async updateMany(tableId, rows) { writes.push({ operation: 'update', tableId, rows }); return { updated: rows.length }; },
  };

  const result = await syncTikTokCreatorNativeToLark({
    syncRunId: 'run-reconcile',
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-07',
    tables: tableIds(),
  });

  assert.equal(result.syncRunId, 'run-reconcile');
  assert.equal(result.reconciliation.required, true);
  assert.equal(result.reconciliation.missingDailySnapshotRows, 1);
  assert.equal(result.reconciliation.status, 'recovered');
  assert.equal(result.dailySnapshots.created, 1);
  assert.ok(writes.some((write) => write.tableId === 'tbl_mkt_content_daily' && write.operation === 'create'));
});

test('wraps a daily write failure as retryable partial sync with the completed content result', async () => {
  const repository = createRepository({
    rawRecords: [rawVideo('tt_account_1', 'video_1')],
    dictionaryRecords: [dictionaryRow()],
    async createMany(tableId, rows) {
      if (tableId === 'tbl_mkt_content_daily') throw new Error('daily network timeout');
      return { created: rows.length };
    },
  });

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      syncRunId: 'run-partial',
      repository,
      syncEngine: new TableSyncEngine(),
      accountId: 'tt_account_1',
      sourceHandle: 'tt_account_1',
      metricDate: '2026-07-07',
      tables: tableIds(),
    }),
    (error) => {
      assert.equal(error.code, 'SYNC_PARTIAL_WRITE');
      assert.equal(error.retryable, true);
      assert.equal(error.partialResult.syncRunId, 'run-partial');
      assert.equal(error.partialResult.content.created, 1);
      assert.equal(error.partialResult.dailySnapshots.writeOutcome, 'unknown');
      return true;
    },
  );
});

test('incremental first run saves a full checkpoint and unchanged rerun skips destination I/O', async () => {
  const repository = createStatefulRepository({
    rawRecords: [rawVideo('tt_account_1', 'video_1')],
    dictionaryRecords: [dictionaryRow()],
  });
  const stateStore = createIncrementalStateStore();

  const first = await syncTikTokCreatorNativeToLark({
    syncRunId: 'run-incremental-1',
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-12',
    tables: tableIds(),
    incrementalEnabled: true,
    incrementalStateStore: stateStore,
    cursorKey: 'profile:tiktok:tt_account_1:native_import',
    customerProfile: 'profile',
    syncMode: 'auto',
    fullSyncIntervalMs: 86_400_000,
    now: () => 1_000,
  });

  assert.equal(first.incremental.mode, 'full');
  assert.equal(first.incremental.reason, 'initial_checkpoint');
  assert.equal(first.incremental.checkpointSaved, true);
  assert.equal(first.processedRawRecords, 1);
  assert.equal(stateStore.saveCalls.length, 1);
  assert.equal(stateStore.saveCalls[0].fullSnapshot, true);
  assert.equal(stateStore.saveCalls[0].records.length, 1);

  const destinationCallsBefore = repository.destinationReadCalls.length;
  const writesBefore = repository.writeCalls.length;
  const second = await syncTikTokCreatorNativeToLark({
    syncRunId: 'run-incremental-2',
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-12',
    tables: tableIds(),
    incrementalEnabled: true,
    incrementalStateStore: stateStore,
    cursorKey: 'profile:tiktok:tt_account_1:native_import',
    customerProfile: 'profile',
    syncMode: 'auto',
    fullSyncIntervalMs: 86_400_000,
    now: () => 2_000,
  });

  assert.equal(second.incremental.mode, 'incremental');
  assert.equal(second.incremental.reason, 'no_source_changes');
  assert.equal(second.incremental.selectedRecords, 0);
  assert.equal(second.incremental.checkpointSaved, true);
  assert.equal(second.processedRawRecords, 0);
  assert.equal(second.content.skipped, 1);
  assert.equal(second.dailySnapshots.skipped, 1);
  assert.equal(repository.destinationReadCalls.length, destinationCallsBefore);
  assert.equal(repository.writeCalls.length, writesBefore);
  assert.equal(stateStore.saveCalls.length, 2);
  assert.equal(stateStore.saveCalls[1].records.length, 0);
  assert.equal(stateStore.saveCalls[1].fullSnapshot, false);
});

test('same-day incremental run reads and updates only the changed TikTok record', async () => {
  const firstVideo = rawVideo('tt_account_1', 'video_1');
  const secondVideo = rawVideo('tt_account_1', 'video_2');
  const repository = createStatefulRepository({
    rawRecords: [firstVideo, secondVideo],
    dictionaryRecords: [dictionaryRow()],
  });
  const stateStore = createIncrementalStateStore();
  const common = {
    repository,
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-12',
    tables: tableIds(),
    incrementalEnabled: true,
    incrementalStateStore: stateStore,
    cursorKey: 'profile:tiktok:tt_account_1:native_import',
    customerProfile: 'profile',
    syncMode: 'auto',
    fullSyncIntervalMs: 86_400_000,
  };

  await syncTikTokCreatorNativeToLark({
    ...common,
    syncRunId: 'run-changed-1',
    syncEngine: new TableSyncEngine(),
    now: () => 1_000,
  });

  repository.rawRecords = [
    firstVideo,
    {
      ...secondVideo,
      fields: {
        ...secondVideo.fields,
        'Total video views': 999,
      },
    },
  ];
  repository.destinationReadCalls.length = 0;
  repository.writeCalls.length = 0;

  const result = await syncTikTokCreatorNativeToLark({
    ...common,
    syncRunId: 'run-changed-2',
    syncEngine: new TableSyncEngine(),
    now: () => 2_000,
  });

  assert.equal(result.incremental.mode, 'incremental');
  assert.equal(result.incremental.reason, 'source_records_changed');
  assert.equal(result.incremental.selectedRecords, 1);
  assert.equal(result.processedRawRecords, 1);
  assert.equal(result.content.updated, 1);
  assert.equal(result.content.skipped, 1);
  assert.equal(result.dailySnapshots.updated, 1);
  assert.equal(result.dailySnapshots.skipped, 1);
  assert.ok(repository.destinationReadCalls.length > 0);
  for (const call of repository.destinationReadCalls) {
    assert.ok(call.values.every((value) => String(value).includes('video_2')));
  }
  assert.equal(stateStore.saveCalls.at(-1).records.length, 1);
  assert.equal(stateStore.saveCalls.at(-1).records[0].externalContentId, 'video_2');
});

test('checkpoint write failure happens after Lark writes and remains retryable', async () => {
  const repository = createStatefulRepository({
    rawRecords: [rawVideo('tt_account_1', 'video_1')],
    dictionaryRecords: [dictionaryRow()],
  });
  const error = Object.assign(new Error('D1 checkpoint unavailable'), {
    code: 'D1_INCREMENTAL_CHECKPOINT_WRITE_FAILED',
    retryable: true,
  });
  const stateStore = {
    async loadCheckpoint() { return { cursor: null, recordStates: [] }; },
    async saveCheckpoint() { throw error; },
  };

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      syncRunId: 'run-checkpoint-failure',
      repository,
      syncEngine: new TableSyncEngine(),
      accountId: 'tt_account_1',
      sourceHandle: 'tt_account_1',
      metricDate: '2026-07-12',
      tables: tableIds(),
      incrementalEnabled: true,
      incrementalStateStore: stateStore,
      cursorKey: 'profile:tiktok:tt_account_1:native_import',
      customerProfile: 'profile',
      syncMode: 'auto',
      fullSyncIntervalMs: 86_400_000,
      now: () => 1_000,
    }),
    (cause) => cause === error && cause.retryable === true,
  );

  assert.equal(repository.writeCalls.length, 2);
});

function createIncrementalStateStore() {
  let checkpoint = { cursor: null, recordStates: [] };
  const saveCalls = [];
  return {
    saveCalls,
    async loadCheckpoint() {
      return {
        cursor: checkpoint.cursor,
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

function createStatefulRepository(input) {
  const recordsByTable = {
    tbl_mkt_content: [],
    tbl_mkt_content_daily: [],
  };
  let nextRecordId = 1;
  const repository = {
    rawRecords: input.rawRecords,
    dictionaryRecords: input.dictionaryRecords,
    destinationReadCalls: [],
    writeCalls: [],
    async listAll(tableId) {
      if (tableId === 'tbl_raw_tiktok_creator') return repository.rawRecords;
      if (tableId === 'tbl_dictionary') return repository.dictionaryRecords;
      return recordsByTable[tableId] ?? [];
    },
    async listByFieldValues(tableId, fieldName, values) {
      repository.destinationReadCalls.push({ tableId, fieldName, values: [...values] });
      const allowed = new Set(values.map(String));
      return (recordsByTable[tableId] ?? []).filter(
        (record) => allowed.has(String(record.fields?.[fieldName] ?? '')),
      );
    },
    async prepareRows(_tableId, rows) { return rows; },
    async createMany(tableId, rows) {
      repository.writeCalls.push({ operation: 'create', tableId, rows });
      for (const fields of rows) {
        recordsByTable[tableId].push({ recordId: `record-${nextRecordId++}`, fields: { ...fields } });
      }
      return { created: rows.length };
    },
    async updateMany(tableId, rows) {
      repository.writeCalls.push({ operation: 'update', tableId, rows });
      for (const update of rows) {
        const record = recordsByTable[tableId].find((item) => item.recordId === update.recordId);
        if (!record) throw new Error(`Missing destination record ${update.recordId}`);
        record.fields = { ...update.fields };
      }
      return { updated: rows.length };
    },
  };
  return repository;
}
