import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLarkLiveSync } from '../../packages/application/src/use-cases/validate-lark-live-sync.js';
import { syncTikTokCreatorNativeToLark } from '../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

test('validates live Lark sync through the production plan path without writing rows', async () => {
  let writeCalls = 0;
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'tt_account_1', id: 'video_1', description: 'DEK73 สรุปตารางธาตุ' })],
    dictionaryRecords: [
      dictionaryRow('course_level_dek73', 'course_level', 'DEK73', 'DEK73, dek73', 100, 95),
      dictionaryRow('theme_summary', 'content_theme', 'สรุปเนื้อหา', 'สรุป, ตารางธาตุ', 80, 85),
    ],
    onWrite() { writeCalls += 1; },
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-09',
    tables: tableIds(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.rawRecords, 1);
  assert.equal(result.classificationRules, 2);
  assert.equal(result.contentRows, 1);
  assert.equal(result.dailySnapshotRows, 1);
  assert.equal(result.syncPlan.content.createRows, 1);
  assert.equal(result.syncPlan.dailySnapshots.createRows, 1);
  assert.equal(result.sample.matchedContentRows, 1);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(writeCalls, 0);
});

test('validation is not ready when any raw row is skipped', async () => {
  const repository = createRepository({
    rawRecords: [{ recordId: 'bad_1', fields: { 'Unique identifier of the video': '' } }],
    dictionaryRecords: [],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-09',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.skippedRows.length, 1);
  assert.match(result.issues.join('\n'), /no enabled valid rules/i);
  assert.match(result.issues.join('\n'), /failed normalization/i);
});

test('TikTok sync dryRun builds create/update plans but does not execute them', async () => {
  let writeCalls = 0;
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'tt_account_1', id: 'video_1', description: 'สรุปเนื้อหา' })],
    dictionaryRecords: [dictionaryRow('theme_summary', 'content_theme', 'สรุปเนื้อหา', 'สรุป', 80, 85)],
    onWrite() { writeCalls += 1; },
  });

  const result = await syncTikTokCreatorNativeToLark({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-09',
    dryRun: true,
    tables: tableIds(),
  });

  assert.equal(result.mode, 'dry_run');
  assert.equal(result.readyToWrite, true);
  assert.equal(result.content.rowsReady, 1);
  assert.equal(result.content.createRows, 1);
  assert.equal(result.dailySnapshots.rowsReady, 1);
  assert.equal(writeCalls, 0);
});

test('validation blocks a mismatched or undetectable RAW TikTok handle', async () => {
  const mismatchRepository = createRepository({
    rawRecords: [rawVideo({ handle: 'other_brand', id: 'v1' })],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
  });
  const missingHandleRepository = createRepository({
    rawRecords: [{
      recordId: 'raw_no_handle',
      fields: {
        'Unique identifier of the video': 'v2',
        'Shareable URL': 'https://example.com/video/v2',
        'Video Description': 'video',
      },
    }],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
  });

  const mismatch = await validateLarkLiveSync({
    repository: mismatchRepository,
    syncEngine: new TableSyncEngine(),
    accountId: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });
  const missing = await validateLarkLiveSync({
    repository: missingHandleRepository,
    syncEngine: new TableSyncEngine(),
    accountId: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.sourceIdentity.detectedHandles, ['other_brand']);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.sourceIdentity.detectedHandles, []);
});

test('validation reports account identity conflicts from old dev/prod keys', async () => {
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'ft.pumkin', id: 'v1' })],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
    destinationRecords: [{
      recordId: 'old_record',
      fields: {
        platform: 'tiktok',
        external_content_id: 'v1',
        account_id: 'chemistry_k',
        content_key: 'tiktok:chemistry_k:v1',
      },
    }],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'ft_pumkin',
    sourceHandle: 'ft.pumkin',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.accountConflicts.length, 1);
  assert.match(result.issues.join('\n'), /destination identity conflict/i);
});

function createRepository(input) {
  const contentRecords = input.destinationRecords ?? [];
  const dailyRecords = input.dailyDestinationRecords ?? [];
  const recordsFor = (tableId) => tableId === 'tbl_content_daily' ? dailyRecords : contentRecords;
  return {
    async listAll(tableId) {
      if (tableId === 'tbl_raw') return input.rawRecords;
      if (tableId === 'tbl_dictionary') return input.dictionaryRecords;
      return recordsFor(tableId);
    },
    async listByFieldValues(tableId, fieldName, values) {
      const allowed = new Set(values);
      return recordsFor(tableId).filter((record) => allowed.has(String(record.fields?.[fieldName] ?? '')));
    },
    async prepareRows(_tableId, rows) { return rows; },
    async createMany() { input.onWrite?.(); return { created: 0 }; },
    async updateMany() { input.onWrite?.(); return { updated: 0 }; },
  };
}

