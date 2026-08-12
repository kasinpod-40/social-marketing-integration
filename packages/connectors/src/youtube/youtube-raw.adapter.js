import { mapYouTubeChannelResource, mapYouTubeVideoResource } from './youtube-organic.adapter.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const ANALYTICS_COLUMNS = Object.freeze([
  'day', 'video', 'views', 'likes', 'comments', 'shares',
  'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
]);

/** แปลง Channel resource เป็น RAW latest-state row */
export function mapYouTubeChannelRawRow(channelResource, input = {}) {
  const channel = mapYouTubeChannelResource(channelResource, input.expectedChannelId);
  const fetchedAt = safeTimestamp(input.fetchedAt);
  return Object.freeze({
    raw_channel_key: `youtube:${channel.channelId}`,
    channel_id: channel.channelId,
    title: channel.title,
    uploads_playlist_id: channel.uploadsPlaylistId,
    view_count: channel.metrics.views,
    subscriber_count: channel.metrics.subscribers,
    subscriber_count_hidden: channel.subscriberCountHidden,
    video_count: channel.metrics.videos,
    fetched_at: fetchedAt,
    source_payload_json: safeJson(channelResource),
  });
}

/** แปลง Video resource เป็น RAW current-state/reconciliation row */
export function mapYouTubeVideoRawRow(videoResource, input = {}) {
  const mapped = mapYouTubeVideoResource(videoResource, { expectedChannelId: input.expectedChannelId });
  const fetchedAt = safeTimestamp(input.fetchedAt);
  return Object.freeze({
    raw_video_key: `youtube:${mapped.sourceChannelId}:${mapped.externalContentId}`,
    channel_id: mapped.sourceChannelId,
    video_id: mapped.externalContentId,
    published_at: mapped.publishedAt,
    title: mapped.title,
    description: mapped.description,
    video_url: mapped.videoUrl,
    thumbnail_url: mapped.thumbnailUrl,
    duration_seconds: mapped.durationSeconds,
    view_count: mapped.metrics.views,
    like_count: mapped.metrics.likes,
    comment_count: mapped.metrics.comments,
    privacy_status: normalizePrivacyStatus(videoResource?.status?.privacyStatus),
    etag: optionalText(videoResource?.etag),
    last_seen_at: fetchedAt,
    source_availability_status: normalizeAvailability(videoResource?.status?.privacyStatus),
    missing_since: null,
    fetched_at: fetchedAt,
    source_payload_json: safeJson(videoResource),
  });
}

/** สร้าง RAW reconciliation row โดยคง Required identity fields และไม่เขียนทับ Metrics เดิม */
export function mapMissingYouTubeVideoRawRow(input = {}) {
  const channelId = requireText(input.channelId, 'channelId');
  const videoId = requireText(input.videoId, 'videoId');
  const fetchedAt = safeTimestamp(input.fetchedAt);
  const lastSeenAt = safeTimestamp(input.lastSeenAt ?? fetchedAt);
  const missingSince = safeTimestamp(input.missingSince ?? fetchedAt);
  const availabilityStatus = normalizeMissingAvailability(input.availabilityStatus);
  return Object.freeze({
    raw_video_key: `youtube:${channelId}:${videoId}`,
    channel_id: channelId,
    video_id: videoId,
    last_seen_at: lastSeenAt,
    source_availability_status: availabilityStatus,
    missing_since: missingSince,
    fetched_at: fetchedAt,
    source_payload_json: safeJson({
      reconciliation_status: availabilityStatus,
      observed_in_uploads_playlist: input.observedInUploadsPlaylist === true,
    }),
  });
}

