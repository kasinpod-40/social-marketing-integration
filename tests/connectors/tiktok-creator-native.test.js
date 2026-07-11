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



test('requires a TikTok video ID before normalization', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({ description: 'missing identity' }),
    /TikTok video ID is required/,
  );
});

test('rejects invalid numeric TikTok metrics instead of silently converting to zero', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Total video views': 'not-a-number' }),
    /TikTok views must be/,
  );
});


test('extracts URL links from real Lark Bitable URL field objects', () => {
  const mapped = mapTikTokCreatorVideoRow({
    video_id: '7599997064940064021',
    'Shareable URL': [{
      link: 'https://www.tiktok.com/@chemistry_k/video/7599997064940064021',
      text: 'เปิดวิดีโอ',
      type: 'url',
    }],
    'Temporary Thumbnail URL': [{
      link: 'https://example.com/thumb.jpg',
      text: 'thumbnail',
      type: 'url',
    }],
  });

  assert.equal(mapped.shareableUrl, 'https://www.tiktok.com/@chemistry_k/video/7599997064940064021');
  assert.equal(mapped.thumbnailUrl, 'https://example.com/thumb.jpg');
});

test('rejects malformed structured URL fields instead of coercing objects to text', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Shareable URL': [{ type: 'url', text: 'not-a-url' }] }),
    /TikTok shareable URL must be an absolute http\/https URL/,
  );
});


test('decodes real Lark rich-text arrays for text and JSON fields', () => {
  const mapped = mapTikTokCreatorVideoRow({
    'Unique identifier of the video': [{ type: 'text', text: '7599997064940064021' }],
    'Video description': [{ type: 'text', text: 'สรุปเคมี A-Level' }],
    'Different sources of video exposure, arranged by exposure percentage from high to low': [
      { type: 'text', text: '[{"impression_source":"For You","percentage":0.9}]' },
    ],
  });
  assert.equal(mapped.externalContentId, '7599997064940064021');
  assert.equal(mapped.description, 'สรุปเคมี A-Level');
  assert.equal(mapped.metrics.trafficSources, '[{"impression_source":"For You","percentage":0.9}]');
});


test('rejects negative, fractional count, invalid clock duration, and out-of-range completion metrics', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Total video views': -1 }),
    /TikTok views must be a non-negative safe integer/,
  );
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Total video views': 1.5 }),
    /TikTok views must be a non-negative safe integer/,
  );
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Video Duration': '00:99:10' }),
    /Invalid TikTok clock duration value/,
  );
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 'v1', 'Percentage of video watched completely': '101%' }),
    /TikTok completion rate must be between 0 and 1/,
  );
});

test('supports fractional seconds in valid TikTok clock durations', () => {
  const mapped = mapTikTokCreatorVideoRow({ video_id: 'v1', 'Video Duration': '01:02.500' });
  assert.equal(mapped.durationSeconds, 62.5);
});

test('extracts source handle only from a real TikTok domain', async () => {
  const { extractTikTokHandle } = await import('../../packages/connectors/src/tiktok/creator-native.adapter.js');
  assert.equal(
    extractTikTokHandle('https://www.tiktok.com/@ft.pumkin/video/123'),
    'ft.pumkin',
  );
  assert.equal(
    extractTikTokHandle('https://attacker.example/@ft.pumkin/video/123'),
    null,
  );
  assert.equal(
    extractTikTokHandle('https://not-tiktok.com/@ft.pumkin/video/123'),
    null,
  );
});


test('uses a valid embed URL for source identity when shareable URL is absent', () => {
  const mapped = mapTikTokCreatorVideoRow({
    video_id: 'video_embed_only',
    embed_url: 'https://www.tiktok.com/@embed.brand/video/video_embed_only',
  });

  assert.equal(mapped.sourceHandle, 'embed.brand');
  assert.equal(mapped.shareableUrl, null);
  assert.equal(mapped.embedUrl, 'https://www.tiktok.com/@embed.brand/video/video_embed_only');
});

test('skips blank or metadata-only early aliases and reads the next valid TikTok field alias', () => {
  const mapped = mapTikTokCreatorVideoRow({
    video_id: [],
    'Unique identifier of the video': [{ type: 'text', text: 'video-from-fallback-alias' }],
    shareable_url: [{ type: 'url', link: '', text: '' }],
    'Shareable URL': [{
      type: 'url',
      link: 'https://www.tiktok.com/@fallback.brand/video/video-from-fallback-alias',
      text: 'เปิดวิดีโอ',
    }],
    views: [{ type: 'number', value: '' }],
    'Total video views': '2,500',
  });

  assert.equal(mapped.externalContentId, 'video-from-fallback-alias');
  assert.equal(mapped.shareableUrl, 'https://www.tiktok.com/@fallback.brand/video/video-from-fallback-alias');
  assert.equal(mapped.sourceHandle, 'fallback.brand');
  assert.equal(mapped.metrics.views, 2500);
});

test('prefers a verified TikTok embed URL when the shareable URL points outside TikTok', () => {
  const mapped = mapTikTokCreatorVideoRow({
    video_id: 'video_verified_fallback',
    shareable_url: 'https://example.com/@wrong/video/video_verified_fallback',
    embed_url: 'https://www.tiktok.com/@verified.brand/video/video_verified_fallback',
  });

  assert.equal(mapped.videoUrl, 'https://www.tiktok.com/@verified.brand/video/video_verified_fallback');
  assert.equal(mapped.sourceHandle, 'verified.brand');
});

test('rejects shareable and embed TikTok URLs that identify different accounts', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({
      video_id: 'video_conflict',
      shareable_url: 'https://www.tiktok.com/@account.one/video/video_conflict',
      embed_url: 'https://www.tiktok.com/@account.two/video/video_conflict',
    }),
    /conflicting source handles/,
  );
});


test('rejects unsafe numeric TikTok video IDs before precision is silently lost', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: 7599997064940064021 }),
    /exceeds JavaScript safe integer range/,
  );
  assert.throws(
    () => mapTikTokCreatorVideoRow({ video_id: { value: 7599997064940064021 } }),
    /exceeds JavaScript safe integer range/,
  );
});

test('rejects TikTok URLs whose video ID differs from the raw record ID', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({
      video_id: '7599997064940064021',
      shareable_url: 'https://www.tiktok.com/@ft.pumkin/video/7592461058158185735',
    }),
    /TikTok video ID mismatch/,
  );
});

test('rejects unsafe count metrics that cannot be represented exactly', () => {
  assert.throws(
    () => mapTikTokCreatorVideoRow({
      video_id: 'v1',
      views: Number.MAX_SAFE_INTEGER + 1,
    }),
    /TikTok views must be a non-negative safe integer/,
  );
});
