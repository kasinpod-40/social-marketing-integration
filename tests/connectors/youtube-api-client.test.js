import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeApiClient } from '../../packages/connectors/src/youtube/youtube-api.client.js';

test('YouTube client loads channel identity and keeps credential out of error details', async () => {
  let requestUrl;
  const client = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return Response.json({ items: [{ id: 'channel_A' }] });
    },
  });
  const channel = await client.getChannel({ channelId: 'channel_A' });
  assert.equal(channel.id, 'channel_A');
  assert.equal(requestUrl.pathname, '/youtube/v3/channels');
  assert.equal(requestUrl.searchParams.get('key'), 'test-key');
});

test('YouTube client follows bounded pageToken and chunks videos at 50 IDs', async () => {
  const calls = [];
  const client = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      calls.push(parsed);
      if (parsed.pathname.endsWith('/playlistItems')) {
        return Response.json(parsed.searchParams.get('pageToken')
          ? { items: [{ contentDetails: { videoId: 'v2' } }] }
          : { items: [{ contentDetails: { videoId: 'v1' } }], nextPageToken: 'next' });
      }
      return Response.json({ items: parsed.searchParams.get('id').split(',').map((id) => ({ id })) });
    },
  });
  assert.deepEqual(await client.listUploadVideoIds({ uploadsPlaylistId: 'UU1' }), ['v1', 'v2']);
  const videos = await client.listVideos({ videoIds: Array.from({ length: 51 }, (_, index) => `v${index}`) });
  assert.equal(videos.length, 51);
  const videoCalls = calls.filter((url) => url.pathname.endsWith('/videos'));
  assert.equal(videoCalls.length, 2);
  assert.equal(videoCalls.every((url) => !url.searchParams.has('maxResults')), true);
});

test('YouTube client exposes one uploads page for durable application-level resume', async () => {
  const client = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('pageToken'), 'resume-token');
      return Response.json({
        items: [
          { contentDetails: { videoId: 'v1' } },
          { contentDetails: { videoId: 'v1' } },
          { contentDetails: { videoId: 'v2' } },
        ],
        nextPageToken: 'next-token',
      });
    },
  });

  const page = await client.listUploadVideoIdsPage({
    uploadsPlaylistId: 'UU1',
    pageToken: 'resume-token',
  });

  assert.deepEqual(page, {
    videoIds: ['v1', 'v2'],
    nextPageToken: 'next-token',
  });
});

test('YouTube Analytics requires OAuth and classifies server failures as retryable', async () => {
  const apiKeyClient = new YouTubeApiClient({ apiKey: 'test-key', fetchImpl: async () => Response.json({}) });
  await assert.rejects(
    apiKeyClient.queryAnalytics({ channelId: 'c', startDate: '2026-07-14', endDate: '2026-07-14', metrics: 'views' }),
    (error) => error?.code === 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED',
  );

  const failing = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({ error: { code: 503 } }, { status: 503 }),
  });
  await assert.rejects(
    failing.getChannel({ channelId: 'c' }),
    (error) => error?.code === 'YOUTUBE_TRANSIENT_API_ERROR' && error.retryable === true,
  );
});

test('YouTube quota exhaustion is terminal while short rate limits remain retryable', async () => {
  const quotaExceeded = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({
      error: { code: 403, errors: [{ reason: 'quotaExceeded' }] },
    }, { status: 403 }),
  });
  await assert.rejects(
    quotaExceeded.getChannel({ channelId: 'c' }),
    (error) => error?.code === 'YOUTUBE_QUOTA_EXHAUSTED'
      && error.retryable === false
      && error.details?.recovery === 'wait_for_quota_reset_or_request_additional_quota',
  );

  const rateLimited = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => Response.json({
      error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] },
    }, { status: 403 }),
  });
  await assert.rejects(
    rateLimited.getChannel({ channelId: 'c' }),
    (error) => error?.code === 'YOUTUBE_TRANSIENT_API_ERROR' && error.retryable === true,
  );
});
