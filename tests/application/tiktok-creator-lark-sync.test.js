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
