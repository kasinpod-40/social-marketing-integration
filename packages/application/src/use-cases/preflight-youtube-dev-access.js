import { mapYouTubeChannelResource } from '../../../connectors/src/youtube/youtube-organic.adapter.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** ตรวจ Public API, OAuth ownership, uploads playlist และ Analytics sample ก่อน Apply/Live write */
export async function preflightYouTubeDevAccess(input = {}) {
  const channelId = requireText(input.channelId, 'channelId');
  const publicClient = requireClient(input.publicClient, 'publicClient');
  const ownerClient = input.ownerClient ?? null;
  const analyticsEnabled = input.analyticsEnabled === true;
  const sampleLimit = positiveInteger(input.sampleLimit ?? 3, 'sampleLimit');

  const channelResource = await publicClient.getChannel({ channelId });
  const channel = mapYouTubeChannelResource(channelResource, channelId);
  const videoIds = await publicClient.listUploadVideoIds({
    uploadsPlaylistId: channel.uploadsPlaylistId,
    maxItems: sampleLimit,
  });
  const videos = videoIds.length > 0 ? await publicClient.listVideos({ videoIds }) : [];
  const mismatchedVideos = videos
    .filter((video) => video?.snippet?.channelId !== channelId)
    .map((video) => video?.id ?? null);
  if (mismatchedVideos.length > 0) {
    throw permanentError('YouTube sample videos do not belong to the allowed channel', {
      code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
      details: { channelId, mismatchedVideos },
    });
  }

  let owner = null;
  let analytics = null;
  if (analyticsEnabled) {
    if (!ownerClient) {
      throw permanentError('YouTube Analytics preflight requires OAuth owner credentials', {
        code: 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED',
      });
    }
    const ownerResource = await ownerClient.getChannel({ mine: true });
    owner = mapYouTubeChannelResource(ownerResource, channelId);
    if (input.analyticsStartDate && input.analyticsEndDate) {
      const response = await ownerClient.queryAnalytics({
        channelId,
        startDate: input.analyticsStartDate,
        endDate: input.analyticsEndDate,
        dimensions: 'day,video',
        metrics: 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
        filters: videoIds.length > 0 ? `video==${videoIds.join(',')}` : undefined,
        sort: 'day,video',
        maxResults: 10,
        startIndex: 1,
      });
      analytics = Object.freeze({
        columnHeaders: Array.isArray(response?.columnHeaders)
          ? response.columnHeaders.map((header) => header?.name ?? null)
          : [],
        rowsReturned: Array.isArray(response?.rows) ? response.rows.length : 0,
      });
    }
  }

  return Object.freeze({
    ok: true,
    channel: Object.freeze({
      channelId: channel.channelId,
      title: channel.title,
      uploadsPlaylistIdPresent: Boolean(channel.uploadsPlaylistId),
      subscriberCountHidden: channel.subscriberCountHidden,
    }),
    publicData: Object.freeze({
      sampleVideoIds: Object.freeze([...videoIds]),
      sampleVideosReturned: videos.length,
    }),
    ownerAnalytics: Object.freeze({
      enabled: analyticsEnabled,
      ownershipVerified: owner?.channelId === channelId,
      sample: analytics,
    }),
  });
}

function requireClient(value, fieldName) {
  for (const method of ['getChannel', 'listUploadVideoIds', 'listVideos']) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube preflight requires ${fieldName}.${method}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube preflight requires ${fieldName}`);
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}
