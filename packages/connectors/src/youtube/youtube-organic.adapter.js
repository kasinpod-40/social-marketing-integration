import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** แปลง YouTube video resource เป็น Canonical Organic source โดยคง Metric ที่ไม่มีเป็น null */
export function mapYouTubeVideoResource(video, input = {}) {
  requireObject(video, 'YouTube video resource');
  const externalContentId = requireText(video.id, 'video.id');
  const channelId = requireText(video?.snippet?.channelId, 'video.snippet.channelId');
  const expectedChannelId = optionalText(input.expectedChannelId);
  if (expectedChannelId && channelId !== expectedChannelId) {
    throw youtubeIdentityMismatchError();
  }

  return Object.freeze({
    platform: 'youtube',
    sourceChannelId: channelId,
    externalContentId,
    publishedAt: toEpochMilliseconds(video?.snippet?.publishedAt, {
      allowNull: true,
      label: 'YouTube publishedAt',
    }),
    title: optionalText(video?.snippet?.title),
    description: optionalText(video?.snippet?.description),
    videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(externalContentId)}`,
    thumbnailUrl: selectThumbnailUrl(video?.snippet?.thumbnails),
    durationSeconds: parseYouTubeDuration(video?.contentDetails?.duration),
    metrics: Object.freeze({
      views: readNullableCount(video?.statistics?.viewCount, 'YouTube viewCount'),
      likes: readNullableCount(video?.statistics?.likeCount, 'YouTube likeCount'),
      comments: readNullableCount(video?.statistics?.commentCount, 'YouTube commentCount'),
      // Data API video resource ไม่มี shares/unique viewers/watch-time semantics ที่เทียบตรงกัน
      shares: null,
      uniqueViewers: null,
      averageWatchTimeSeconds: null,
      totalWatchTimeSeconds: null,
      completionRate: null,
      trafficSources: null,
      countryRegionBreakdown: null,
    }),
  });
}

/** อ่าน uploads playlist จาก Channel resource และยืนยัน Channel ID */
export function mapYouTubeChannelResource(channel, expectedChannelId = null) {
  requireObject(channel, 'YouTube channel resource');
  const channelId = requireText(channel.id, 'channel.id');
  if (expectedChannelId && channelId !== requireText(expectedChannelId, 'expectedChannelId')) {
    throw youtubeIdentityMismatchError();
  }
  return Object.freeze({
    channelId,
    title: optionalText(channel?.snippet?.title),
    uploadsPlaylistId: requireText(
      channel?.contentDetails?.relatedPlaylists?.uploads,
      'channel.contentDetails.relatedPlaylists.uploads',
    ),
    subscriberCountHidden: channel?.statistics?.hiddenSubscriberCount === true,
    metrics: Object.freeze({
      views: readNullableCount(channel?.statistics?.viewCount, 'YouTube channel viewCount'),
      subscribers: channel?.statistics?.hiddenSubscriberCount === true
        ? null
        : readNullableCount(channel?.statistics?.subscriberCount, 'YouTube subscriberCount'),
      videos: readNullableCount(channel?.statistics?.videoCount, 'YouTube videoCount'),
    }),
  });
}

/** แปลง ISO-8601 duration ของ YouTube เป็นวินาที โดยไม่รองรับเดือน/ปีที่ความยาวไม่แน่นอน */
export function parseYouTubeDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('YouTube duration must be an ISO-8601 string');
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/u.exec(value.trim());
  if (!match) throw new TypeError(`Invalid YouTube duration: ${value}`);
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  if (!Number.isFinite(total) || total < 0) throw new RangeError('YouTube duration must be non-negative');
  return total;
}

function selectThumbnailUrl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const candidate = optionalText(value?.[key]?.url);
    if (candidate) {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('YouTube thumbnail URL must use HTTP(S)');
      return url.toString();
    }
  }
  return null;
}

function readNullableCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${fieldName} must be numeric`);
  const text = String(value).trim();
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must be a non-negative integer`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${fieldName} exceeds JavaScript safe integer range`);
  return number;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube requires ${fieldName}`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('YouTube text value must be a string');
  return value.trim() || null;
}

function youtubeIdentityMismatchError() {
  return permanentError('YouTube channel identity mismatch', {
    code: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
  });
}
