import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrganicContentRows } from '../../packages/domain/src/entities/organic-content.js';

test('creates platform-neutral master and cumulative daily rows with deterministic keys', () => {
  const result = createOrganicContentRows({
    platform: 'youtube',
    accountId: 'channel_main',
    externalContentId: 'video_1',
    metricDate: '2026-07-15',
    sourceTimezone: 'Asia/Bangkok',
    contentType: 'video',
    caption: 'Lesson 1',
    metrics: { views: 100, likes: 4, comments: 1, shares: null },
    classification: { course_level: [], classification_confidence: 0.5 },
  });

  assert.equal(result.content.content_key, 'youtube:channel_main:video_1');
  assert.equal(result.dailySnapshot.content_daily_key, 'youtube:channel_main:video_1:2026-07-15');
  assert.equal(result.content.latest_shares, null);
  assert.equal(result.dailySnapshot.metric_date, Date.parse('2026-07-15T00:00:00+07:00'));
});

test('uses the explicit source timezone instead of assuming Bangkok', () => {
  const winter = createOrganicContentRows({
    platform: 'youtube',
    accountId: 'channel_main',
    externalContentId: 'video_winter',
    metricDate: '2026-01-15',
    sourceTimezone: 'America/Los_Angeles',
  });
  const summer = createOrganicContentRows({
    platform: 'youtube',
    accountId: 'channel_main',
    externalContentId: 'video_summer',
    metricDate: '2026-07-15',
    sourceTimezone: 'America/Los_Angeles',
  });

  assert.equal(winter.dailySnapshot.metric_date, Date.parse('2026-01-15T00:00:00-08:00'));
  assert.equal(summer.dailySnapshot.metric_date, Date.parse('2026-07-15T00:00:00-07:00'));
});

test('preserves null and rejects missing timezone or invalid metric values', () => {
  const result = createOrganicContentRows({
    platform: 'youtube', accountId: 'a', externalContentId: 'v', metricDate: '2026-07-15',
    sourceTimezone: 'Asia/Bangkok',
  });
  assert.equal(result.content.latest_views, null);
  assert.throws(
    () => createOrganicContentRows({
      platform: 'youtube', accountId: 'a', externalContentId: 'v', metricDate: '2026-07-15',
    }),
    /sourceTimezone/,
  );
  assert.throws(
    () => createOrganicContentRows({
      platform: 'youtube', accountId: 'a', externalContentId: 'v', metricDate: '2026-07-15',
      sourceTimezone: 'Asia/Bangkok',
      metrics: { views: -1 },
    }),
    /non-negative safe integer/,
  );
});
