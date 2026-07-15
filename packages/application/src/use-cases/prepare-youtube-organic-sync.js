import { normalizeYouTubeVideoBatch } from './normalize-youtube-video-batch.js';
import { planOrganicContentDestination } from './plan-organic-content-destination.js';
import { mapYouTubeChannelResource } from '../../../connectors/src/youtube/youtube-organic.adapter.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * เตรียม YouTube Organic destination plan โดยยังไม่เขียน Lark
 * สถานะ Connector ยังเป็น UAT-pending จึงใช้ Use case นี้สำหรับ Tests/Dry-run ก่อนเปิด Worker routing
 */
export async function prepareYouTubeOrganicSync(input = {}) {
  const channelId = requireText(input.channelId, 'channelId');
  const channel = mapYouTubeChannelResource(input.channelResource, channelId);
  const normalized = normalizeYouTubeVideoBatch({
    videoResources: requireArray(input.videoResources, 'videoResources'),
    accountId: requireText(input.accountId, 'accountId'),
    channelId,
    metricDate: input.metricDate,
    dictionaryRules: input.dictionaryRules,
  });
  const issues = buildIssues({ channelId, normalized });
  if (issues.length > 0) {
    return Object.freeze({
      platform: 'youtube',
      source: 'youtube_data_api',
      channel,
      normalized,
      issues: Object.freeze(issues),
      readyToWrite: false,
      plans: null,
      reconciliation: null,
    });
  }

  const destination = await planOrganicContentDestination({
    repository: input.repository,
    syncEngine: input.syncEngine,
    tables: input.tables,
    contentRows: normalized.contentRows,
    dailySnapshotRows: normalized.dailySnapshotRows,
    onProgress: input.onProgress,
  });
  return Object.freeze({
    platform: 'youtube',
    source: 'youtube_data_api',
    channel,
    normalized,
    issues: Object.freeze([]),
    readyToWrite: true,
    plans: destination.plans,
    reconciliation: destination.reconciliation,
  });
}

/** หยุด Activation เมื่อ Preflight พบ Source identity หรือ Normalization issue */
export function assertYouTubeSyncReady(prepared) {
  if (prepared?.readyToWrite === true) return prepared;
  const issues = Array.isArray(prepared?.issues) ? prepared.issues : ['Unknown YouTube readiness error'];
  throw permanentError(`YouTube sync is not ready: ${issues.join(' | ')}`, {
    code: 'YOUTUBE_SYNC_NOT_READY',
    details: { issueCount: issues.length },
  });
}

function buildIssues({ channelId, normalized }) {
  const issues = [];
  if (normalized.contentRows.length === 0) issues.push('No valid YouTube content rows were produced');
  if (normalized.skippedRows.length > 0) issues.push(`${normalized.skippedRows.length} YouTube row(s) failed normalization`);
  if (normalized.duplicateContentRows > 0 || normalized.duplicateDailyRows > 0) {
    issues.push('Duplicate YouTube video identity rows require source cleanup');
  }
  if (normalized.sourceChannelIds.length !== 1 || normalized.sourceChannelIds[0] !== channelId) {
    issues.push('YouTube channel identity mismatch');
  }
  return issues;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`YouTube sync requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube sync requires ${fieldName}`);
  return value.trim();
}
