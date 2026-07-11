import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTikTokCreatorVideoRow } from '../../packages/connectors/src/tiktok/creator-native.adapter.js';

test('maps TikTok Creator native fields to canonical video metrics', () => {
  const mapped = mapTikTokCreatorVideoRow({
    'Unique identifier of the video': '735000001',
    'Date and time the video was published': 1783328400000,
    'Video description': 'New product video',
    'Shareable URL for this TikTok video': 'https://www.tiktok.com/@brand/video/735000001',
    'Video Duration': '00:00:15',
    'Total video views': '1,200',
    'Total number of likes the video received': 100,
    'Total number of comments the video received': 12,
    'Total number of times the video was shared': 7,
    'Average video play duration based on all views': '6.5',
    'Total video play duration based on all views': '7800',
    'Percentage of video watched completely': '45%',
    'Total number of viewers who watched the video (deduplicated)': 900,
    'Different sources of video exposure': 'For You 70%, Search 20%, Profile 10%',
    'Audience country/region breakdown': 'TH 95%, US 5%',
  });

  assert.equal(mapped.externalContentId, '735000001');
  assert.equal(mapped.publishedAt, 1783328400000);
  assert.equal(mapped.durationSeconds, 15);
  assert.equal(mapped.metrics.views, 1200);
  assert.equal(mapped.metrics.completionRate, 0.45);
  assert.equal(mapped.metrics.uniqueViewers, 900);
  assert.equal(mapped.metrics.trafficSources, 'For You 70%, Search 20%, Profile 10%');
});

test('keeps unsupported or missing TikTok metrics as null', () => {
  const mapped = mapTikTokCreatorVideoRow({ video_id: 'v1' });

  assert.equal(mapped.externalContentId, 'v1');
  assert.equal(mapped.metrics.views, null);
  assert.equal(mapped.metrics.averagePlayDurationSeconds, null);
});

test('rejects invalid numeric TikTok metrics instead of silently converting to zero', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Total video views': 'not-a-number' }),
    /Invalid TikTok numeric metric value/,
  );
});
