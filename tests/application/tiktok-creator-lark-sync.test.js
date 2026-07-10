import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTikTokCreatorNativeToLark } from '../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';

test('reads RAW TikTok Creator rows and upserts content plus daily snapshots', async () => {
  const upserts = [];
  const repository = {
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
            'Date and time the video was published': '2026-07-01 08:30',
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
    async upsertByKey(input) {
      upserts.push(input);
      return { created: input.rows.length, updated: 0, skipped: 0 };
    },
  };

  const result = await syncTikTokCreatorNativeToLark({
    repository,
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
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].tableId, 'tbl_mkt_content');
  assert.equal(upserts[0].keyField, 'content_key');
  assert.equal(upserts[0].rows[0].content_key, 'tiktok:tt_account_1:video_1');
  assert.equal(upserts[0].rows[0].content_theme, 'สรุปเนื้อหา');
  assert.equal(upserts[1].tableId, 'tbl_mkt_content_daily');
  assert.equal(upserts[1].keyField, 'content_daily_key');
  assert.equal(upserts[1].rows[0].completion_rate, 0.5);
});
