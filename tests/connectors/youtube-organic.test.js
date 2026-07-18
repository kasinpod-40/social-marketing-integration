import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapYouTubeChannelResource,
  mapYouTubeVideoResource,
  parseYouTubeDuration,
} from '../../packages/connectors/src/youtube/youtube-organic.adapter.js';
import { normalizeYouTubeVideo } from '../../packages/application/src/use-cases/normalize-youtube-video.js';

const VIDEO = Object.freeze({
  id: 'video_A',
  snippet: {
    channelId: 'channel_A',
    title: 'Organic chemistry',
    description: 'Lesson',
    publishedAt: '2026-07-14T10:00:00Z',
    thumbnails: { high: { url: 'https://img.youtube.com/video_A.jpg' } },
  },
  contentDetails: { duration: 'PT1M2.5S' },
  statistics: { viewCount: '1000', likeCount: '50', commentCount: '4' },
});

test('maps YouTube channel/video resources without inventing unsupported metrics', () => {
  const channel = mapYouTubeChannelResource({
    id: 'channel_A',
    snippet: { title: 'Channel A' },
    contentDetails: { relatedPlaylists: { uploads: 'UU_channel_A' } },
    statistics: { viewCount: '2000', subscriberCount: '100', videoCount: '5' },
  }, 'channel_A');
  const video = mapYouTubeVideoResource(VIDEO, { expectedChannelId: 'channel_A' });
  assert.equal(channel.uploadsPlaylistId, 'UU_channel_A');
  assert.equal(video.durationSeconds, 62.5);
  assert.equal(video.metrics.views, 1000);
  assert.equal(video.metrics.shares, null);
  assert.equal(parseYouTubeDuration('P1DT2H3M4S'), 93_784);
});

test('normalizes YouTube video through shared organic entity contract', () => {
  const result = normalizeYouTubeVideo({
    video: VIDEO,
    accountId: 'youtube_dev',
    channelId: 'channel_A',
    metricDate: '2026-07-15',
    dictionaryRules: [],
  });
  assert.equal(result.content.content_key, 'youtube:youtube_dev:video_A');
  assert.equal(result.dailySnapshot.views, 1000);
  assert.equal(result.dailySnapshot.shares, null);
  assert.equal(result.sourceChannelId, 'channel_A');
});

test('rejects video resources from a different channel before destination planning', () => {
  assert.throws(
    () => mapYouTubeVideoResource(VIDEO, { expectedChannelId: 'channel_B' }),
    (error) => (
      error?.code === 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH'
      && error.retryable === false
      && /channel identity mismatch/u.test(error.message)
    ),
  );
});
