import { createContentKey, createDailySnapshotKey } from './create-daily-snapshot.js';
import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { classifyMarketingContent } from '../services/content-classifier.js';
import { bangkokDateToEpochMilliseconds } from '../../../connectors/src/shared/date-time.js';

/**
 * Converts one RAW_TikTok_Creator_Videos row into the two report tables:
 * MKT_Content and MKT_Content_Daily.
 *
 * @param {Object} input
 * @param {Record<string, unknown>} input.rawRow
 * @param {string} input.accountId
 * @param {string} input.metricDate YYYY-MM-DD in the reporting timezone.
 * @returns {{content: Object, dailySnapshot: Object}}
 */
export function normalizeTikTokCreatorVideo(input) {
  const dictionaryRules = Array.isArray(input?.dictionaryRules) ? input.dictionaryRules : [];
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireDate(input?.metricDate, 'metricDate');
  const mapped = mapTikTokCreatorVideoRow(input?.rawRow);
  const externalContentId = requireText(mapped.externalContentId, 'externalContentId');
  const contentUrl = mapped.shareableUrl ?? mapped.embedUrl;
  const classification = classifyMarketingContent({
    caption: mapped.description,
    url: contentUrl,
    platform: mapped.platform,
    appliesTo: 'organic',
    dictionaryRules,
  });

  return Object.freeze({
    sourceHandle: mapped.sourceHandle,
    content: Object.freeze({
      content_key: createContentKey({
        platform: mapped.platform,
        accountId,
        externalContentId,
      }),
      platform: mapped.platform,
      account_id: accountId,
      external_content_id: externalContentId,
      content_type: 'video',
      published_at: mapped.publishedAt,
      caption: mapped.description,
      content_url: contentUrl,
      thumbnail_url: mapped.thumbnailUrl,
      duration_seconds: mapped.durationSeconds,
      latest_views: mapped.metrics.views,
      latest_likes: mapped.metrics.likes,
      latest_comments: mapped.metrics.comments,
      latest_shares: mapped.metrics.shares,
      latest_unique_viewers: mapped.metrics.uniqueViewers,
      avg_watch_time_seconds: mapped.metrics.averagePlayDurationSeconds,
      completion_rate: mapped.metrics.completionRate,
      course_name: classification.course_name,
      course_level: classification.course_level,
      course_type: classification.course_type,
      content_theme: classification.content_theme,
      funnel_stage: classification.funnel_stage,
      cta_type: classification.cta_type,
      cta_destination: classification.cta_destination,
      promotion_type: classification.promotion_type,
      urgency_level: classification.urgency_level,
      classification_source: classification.classification_source,
      classification_confidence: classification.classification_confidence,
      manual_tag_note: classification.manual_tag_note,
    }),
    dailySnapshot: Object.freeze({
      content_daily_key: createDailySnapshotKey({
        platform: mapped.platform,
        accountId,
        entityId: externalContentId,
        metricDate,
      }),
      metric_date: bangkokDateToEpochMilliseconds(metricDate, { label: 'metricDate' }),
      platform: mapped.platform,
      account_id: accountId,
      external_content_id: externalContentId,
      views: mapped.metrics.views,
      likes: mapped.metrics.likes,
      comments: mapped.metrics.comments,
      shares: mapped.metrics.shares,
      unique_viewers: mapped.metrics.uniqueViewers,
      avg_watch_time_seconds: mapped.metrics.averagePlayDurationSeconds,
      total_watch_time_seconds: mapped.metrics.totalPlayDurationSeconds,
      completion_rate: mapped.metrics.completionRate,
      traffic_sources: mapped.metrics.trafficSources,
      country_region_breakdown: mapped.metrics.countryRegionBreakdown,
    }),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TikTok Creator normalization requires ${fieldName}`);
  }

  return value.trim();
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }

  return text;
}
