import { mapYouTubeVideoResource } from '../../../connectors/src/youtube/youtube-organic.adapter.js';
import { createOrganicContentRows } from '../../../domain/src/entities/organic-content.js';
import { classifyMarketingContent } from '../services/content-classifier.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

/** Normalize YouTube Data API video resource ไปยัง MKT_Content และ cumulative daily snapshot */
export function normalizeYouTubeVideo(input = {}) {
  const accountId = requireText(input.accountId, 'accountId');
  const channelId = requireText(input.channelId, 'channelId');
  const metricDate = requireDateOnly(input.metricDate, { label: 'metricDate' });
  const sourceTimezone = requireText(input.sourceTimezone ?? 'Asia/Bangkok', 'sourceTimezone');
  const mapped = mapYouTubeVideoResource(input.video, { expectedChannelId: channelId });
  const caption = [mapped.title, mapped.description].filter(Boolean).join('\n').trim() || null;
  const classification = classifyMarketingContent({
    caption,
    url: mapped.videoUrl,
    platform: 'youtube',
    appliesTo: 'organic',
    dictionaryRules: Array.isArray(input.dictionaryRules) ? input.dictionaryRules : [],
  });
  const rows = createOrganicContentRows({
    platform: 'youtube',
    accountId,
    externalContentId: mapped.externalContentId,
    metricDate,
    sourceTimezone,
    contentType: 'video',
    publishedAt: mapped.publishedAt,
    caption,
    contentUrl: mapped.videoUrl,
    thumbnailUrl: mapped.thumbnailUrl,
    durationSeconds: mapped.durationSeconds,
    metrics: mapped.metrics,
    classification,
  });
  return Object.freeze({ sourceChannelId: mapped.sourceChannelId, ...rows });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube normalization requires ${fieldName}`);
  return value.trim();
}
