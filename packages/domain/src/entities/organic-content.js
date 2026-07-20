import { createContentKey, createDailySnapshotKey } from '../value-objects/content-identity.js';
import {
  dateOnlyInTimeZoneToEpochMilliseconds,
  requireDateOnly,
} from '../../../shared/src/date/date-only.js';

/**
 * สร้าง MKT_Content และ MKT_Content_Daily จาก Canonical Organic source
 * ใช้ร่วมกันเฉพาะ Field ที่ทุก Platform มีความหมายตรงกันจริง
 *
 * `sourceTimezone` เป็น Contract บังคับจาก Runtime/Adapter เพื่อไม่ให้ Domain กลาง
 * เดาวันด้วย Asia/Bangkok และเพื่อรองรับ Source timezone/DST ของลูกค้าแต่ละราย
 */
export function createOrganicContentRows(input = {}) {
  const platform = requireText(input.platform, 'platform');
  const accountId = requireText(input.accountId, 'accountId');
  const externalContentId = requireText(input.externalContentId, 'externalContentId');
  const metricDate = requireDateOnly(input.metricDate, { label: 'metricDate' });
  const sourceTimezone = requireText(input.sourceTimezone, 'sourceTimezone');
  const metrics = requireObject(input.metrics ?? {}, 'metrics');
  const classification = requireObject(input.classification ?? {}, 'classification');

  return Object.freeze({
    content: Object.freeze({
      content_key: createContentKey({ platform, accountId, externalContentId }),
      platform,
      account_id: accountId,
      external_content_id: externalContentId,
      content_type: optionalText(input.contentType) ?? 'video',
      published_at: nullableFiniteNumber(input.publishedAt, 'publishedAt'),
      caption: optionalText(input.caption),
      content_url: optionalText(input.contentUrl),
      thumbnail_url: optionalText(input.thumbnailUrl),
      duration_seconds: nullableNonNegativeNumber(input.durationSeconds, 'durationSeconds'),
      latest_views: nullableCount(metrics.views, 'metrics.views'),
      latest_likes: nullableCount(metrics.likes, 'metrics.likes'),
      latest_comments: nullableCount(metrics.comments, 'metrics.comments'),
      latest_shares: nullableCount(metrics.shares, 'metrics.shares'),
      latest_unique_viewers: nullableCount(metrics.uniqueViewers, 'metrics.uniqueViewers'),
      avg_watch_time_seconds: nullableNonNegativeNumber(
        metrics.averageWatchTimeSeconds,
        'metrics.averageWatchTimeSeconds',
      ),
      completion_rate: nullableRatio(metrics.completionRate, 'metrics.completionRate'),
      course_name: nullableValue(classification.course_name),
      course_level: nullableValue(classification.course_level, []),
      course_type: nullableValue(classification.course_type),
      content_theme: nullableValue(classification.content_theme),
      funnel_stage: nullableValue(classification.funnel_stage),
      cta_type: nullableValue(classification.cta_type),
      cta_destination: nullableValue(classification.cta_destination),
      promotion_type: nullableValue(classification.promotion_type),
      urgency_level: nullableValue(classification.urgency_level),
      classification_source: nullableValue(classification.classification_source),
      classification_confidence: nullableFiniteNumber(
        classification.classification_confidence,
        'classification.classification_confidence',
      ),
      manual_tag_note: nullableValue(classification.manual_tag_note),
    }),
    dailySnapshot: Object.freeze({
      content_daily_key: createDailySnapshotKey({
        platform,
        accountId,
        entityId: externalContentId,
        metricDate,
      }),
      metric_date: dateOnlyInTimeZoneToEpochMilliseconds(metricDate, {
        label: 'metricDate',
        timeZone: sourceTimezone,
      }),
      platform,
      account_id: accountId,
      external_content_id: externalContentId,
      views: nullableCount(metrics.views, 'metrics.views'),
      likes: nullableCount(metrics.likes, 'metrics.likes'),
      comments: nullableCount(metrics.comments, 'metrics.comments'),
      shares: nullableCount(metrics.shares, 'metrics.shares'),
      unique_viewers: nullableCount(metrics.uniqueViewers, 'metrics.uniqueViewers'),
      avg_watch_time_seconds: nullableNonNegativeNumber(
        metrics.averageWatchTimeSeconds,
        'metrics.averageWatchTimeSeconds',
      ),
      total_watch_time_seconds: nullableNonNegativeNumber(
        metrics.totalWatchTimeSeconds,
        'metrics.totalWatchTimeSeconds',
      ),
      completion_rate: nullableRatio(metrics.completionRate, 'metrics.completionRate'),
      traffic_sources: nullableValue(metrics.trafficSources),
      country_region_breakdown: nullableValue(metrics.countryRegionBreakdown),
    }),
  });
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Organic content ${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Organic content requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('Organic content text value must be a string');
  return value.trim() || null;
}

function nullableFiniteNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite`);
  return number;
}

function nullableNonNegativeNumber(value, fieldName) {
  const number = nullableFiniteNumber(value, fieldName);
  if (number !== null && number < 0) throw new RangeError(`${fieldName} must be non-negative`);
  return number;
}

function nullableCount(value, fieldName) {
  const number = nullableFiniteNumber(value, fieldName);
  if (number !== null && (!Number.isSafeInteger(number) || number < 0)) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function nullableRatio(value, fieldName) {
  const number = nullableFiniteNumber(value, fieldName);
  if (number !== null && (number < 0 || number > 1)) {
    throw new RangeError(`${fieldName} must be between 0 and 1`);
  }
  return number;
}

function nullableValue(value, fallback = null) {
  return value === undefined ? fallback : value;
}
