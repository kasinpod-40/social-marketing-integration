import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTikTokCreatorNativeToLark } from '../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';

test('reads RAW TikTok Creator rows and upserts content plus daily snapshots', async () => {
  const syncCalls = [];
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listAll(tableId) {
      if (tableId === 'tbl_dictionary') {
        return [
          {
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
          },
        ];
      }

      assert.equal(tableId, 'tbl_raw_tiktok_creator');
      return [
        {
          recordId: 'rec_1',
          fields: {
            'Unique identifier of the video': 'video_1',
            'Date and time the video was published': 1782873000000,
            'Video Description': 'Demo video',
            'Shareable URL': 'https://example.com/video_1',
            'Video duration in seconds, rounded to three decimal places': 15,
            'Total video views': 100,
            'Total number of likes the video received': 12,
            'Percentage of video watched completely': '50%',
          },
        },
        {
          recordId: 'rec_bad',
          fields: {
            'Unique identifier of the video': '',
            'Total video views': 10,
          },
        },
      ];
    },
    async createMany() { return { created: 0 }; },
    async updateMany() { return { updated: 0 }; },
  };

  const syncEngine = {
    async syncByKey(input) {
      syncCalls.push(input);
      return { created: input.rows.length, updated: 0, skipped: 0, duplicateInputRows: 0 };
    },
  };

  const result = await syncTikTokCreatorNativeToLark({
    repository,
    syncEngine,
    accountId: 'tt_account_1',
    metricDate: '2026-07-07',
    tables: {
      rawTikTokCreatorVideos: 'tbl_raw_tiktok_creator',
      mktContent: 'tbl_mkt_content',
      mktContentDaily: 'tbl_mkt_content_daily',
      mktClassificationDictionary: 'tbl_dictionary',
    },
  });

  assert.equal(result.mode, 'write');
  assert.equal(result.rawRecords, 2);
  assert.equal(result.classificationRules, 1);
  assert.equal(result.skippedRows.length, 1);
  assert.equal(syncCalls.length, 2);
  assert.equal(syncCalls[0].tableId, 'tbl_mkt_content');
  assert.equal(syncCalls[0].keyField, 'content_key');
  assert.equal(syncCalls[0].rows[0].content_key, 'tiktok:tt_account_1:video_1');
  assert.equal(syncCalls[0].rows[0].content_theme, 'สรุปเนื้อหา');
  assert.equal(syncCalls[1].tableId, 'tbl_mkt_content_daily');
  assert.equal(syncCalls[1].keyField, 'content_daily_key');
  assert.equal(syncCalls[1].rows[0].completion_rate, 0.5);
});

test('refuses to write TikTok rows from a different source account', async () => {
  const repository = {
    async listAll(tableId) {
      if (tableId === 'raw') return [{ fields: {
        'Unique identifier of the video': [{ type: 'text', text: 'v1' }],
        'Shareable URL for this TikTok video': [{ type: 'url', link: 'https://www.tiktok.com/@wrong/video/v1', text: 'open' }],
      } }];
      if (tableId === 'dict') return [];
      return [];
    },
    async createMany() { throw new Error('must not write'); },
    async updateMany() { throw new Error('must not write'); },
  };
  const syncEngine = { async syncByKey() { throw new Error('must not sync'); } };

  await assert.rejects(
    () => syncTikTokCreatorNativeToLark({
      repository,
      syncEngine,
      accountId: 'chemistry_k',
      metricDate: '2026-07-11',
      tables: { rawTikTokCreatorVideos: 'raw', mktClassificationDictionary: 'dict', mktContent: 'content', mktContentDaily: 'daily' },
    }),
    /does not match TIKTOK_CREATOR_ACCOUNT_ID/,
  );
});
