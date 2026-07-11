import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTikTokCreatorVideo } from '../../packages/application/src/use-cases/normalize-tiktok-creator-video.js';

test('normalizes a TikTok Creator raw row into MKT content and daily snapshot rows', () => {
  const normalized = normalizeTikTokCreatorVideo({
    accountId: 'tt_account_1',
    metricDate: '2026-07-06',
    rawRow: {
      video_id: 'video_1',
      description: 'Launch clip',
      shareable_url: 'https://www.tiktok.com/@brand/video/video_1',
      duration_seconds: 30,
      views: 1000,
      likes: 120,
      comments: 10,
      shares: 5,
      unique_viewers: 800,
      average_play_duration: 8.5,
      total_play_duration: 8500,
      completion_rate: 0.35,
      traffic_sources: 'For You 80%, Search 20%',
      country_region_breakdown: 'TH 100%',
    },
  });

  assert.deepEqual(normalized.content, {
    content_key: 'tiktok:tt_account_1:video_1',
    platform: 'tiktok',
    account_id: 'tt_account_1',
    external_content_id: 'video_1',
    content_type: 'video',
    published_at: null,
    caption: 'Launch clip',
    content_url: 'https://www.tiktok.com/@brand/video/video_1',
    thumbnail_url: null,
    duration_seconds: 30,
    latest_views: 1000,
    latest_likes: 120,
    latest_comments: 10,
    latest_shares: 5,
    latest_unique_viewers: 800,
    avg_watch_time_seconds: 8.5,
    completion_rate: 0.35,
    course_name: null,
    course_level: [],
    course_type: null,
    content_theme: null,
    funnel_stage: null,
    cta_type: 'none',
    cta_destination: null,
    promotion_type: 'none',
    urgency_level: 'none',
    classification_source: 'rule',
    classification_confidence: 0.2,
    manual_tag_note: 'manual_review: no enabled dictionary rule matched',
  });

  assert.equal(normalized.dailySnapshot.content_daily_key, 'tiktok:tt_account_1:video_1:2026-07-06');
  assert.equal(normalized.dailySnapshot.metric_date, Date.parse('2026-07-06T00:00:00+07:00'));
  assert.equal(normalized.dailySnapshot.total_watch_time_seconds, 8500);
  assert.equal(normalized.dailySnapshot.traffic_sources, 'For You 80%, Search 20%');
});

test('requires a metric date to avoid non-repeatable snapshots', () => {
  assert.throws(
    () => normalizeTikTokCreatorVideo({ accountId: 'tt_account_1', metricDate: '20260706', rawRow: { video_id: 'video_1' } }),
    /metricDate must be YYYY-MM-DD/,
  );
});


test('normalizes Lark URL objects into canonical URL strings before Lark destination serialization', () => {
  const normalized = normalizeTikTokCreatorVideo({
    accountId: 'chemistry_k',
    metricDate: '2026-07-11',
    rawRow: {
      video_id: '7599997064940064021',
      shareable_url: [{
        link: 'https://www.tiktok.com/@chemistry_k/video/7599997064940064021',
        text: 'TikTok video',
        type: 'url',
      }],
    },
  });

  assert.equal(
    normalized.content.content_url,
    'https://www.tiktok.com/@chemistry_k/video/7599997064940064021',
  );
});
