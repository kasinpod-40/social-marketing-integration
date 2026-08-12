import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapMissingYouTubeVideoRawRow,
  mapYouTubeAnalyticsResponse,
  mapYouTubeChannelRawRow,
  mapYouTubeVideoRawRow,
  validateYouTubeAnalyticsRowsScope,
} from '../../packages/connectors/src/youtube/youtube-raw.adapter.js';

const CHANNEL = {
  id: 'channel_A',
  snippet: { title: 'Channel A' },
  contentDetails: { relatedPlaylists: { uploads: 'UU_A' } },
  statistics: { viewCount: '100', hiddenSubscriberCount: true, videoCount: '2' },
};
const VIDEO = {
  id: 'video_A', etag: 'etag-A',
  snippet: { channelId: 'channel_A', title: 'Video A', publishedAt: '2026-07-14T00:00:00Z' },
  contentDetails: { duration: 'PT1M' },
  statistics: { viewCount: '10', likeCount: '2', commentCount: '1' },
  status: { privacyStatus: 'public' },
};

test('maps YouTube Channel and Video RAW rows with hidden subscriber and availability semantics', () => {
  const channel = mapYouTubeChannelRawRow(CHANNEL, { expectedChannelId: 'channel_A', fetchedAt: 1000 });
  const video = mapYouTubeVideoRawRow(VIDEO, { expectedChannelId: 'channel_A', fetchedAt: 1000 });
  assert.equal(channel.raw_channel_key, 'youtube:channel_A');
  assert.equal(channel.subscriber_count, null);
  assert.equal(channel.subscriber_count_hidden, true);
  assert.equal(video.raw_video_key, 'youtube:channel_A:video_A');
  assert.equal(video.source_availability_status, 'available');
  assert.equal(video.missing_since, null);
});

test('maps missing video as a partial reconciliation patch without zero metrics', () => {
  const row = mapMissingYouTubeVideoRawRow({ channelId: 'channel_A', videoId: 'gone', fetchedAt: 2000 });
  assert.deepEqual(row, {
    raw_video_key: 'youtube:channel_A:gone',
    channel_id: 'channel_A',
    video_id: 'gone',
    last_seen_at: 2000,
    source_availability_status: 'missing',
    missing_since: 2000,
    fetched_at: 2000,
    source_payload_json: JSON.stringify({
      reconciliation_status: 'missing',
      observed_in_uploads_playlist: false,
    }),
  });
  assert.equal(Object.hasOwn(row, 'view_count'), false);
});

test('validates Analytics headers and preserves Pacific source day as text', () => {
  const rows = mapYouTubeAnalyticsResponse({
    columnHeaders: [
      'day', 'video', 'views', 'likes', 'comments', 'shares',
      'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
    ].map((name) => ({ name })),
    rows: [['2026-07-14', 'video_A', 10, 2, 1, 1, 5.5, 30, 50]],
  }, { channelId: 'channel_A', fetchedAt: 3000 });
  assert.equal(rows[0].raw_analytics_daily_key, 'youtube:channel_A:video_A:2026-07-14');
  assert.equal(rows[0].source_metric_date, '2026-07-14');
  assert.equal(rows[0].average_view_percentage, 50);
  assert.throws(() => mapYouTubeAnalyticsResponse({ columnHeaders: [{ name: 'day' }], rows: [] }, {
    channelId: 'channel_A', fetchedAt: 3000,
  }), (error) => error?.code === 'YOUTUBE_ANALYTICS_GRAIN_MISMATCH');
});

test('preserves average view percentage above 100 when viewers rewatch video portions', () => {
  const headers = [
    'day', 'video', 'views', 'likes', 'comments', 'shares',
    'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  ].map((name) => ({ name }));
  const rows = mapYouTubeAnalyticsResponse({
    columnHeaders: headers,
    rows: [['2026-08-10', 'video_A', 10, 2, 1, 1, 5.5, 30, 125.5]],
  }, { channelId: 'channel_A', fetchedAt: 3000 });
  assert.equal(rows[0].average_view_percentage, 125.5);
  assert.throws(() => mapYouTubeAnalyticsResponse({
    columnHeaders: headers,
    rows: [['2026-08-10', 'video_A', 10, 2, 1, 1, 5.5, 30, -0.1]],
  }, { channelId: 'channel_A', fetchedAt: 3000 }), /averageViewPercentage must be non-negative/u);
});

test('preserves signed integer adjustments from daily Analytics without weakening cumulative counts', () => {
  const headers = [
    'day', 'video', 'views', 'likes', 'comments', 'shares',
    'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  ].map((name) => ({ name }));
  const rows = mapYouTubeAnalyticsResponse({
    columnHeaders: headers,
    rows: [['2026-08-10', 'video_A', 10, -1, 0, 1, 5.5, 30, 50]],
  }, { channelId: 'channel_A', fetchedAt: 3000 });
  assert.equal(rows[0].likes, -1);
  assert.throws(() => mapYouTubeAnalyticsResponse({
    columnHeaders: headers,
    rows: [['2026-08-10', 'video_A', 10, 0.5, 0, 1, 5.5, 30, 50]],
  }, { channelId: 'channel_A', fetchedAt: 3000 }), /likes must be a signed safe integer/u);
  assert.throws(() => mapYouTubeVideoRawRow({
    ...VIDEO,
    statistics: { ...VIDEO.statistics, likeCount: '-1' },
  }, { expectedChannelId: 'channel_A', fetchedAt: 3000 }), /likeCount must be a non-negative integer/u);
});

test('validates every mapped Analytics row against video, channel, and date scope', () => {
  const base = {
    raw_analytics_daily_key: 'youtube:channel_A:video_A:2026-07-14',
    source_metric_date: '2026-07-14',
    channel_id: 'channel_A',
    video_id: 'video_A',
  };
  assert.deepEqual(validateYouTubeAnalyticsRowsScope([base], {
    channelId: 'channel_A',
    videoIds: ['video_A'],
    startDate: '2026-07-14',
    endDate: '2026-07-14',
  }), [base]);
  for (const [reason, row] of [
    ['video', { ...base, video_id: 'video_OUTSIDE' }],
    ['channel', { ...base, channel_id: 'channel_OUTSIDE' }],
    ['date', { ...base, source_metric_date: '2026-07-13' }],
  ]) {
    assert.throws(
      () => validateYouTubeAnalyticsRowsScope([row], {
        channelId: 'channel_A',
        videoIds: ['video_A'],
        startDate: '2026-07-14',
        endDate: '2026-07-14',
      }),
      (error) => error?.code === 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH'
        && error.retryable === false
        && error.details?.reason === reason,
    );
  }
});
