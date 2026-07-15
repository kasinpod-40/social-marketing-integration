import { normalizeOrganicContentBatch } from './normalize-organic-content-batch.js';
import { normalizeYouTubeVideo } from './normalize-youtube-video.js';

/** Batch wrapper ของ YouTube ที่ใช้ Generic Organic normalization/dedupe contract */
export function normalizeYouTubeVideoBatch(input = {}) {
  const normalized = normalizeOrganicContentBatch({
    rawRows: input.videoResources,
    normalizeRow: (video) => normalizeYouTubeVideo({
      video,
      accountId: input.accountId,
      channelId: input.channelId,
      metricDate: input.metricDate,
      dictionaryRules: input.dictionaryRules,
    }),
    readSourceIdentity: (result) => result.sourceChannelId,
  });
  return Object.freeze({
    ...normalized,
    sourceChannelIds: normalized.sourceIdentities,
  });
}
