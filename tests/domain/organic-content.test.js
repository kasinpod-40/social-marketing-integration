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

test('uses the supplied source timezone instead of assuming Bangkok', () => {
  const utc = createOrganicContentRows({
    platform: 'youtube',
    accountId: 'a',
    externalContentId: 'v',
    metricDate: '2026-07-15',
    sourceTimezone: 'UTC',
  });
  const newYorkWinter = createOrganicContentRows({
    platform: 'youtube',
    accountId: 'a',
    externalContentId: 'v2',
    metricDate: '2026-01-15',
    sourceTimezone: 'America/New_York',
  });
  const newYorkSummer = createOrganicContentRows({
    platform: 'youtube',
    accountId: 'a',
    externalContentId: 'v3',
    metricDate: '2026-07-15',
    sourceTimezone: 'America/New_York',
  });

  assert.equal(utc.dailySnapshot.metric_date, Date.parse('2026-07-15T00:00:00Z'));
  assert.equal(newYorkWinter.dailySnapshot.metric_date, Date.parse('2026-01-15T05:00:00Z'));
  assert.equal(newYorkSummer.dailySnapshot.metric_date, Date.parse('2026-07-15T04:00:00Z'));
});

test('preserves null and rejects fabricated or invalid metric values', () => {
  const result = createOrganicContentRows({
    platform: 'youtube', accountId: 'a', externalContentId: 'v', metricDate: '2026-07-15',
    sourceTimezone: 'Asia/Bangkok',
  });
  assert.equal(result.content.latest_views, null);
  assert.throws(
    () => createOrganicContentRows({
      platform: 'youtube', accountId: 'a', externalContentId: 'v', metricDate: '2026-07-15',
      sourceTimezone: 'Asia/Bangkok',
      metrics: { views: -1 },
    }),
    /non-negative safe integer/,
  );
  assert.throws(
    () => createOrganicContentRows({
      platform: 'youtube', accountId: 'a', externalContentId: 'v', metricDate: '2026-07-15',
    }),
    /sourceTimezone/,
  );
});
