import { toEpochMilliseconds } from '../shared/date-time.js';
import { readLarkNumber, readLarkText, readLarkUrl } from '../shared/lark-cell-value.js';

const FIELD_ALIASES = Object.freeze({
  videoId: [
    'video_id',
    'Video ID',
    'Unique identifier of the video',
    'ID',
  ],
  publishedAt: [
    'published_at',
    'Published At',
    'Date and time the video was published',
    'Publish Time',
  ],
  description: [
    'description',
    'caption',
    'Video Description',
    'Video description',
    'Description',
  ],
  shareableUrl: [
    'shareable_url',
    'share_url',
    'Shareable URL',
    'Shareable URL for this TikTok video',
  ],
  embedUrl: [
    'embed_url',
    'Embed Link',
    'Embeddable link',
    'Embeddable link for this TikTok video',
    'Embed URL',
  ],
  thumbnailUrl: [
    'thumbnail_url',
    'temporary_thumbnail_url',
    'Temporary Thumbnail URL',
    'Temporary video thumbnail URL',
    'Temporary URL for video content thumbnail',
  ],
  durationSeconds: [
    'duration_seconds',
    'duration',
    'Video Duration',
    'Video duration',
    'Video duration in seconds, rounded to three decimal places',
  ],
  views: [
    'views',
    'Total Video Views',
    'Total video views',
  ],
  likes: [
    'likes',
    'Total Likes',
    'Total number of likes the video received',
  ],
  comments: [
    'comments',
    'Comment Count',
    'Total number of comments the video received',
  ],
  shares: [
    'shares',
    'Share Count',
    'Total number of times the video was shared',
  ],
  averagePlayDuration: [
    'average_play_duration',
    'average_video_play_duration',
    'Average Video Play Duration',
    'Average video play duration based on all views',
  ],
  totalPlayDuration: [
    'total_play_duration',
    'total_video_play_duration',
    'Total Video Play Duration',
    'Total video play duration based on all views',
  ],
  completionRate: [
    'completion_rate',
    'Percentage of Video Watched Completely',
    'Percentage of video watched completely',
    'Percentage of video watched completely based on all views',
  ],
  uniqueViewers: [
    'unique_viewers',
    'Total Number of Viewers',
    'Total number of viewers who watched the video (deduplicated)',
  ],
  trafficSources: [
    'traffic_sources',
    'Traffic Sources',
    'Different Sources of Video Exposure',
    'Different sources of video exposure',
    'Different sources of video exposure, arranged by exposure percentage',
    'Different sources of video exposure, arranged by exposure percentage from high to low',
  ],
  countryRegionBreakdown: [
    'country_region_breakdown',
    'Audience Country/Region Breakdown',
    'Audience country/region breakdown',
    'Breakdown percentage data of audience country/region',
  ],
});

/**
 * Maps one Lark TikTok For Creator native row into a stable canonical object.
 * This adapter intentionally preserves unsupported/missing metrics as null.
 *
 * @param {Record<string, unknown>} row
 * @returns {Object}
 */
export function mapTikTokCreatorVideoRow(row) {
  assertObject(row, 'TikTok creator row');
  const shareableUrl = readLarkUrl(firstPresent(row, FIELD_ALIASES.shareableUrl), { label: 'TikTok shareable URL' });

  return Object.freeze({
    platform: 'tiktok',
    externalContentId: readLarkText(firstPresent(row, FIELD_ALIASES.videoId), { label: 'TikTok video ID' }),
    publishedAt: toEpochMilliseconds(firstPresent(row, FIELD_ALIASES.publishedAt), { allowNull: true, label: 'TikTok published_at' }),
    description: readLarkText(firstPresent(row, FIELD_ALIASES.description), { label: 'TikTok description' }),
    shareableUrl,
    embedUrl: readLarkUrl(firstPresent(row, FIELD_ALIASES.embedUrl), { label: 'TikTok embed URL' }),
    thumbnailUrl: readLarkUrl(firstPresent(row, FIELD_ALIASES.thumbnailUrl), { label: 'TikTok thumbnail URL' }),
    sourceHandle: extractTikTokHandle(shareableUrl),
    durationSeconds: toNullableSeconds(firstPresent(row, FIELD_ALIASES.durationSeconds)),
    metrics: Object.freeze({
      views: toNullableNumber(firstPresent(row, FIELD_ALIASES.views)),
      likes: toNullableNumber(firstPresent(row, FIELD_ALIASES.likes)),
      comments: toNullableNumber(firstPresent(row, FIELD_ALIASES.comments)),
      shares: toNullableNumber(firstPresent(row, FIELD_ALIASES.shares)),
      averagePlayDurationSeconds: toNullableSeconds(firstPresent(row, FIELD_ALIASES.averagePlayDuration)),
      totalPlayDurationSeconds: toNullableSeconds(firstPresent(row, FIELD_ALIASES.totalPlayDuration)),
      completionRate: toNullableRatio(firstPresent(row, FIELD_ALIASES.completionRate)),
      uniqueViewers: toNullableNumber(firstPresent(row, FIELD_ALIASES.uniqueViewers)),
      trafficSources: readLarkText(firstPresent(row, FIELD_ALIASES.trafficSources), { label: 'TikTok traffic sources' }),
      countryRegionBreakdown: readLarkText(firstPresent(row, FIELD_ALIASES.countryRegionBreakdown), { label: 'TikTok country/region breakdown' }),
    }),
  });
}


export function extractTikTokHandle(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/@([^/]+)\/video\//u);
    return match?.[1]?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function firstPresent(row, aliases) {
  for (const alias of aliases) {
    const value = row?.[alias];
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }

  return null;
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return readLarkNumber(value, { label: 'TikTok numeric metric' });
}

function toNullableRatio(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string' && value.trim().endsWith('%')) {
    return toNullableNumber(value.trim().slice(0, -1)) / 100;
  }

  const numericValue = toNullableNumber(value);
  if (numericValue === null) {
    return null;
  }

  if (numericValue > 1 && numericValue <= 100) {
    return numericValue / 100;
  }

  return numericValue;
}

function toNullableSeconds(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string' && value.includes(':')) {
    return parseClockDuration(value);
  }

  return toNullableNumber(value);
}

function parseClockDuration(value) {
  const parts = value.split(':').map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new TypeError(`Invalid TikTok duration value: ${value}`);
  }

  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
}
