import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import { classifyMarketingContent } from '../services/content-classifier.js';
import { createOrganicContentRows } from '../../../domain/src/entities/organic-content.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

/**
 * แปลง RAW TikTok Creator หนึ่งแถวเป็นสอง Entity สำหรับรายงาน
 * - MKT_Content เก็บข้อมูล Master และ Metric ล่าสุด
 * - MKT_Content_Daily เก็บ Snapshot ประจำวันสำหรับกราฟ/รายงานย้อนหลัง
 */
export function normalizeTikTokCreatorVideo(input) {
  const dictionaryRules = Array.isArray(input?.dictionaryRules) ? input.dictionaryRules : [];
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireDateOnly(input?.metricDate, { label: 'metricDate' });
  const mapped = mapTikTokCreatorVideoRow(input?.rawRow);
  const externalContentId = requireText(mapped.externalContentId, 'externalContentId');
  const contentUrl = mapped.videoUrl;
  const classification = classifyMarketingContent({
    caption: mapped.description,
    url: contentUrl,
    platform: mapped.platform,
    appliesTo: 'organic',
    dictionaryRules,
  });

  const rows = createOrganicContentRows({
    platform: mapped.platform,
    accountId,
    externalContentId,
    metricDate,
    contentType: 'video',
    publishedAt: mapped.publishedAt,
    caption: mapped.description,
    contentUrl,
    thumbnailUrl: mapped.thumbnailUrl,
    durationSeconds: mapped.durationSeconds,
    classification,
    metrics: {
      views: mapped.metrics.views,
      likes: mapped.metrics.likes,
      comments: mapped.metrics.comments,
      shares: mapped.metrics.shares,
      uniqueViewers: mapped.metrics.uniqueViewers,
      averageWatchTimeSeconds: mapped.metrics.averagePlayDurationSeconds,
      totalWatchTimeSeconds: mapped.metrics.totalPlayDurationSeconds,
      completionRate: mapped.metrics.completionRate,
      trafficSources: mapped.metrics.trafficSources,
      countryRegionBreakdown: mapped.metrics.countryRegionBreakdown,
    },
  });

  return Object.freeze({ sourceHandle: mapped.sourceHandle, ...rows });
}

/** บังคับ Account/External ID เป็นข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TikTok Creator normalization requires ${fieldName}`);
  }
  return value.trim();
}
