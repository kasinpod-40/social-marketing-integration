import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTikTokCreatorVideoBatch } from '../../packages/application/src/use-cases/normalize-tiktok-creator-video-batch.js';

test('normalizes TikTok Creator rows as an O(n) batch with dedupe by upsert key', () => {
  const result = normalizeTikTokCreatorVideoBatch({
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-07',
    rawRows: [
      {
        'Unique identifier of the video': 'video_1',
        'Date and time the video was published': 1769512200000,
        'Total video views': 203,
        'Total number of likes the video received': 22,
        'Total number of comments the video received': 0,
        'Total number of times the video was shared': 2,
        'Video duration in seconds, rounded to three decimal places': 31.567,
        'Average video play duration based on all views': 8.1,
        'Percentage of video watched completely': '40%',
        'Total number of viewers who watched the video (deduplicated)': 180,
        'Different sources of video exposure, arranged by exposure percentage': 'For You 80%, Search 20%',
        'Breakdown percentage data of audience country/region': 'TH 100%',
      },
      {
        'Unique identifier of the video': 'video_1',
        'Total video views': 203,
      },
      {
        'Unique identifier of the video': 'video_2',
        'Total video views': 313,
      },
    ],
  });

  assert.equal(result.contentRows.length, 2);
  assert.equal(result.dailySnapshotRows.length, 2);
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.contentRows[0].content_key, 'tiktok:tt_account_1:video_1');
  assert.equal(result.dailySnapshotRows[0].completion_rate, 0.4);
  assert.equal(result.dailySnapshotRows[0].unique_viewers, 180);
});

test('collects invalid TikTok Creator rows without failing the entire batch', () => {
  const result = normalizeTikTokCreatorVideoBatch({
    accountId: 'tt_account_1',
    sourceHandle: 'tt_account_1',
    metricDate: '2026-07-07',
    rawRows: [
      { video_id: 'video_1', views: 100 },
      { video_id: '', views: 200 },
      { video_id: 'video_3', views: 'not-a-number' },
    ],
  });

  assert.equal(result.contentRows.length, 1);
  assert.equal(result.dailySnapshotRows.length, 1);
  assert.equal(result.skippedRows.length, 2);
  assert.match(result.skippedRows[0].reason, /externalContentId/);
  assert.match(result.skippedRows[1].reason, /TikTok numeric metric must be finite/);
});