function rawVideo({ handle, id, description = 'video' }) {
  return {
    recordId: `raw_${id}`,
    fields: {
      'Unique identifier of the video': id,
      'Video Description': description,
      'Shareable URL': `https://www.tiktok.com/@${handle}/video/${id}`,
      'Date and time the video was published': 1782871200000,
      'Total video views': 100,
    },
  };
}

function tableIds() {
  return {
    rawTikTokCreatorVideos: 'tbl_raw',
    mktAccounts: 'tbl_accounts',
    mktClassificationDictionary: 'tbl_dictionary',
    mktContent: 'tbl_content',
    mktContentDaily: 'tbl_content_daily',
  };
}

function dictionaryRow(ruleKey, targetField, outputValue, aliases, priority, confidence) {
  return {
    recordId: ruleKey,
    fields: {
      rule_key: ruleKey,
      target_field: targetField,
      output_value: outputValue,
      aliases,
      match_type: 'contains',
      platform: ['tiktok'],
      applies_to: ['organic'],
      priority,
      confidence,
      enabled: true,
    },
  };
}


test('validation also detects account identity conflicts left in the daily snapshot table', async () => {
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'ft.pumkin', id: 'v_daily' })],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
    dailyDestinationRecords: [{
      recordId: 'old_daily',
      fields: {
        platform: 'tiktok',
        external_content_id: 'v_daily',
        account_id: 'chemistry_k',
        content_daily_key: 'tiktok:chemistry_k:v_daily:2026-07-11',
      },
    }],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'ft_pumkin',
    sourceHandle: 'ft.pumkin',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.accountConflicts.length, 1);
  assert.equal(result.accountConflicts[0].tableRole, 'daily_snapshot');
});


test('validation blocks duplicate RAW identities instead of choosing a random metric row', async () => {
  const repository = createRepository({
    rawRecords: [
      rawVideo({ handle: 'tt_account_1', id: 'duplicate_video' }),
      rawVideo({ handle: 'tt_account_1', id: 'duplicate_video' }),
    ],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.join('\n'), /duplicate RAW content identity/i);
});

test('validation blocks enabled classification dictionary rows with invalid contracts', async () => {
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'tt_account_1', id: 'video_invalid_dictionary', description: 'สรุป' })],
    dictionaryRecords: [
      dictionaryRow('valid_rule', 'content_theme', 'สรุปเนื้อหา', 'สรุป', 10, 80),
      {
        recordId: 'bad_rule',
        fields: {
          rule_key: 'bad_rule',
          target_field: 'content_theme',
          output_value: 'สรุปเนื้อหา',
          aliases: 'สรุป',
          match_type: 'starts_with',
          enabled: true,
        },
      },
    ],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.classificationRules, 1);
  assert.equal(result.classificationDictionary.invalidRows.length, 1);
  assert.match(result.issues.join('\n'), /classification dictionary row\(s\) are invalid/i);
});


test('validation blocks legacy content stable keys even when account_id is unchanged', async () => {
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'ft.pumkin', id: 'v_legacy_key' })],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
    destinationRecords: [{
      recordId: 'legacy_content',
      fields: {
        platform: 'tiktok',
        external_content_id: 'v_legacy_key',
        account_id: 'ft_pumkin',
        content_key: 'tiktok::ft_pumkin::v_legacy_key',
      },
    }],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'ft_pumkin',
    sourceHandle: 'ft.pumkin',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.accountConflicts.length, 1);
  assert.equal(result.accountConflicts[0].conflictType, 'stable_key_mismatch');
  assert.equal(result.accountConflicts[0].incomingStableKey, 'tiktok:ft_pumkin:v_legacy_key');
});

test('validation blocks legacy daily keys for the same account and metric date', async () => {
  const metricDate = Date.parse('2026-07-11T00:00:00+07:00');
  const repository = createRepository({
    rawRecords: [rawVideo({ handle: 'ft.pumkin', id: 'v_legacy_daily' })],
    dictionaryRecords: [dictionaryRow('theme', 'content_theme', 'ทั่วไป', 'video', 1, 80)],
    dailyDestinationRecords: [{
      recordId: 'legacy_daily',
      fields: {
        platform: 'tiktok',
        external_content_id: 'v_legacy_daily',
        account_id: 'ft_pumkin',
        metric_date: metricDate,
        content_daily_key: 'tiktok::ft_pumkin::v_legacy_daily::2026-07-11',
      },
    }],
  });

  const result = await validateLarkLiveSync({
    repository,
    syncEngine: new TableSyncEngine(),
    accountId: 'ft_pumkin',
    sourceHandle: 'ft.pumkin',
    metricDate: '2026-07-11',
    tables: tableIds(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.accountConflicts.length, 1);
  assert.equal(result.accountConflicts[0].conflictType, 'stable_key_mismatch');
  assert.equal(result.accountConflicts[0].metricDate, metricDate);
});
