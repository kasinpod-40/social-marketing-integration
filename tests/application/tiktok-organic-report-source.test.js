import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateInTimeZone,
  normalizeTikTokContentRecords,
  normalizeTikTokDailySnapshotRecords,
} from '../../packages/application/src/reports/tiktok-organic-report-source.js';

test('normalizes only TikTok rows for the requested account', () => {
  const rows = normalizeTikTokContentRecords([
    { recordId: 'content-1', fields: {
      content_key: 'tiktok:ft_pumkin:1', external_content_id: '1', account_id: 'ft_pumkin',
      platform: 'tiktok', caption: 'hello', content_url: { link: 'https://tiktok.com/v/1' },
      thumbnail_url: 'https://example.com/1.jpg', published_at: Date.parse('2026-07-12T01:00:00Z'),
    } },
    { recordId: 'other', fields: {
      content_key: 'instagram:ft_pumkin:2', external_content_id: '2', account_id: 'ft_pumkin', platform: 'instagram',
    } },
  ], { accountId: 'ft_pumkin', timeZone: 'Asia/Bangkok' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].publishedDate, '2026-07-12');
  assert.equal(rows[0].contentUrl, 'https://tiktok.com/v/1');
});

test('normalizes cumulative daily metrics and Bangkok metric date', () => {
  const rows = normalizeTikTokDailySnapshotRecords([{ record_id: 'daily-1', fields: {
    content_daily_key: 'tiktok:ft_pumkin:1:2026-07-12',
    external_content_id: '1', account_id: 'ft_pumkin', platform: 'tiktok',
    metric_date: Date.parse('2026-07-11T17:00:00Z'), views: '1,200', likes: 100,
    comments: 20, shares: 5, unique_viewers: 900, avg_watch_time_seconds: 3.5,
    total_watch_time_seconds: 4200, completion_rate: 0.25,
  } }], { accountId: 'ft_pumkin', timeZone: 'Asia/Bangkok' });

  assert.equal(rows[0].metricDate, '2026-07-12');
  assert.equal(rows[0].views, 1200);
  assert.equal(rows[0].completionRate, 0.25);
});

test('timezone conversion crosses the Bangkok date boundary correctly', () => {
  assert.equal(dateInTimeZone('2026-07-11T16:59:59Z', 'Asia/Bangkok'), '2026-07-11');
  assert.equal(dateInTimeZone('2026-07-11T17:00:00Z', 'Asia/Bangkok'), '2026-07-12');
});