/** แปลง Analytics response rows หลังตรวจ Header/Grain ตรง Contract */
export function mapYouTubeAnalyticsResponse(response, input = {}) {
  const channelId = requireText(input.channelId, 'channelId');
  const fetchedAt = safeTimestamp(input.fetchedAt);
  const headers = Array.isArray(response?.columnHeaders)
    ? response.columnHeaders.map((header) => header?.name)
    : [];
  if (headers.length !== ANALYTICS_COLUMNS.length
    || headers.some((name, index) => name !== ANALYTICS_COLUMNS[index])) {
    throw permanentError('YouTube Analytics response columns do not match the approved contract', {
      code: 'YOUTUBE_ANALYTICS_GRAIN_MISMATCH',
      details: { expected: ANALYTICS_COLUMNS, actual: headers },
    });
  }

  const rows = Array.isArray(response?.rows) ? response.rows : [];
  return Object.freeze(rows.map((values, index) => {
    if (!Array.isArray(values) || values.length !== ANALYTICS_COLUMNS.length) {
      throw permanentError('YouTube Analytics row width does not match headers', {
        code: 'YOUTUBE_ANALYTICS_GRAIN_MISMATCH',
        details: { rowIndex: index, expectedColumns: ANALYTICS_COLUMNS.length },
      });
    }
    const sourceMetricDate = requireDateOnlyText(values[0], `rows[${index}].day`);
    const videoId = requireText(values[1], `rows[${index}].video`);
    return Object.freeze({
      raw_analytics_daily_key: `youtube:${channelId}:${videoId}:${sourceMetricDate}`,
      source_metric_date: sourceMetricDate,
      channel_id: channelId,
      video_id: videoId,
      views: nullableSignedCount(values[2], 'views'),
      likes: nullableSignedCount(values[3], 'likes'),
      comments: nullableSignedCount(values[4], 'comments'),
      shares: nullableSignedCount(values[5], 'shares'),
      estimated_minutes_watched: nullableNonNegative(values[6], 'estimatedMinutesWatched'),
      average_view_duration_seconds: nullableNonNegative(values[7], 'averageViewDuration'),
      average_view_percentage: nullableNonNegative(values[8], 'averageViewPercentage'),
      fetched_at: fetchedAt,
      source_payload_json: safeJson({ headers: ANALYTICS_COLUMNS, values }),
    });
  }));
}

/** Fail-closed ก่อน Staging: Google response ทุก row ต้องอยู่ใน requested owner scope เท่านั้น */
export function validateYouTubeAnalyticsRowsScope(rows, input = {}) {
  if (!Array.isArray(rows)) throw new TypeError('YouTube Analytics rows must be an array');
  const channelId = requireText(input.channelId, 'channelId');
  const requestedVideoIds = new Set(
    (Array.isArray(input.videoIds) ? input.videoIds : [])
      .map((videoId) => requireText(videoId, 'videoId')),
  );
  const startDate = requireDateOnlyText(input.startDate, 'startDate');
  const endDate = requireDateOnlyText(input.endDate, 'endDate');
  if (endDate < startDate) throw new RangeError('endDate must not be before startDate');

  for (const [rowIndex, row] of rows.entries()) {
    let reason = null;
    if (row?.channel_id !== channelId) reason = 'channel';
    else if (!requestedVideoIds.has(row?.video_id)) reason = 'video';
    else if (row?.source_metric_date < startDate || row?.source_metric_date > endDate) reason = 'date';
    if (reason) {
      throw permanentError('YouTube Analytics returned a row outside the requested scope', {
        code: 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH',
        details: {
          reason,
          rowIndex,
          requestedVideoCount: requestedVideoIds.size,
        },
      });
    }
  }
  return Object.freeze([...rows]);
}

export const YOUTUBE_ANALYTICS_COLUMNS = ANALYTICS_COLUMNS;

function normalizePrivacyStatus(value) {
  const status = optionalText(value);
  return ['public', 'unlisted', 'private'].includes(status) ? status : null;
}
function normalizeAvailability(value) {
  return value === 'private' ? 'private' : 'available';
}
function normalizeMissingAvailability(value) {
  const status = value ?? 'missing';
  if (!['missing', 'private', 'deleted'].includes(status)) {
    throw new TypeError('YouTube missing availability must be missing, private or deleted');
  }
  return status;
}
function safeJson(value) {
  return JSON.stringify(value ?? null);
}
function safeTimestamp(value) {
  const number = Number(value ?? Date.now());
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('YouTube fetchedAt must be epoch milliseconds');
  return number;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube RAW requires ${fieldName}`);
  return value.trim();
}
function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('YouTube RAW text must be a string');
  return value.trim() || null;
}
function requireDateOnlyText(value, fieldName) {
  const text = requireText(String(value), fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  return text;
}
function nullableCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  return number;
}
function nullableSignedCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError(`${fieldName} must be a signed safe integer`);
  return number;
}
function nullableNonNegative(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}
