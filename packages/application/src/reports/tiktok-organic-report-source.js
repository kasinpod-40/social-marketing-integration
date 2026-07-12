import {
  readLarkNumber,
  readLarkText,
  readLarkUrl,
} from '../../../connectors/src/shared/lark-cell-value.js';
import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';

/** Normalize MKT_Content records สำหรับ Report Engine */
export function normalizeTikTokContentRecords(records, input = {}) {
  const accountId = requireText(input.accountId, 'accountId');
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');

  return Object.freeze(requireRecords(records).map((record, index) => {
    const fields = requireFields(record, index);
    const platform = normalizeLower(readLarkText(fields.platform, { label: 'platform' }));
    const rowAccountId = readLarkText(fields.account_id, { label: 'account_id' });
    if (platform !== 'tiktok' || rowAccountId !== accountId) return null;

    const externalContentId = readLarkText(fields.external_content_id, {
      label: 'external_content_id',
      allowNull: false,
    });
    const publishedAt = optionalEpoch(fields.published_at, 'published_at');

    return Object.freeze({
      recordId: optionalText(record?.recordId ?? record?.record_id),
      contentKey: readLarkText(fields.content_key, { label: 'content_key', allowNull: false }),
      externalContentId,
      accountId: rowAccountId,
      platform,
      caption: readLarkText(fields.caption, { label: 'caption' }),
      contentUrl: readLarkUrl(fields.content_url, { label: 'content_url' }),
      thumbnailUrl: readLarkUrl(fields.thumbnail_url, { label: 'thumbnail_url' }),
      publishedAt,
      publishedDate: publishedAt === null ? null : dateInTimeZone(publishedAt, timeZone),
    });
  }).filter(Boolean));
}

/** Normalize MKT_Content_Daily cumulative snapshots สำหรับ Report Engine */
export function normalizeTikTokDailySnapshotRecords(records, input = {}) {
  const accountId = requireText(input.accountId, 'accountId');
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');

  return Object.freeze(requireRecords(records).map((record, index) => {
    const fields = requireFields(record, index);
    const platform = normalizeLower(readLarkText(fields.platform, { label: 'platform' }));
    const rowAccountId = readLarkText(fields.account_id, { label: 'account_id' });
    if (platform !== 'tiktok' || rowAccountId !== accountId) return null;

    const metricDateEpoch = toEpochMilliseconds(fields.metric_date, { label: 'metric_date' });
    return Object.freeze({
      recordId: optionalText(record?.recordId ?? record?.record_id),
      contentDailyKey: readLarkText(fields.content_daily_key, {
        label: 'content_daily_key',
        allowNull: false,
      }),
      externalContentId: readLarkText(fields.external_content_id, {
        label: 'external_content_id',
        allowNull: false,
      }),
      accountId: rowAccountId,
      platform,
      metricDateEpoch,
      metricDate: dateInTimeZone(metricDateEpoch, timeZone),
      views: metricNumber(fields.views, 'views'),
      likes: metricNumber(fields.likes, 'likes'),
      comments: metricNumber(fields.comments, 'comments'),
      shares: metricNumber(fields.shares, 'shares'),
      uniqueViewers: metricNumber(fields.unique_viewers, 'unique_viewers'),
      avgWatchTimeSeconds: metricNumber(fields.avg_watch_time_seconds, 'avg_watch_time_seconds'),
      totalWatchTimeSeconds: metricNumber(fields.total_watch_time_seconds, 'total_watch_time_seconds'),
      completionRate: metricNumber(fields.completion_rate, 'completion_rate'),
    });
  }).filter(Boolean));
}

/** แปลง Instant เป็น Date-only ตาม Timezone โดยไม่ใช้ Locale string ที่ไม่คงที่ */
export function dateInTimeZone(value, timeZone) {
  const epochMs = toEpochMilliseconds(value, { label: 'dateInTimeZone value' });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: requireText(timeZone, 'timeZone'),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function metricNumber(value, label) {
  return readLarkNumber(value, { allowNull: true, label });
}

function optionalEpoch(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return toEpochMilliseconds(value, { label });
}

function requireRecords(value) {
  if (!Array.isArray(value)) throw new TypeError('TikTok report source requires records array');
  return value;
}

function requireFields(record, index) {
  const fields = record?.fields;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError(`TikTok report source record ${index} requires fields object`);
  }
  return fields;
}

function normalizeLower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok report source requires ${fieldName}`);
  }
  return value.trim();
}
