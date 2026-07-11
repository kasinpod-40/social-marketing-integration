import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLarkLiveSync } from '../../packages/application/src/use-cases/validate-lark-live-sync.js';
import { syncTikTokCreatorNativeToLark } from '../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';

test('validates live Lark sync without writing rows', async () => {
  let writeCalls = 0;
  const repository = createRepository({
    rawRecords: [
      {
        recordId: 'raw_1',
        fields: {
          'Unique identifier of the video': 'video_1',
          'Video Description': 'DEK73 สรุปตารางธาตุ สมัครผ่าน LINE',
          'Shareable URL': 'https://example.com/video_1',
          'Date and time the video was published': 1782871200000,
          'Total video views': 100,
        },
      },
    ],
    dictionaryRecords: [
      dictionaryRow('course_level_dek73', 'course_level', 'DEK73', 'DEK73, dek73', 100, 95),
      dictionaryRow('theme_summary', 'content_theme', 'สรุปเนื้อหา', 'สรุป, ตารางธาตุ', 80, 85),
    ],
    onWrite() { writeCalls += 1; },
  });

  const result = await validateLarkLiveSync({
    repository,
    accountId: 'tt_account_1',
    metricDate: '2026-07-09',
    tables: {
      rawTikTokCreatorVideos: 'tbl_raw',
      mktClassificationDictionary: 'tbl_dictionary',
      mktContent: 'tbl_content',
      mktContentDaily: 'tbl_content_daily',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.rawRecords, 1);
  assert.equal(result.classificationRules, 2);
  assert.equal(result.contentRows, 1);
  assert.equal(result.dailySnapshotRows, 1);
  assert.equal(result.sample.matchedContentRows, 1);
  assert.equal(result.sample.manualReviewRows, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(writeCalls, 0);
});

test('validation reports warnings for empty or skipped data', async () => {
  const repository = createRepository({
    rawRecords: [
      {
        recordId: 'bad_1',
        fields: {
          'Unique identifier of the video': '',
          'Total video views': 10,
        },
      },
    ],
    dictionaryRecords: [],
  });

  const result = await validateLarkLiveSync({
    repository,
    accountId: 'tt_account_1',
    metricDate: '2026-07-09',
    tables: {
      rawTikTokCreatorVideos: 'tbl_raw',
      mktClassificationDictionary: 'tbl_dictionary',
      mktContent: 'tbl_content',
      mktContentDaily: 'tbl_content_daily',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.rawRecords, 1);
  assert.equal(result.classificationRules, 0);
  assert.equal(result.contentRows, 0);
  assert.equal(result.skippedRows.length, 1);
  assert.match(result.warnings.join('\n'), /no enabled valid rules/i);
  assert.match(result.warnings.join('\n'), /skipped/i);
});

test('TikTok sync dryRun normalizes but does not upsert', async () => {
  let upsertCalls = 0;
  const repository = createRepository({
    rawRecords: [
      {
        recordId: 'raw_1',
        fields: {
          'Unique identifier of the video': 'video_1',
          'Video Description': 'สรุปเนื้อหา',
          'Shareable URL': 'https://example.com/video_1',
          'Date and time the video was published': 1782871200000,
          'Total video views': 100,
        },
      },
    ],
    dictionaryRecords: [dictionaryRow('theme_summary', 'content_theme', 'สรุปเนื้อหา', 'สรุป', 80, 85)],
    onWrite() { upsertCalls += 1; },
  });

  const result = await syncTikTokCreatorNativeToLark({
    repository,
    syncEngine: { async syncByKey() { throw new Error('dryRun must not sync'); } },
    accountId: 'tt_account_1',
    metricDate: '2026-07-09',
    dryRun: true,
    tables: {
      rawTikTokCreatorVideos: 'tbl_raw',
      mktContent: 'tbl_content',
      mktContentDaily: 'tbl_content_daily',
      mktClassificationDictionary: 'tbl_dictionary',
    },
  });

  assert.equal(result.mode, 'dry_run');
  assert.equal(result.content.rowsReady, 1);
  assert.equal(result.dailySnapshots.rowsReady, 1);
  assert.equal(upsertCalls, 0);
});

function createRepository(input) {
  return {
    async listAll(tableId) {
      if (tableId === 'tbl_raw') return input.rawRecords;
      if (tableId === 'tbl_dictionary') return input.dictionaryRecords;
      throw new Error(`Unexpected table ${tableId}`);
    },
    async prepareRows(_tableId, rows) { return rows; },
    async createMany() { input.onWrite?.(); return { created: 0 }; },
    async updateMany() { input.onWrite?.(); return { updated: 0 }; },
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

test('validation blocks writes when RAW TikTok handle does not match configured account', async () => {
  const repository = createRepository({
    rawRecords: [{
      recordId: 'raw_wrong_account',
      fields: {
        'Unique identifier of the video': [{ type: 'text', text: 'v1' }],
        'Shareable URL for this TikTok video': [{ type: 'url', link: 'https://www.tiktok.com/@other_brand/video/v1', text: 'open' }],
      },
    }],
    dictionaryRecords: [dictionaryRow('theme_summary', 'content_theme', 'สรุปเนื้อหา', 'สรุป', 80, 85)],
  });

  const result = await validateLarkLiveSync({
    repository,
    accountId: 'chemistry_k',
    metricDate: '2026-07-11',
    tables: {
      rawTikTokCreatorVideos: 'tbl_raw',
      mktClassificationDictionary: 'tbl_dictionary',
      mktContent: 'tbl_content',
      mktContentDaily: 'tbl_content_daily',
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.sourceIdentity.detectedHandles, ['other_brand']);
  assert.match(result.warnings.join('\n'), /handle mismatch/i);
});
