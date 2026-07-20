import {
  syncTikTokCreatorNativeToLark as syncTikTokCreatorNativeToLarkLegacy,
} from './sync-tiktok-creator-native-to-lark-legacy.js';
import {
  beginTikTokResumableSource,
  completeTikTokResumableSource,
  replayTikTokCompletedWork,
  stageTikTokResumableSource,
  supersededTikTokResult,
} from './tiktok-resumable-source.js';
import { syncTikTokStagedBusinessToLark } from './sync-tiktok-staged-business-to-lark.js';

/**
 * Entry point กลางของ TikTok Creator sync
 * - Local/legacy callers ที่ไม่มี Durable work store ใช้ Flow เดิมเพื่อรักษา Compatibility
 * - Queue production path ที่มี Durable work store ต้อง Stage และประมวลผล Business ทีละ Unit เท่านั้น
 */
export async function syncTikTokCreatorNativeToLark(input = {}) {
  if (!input.resumableWorkStore) {
    return syncTikTokCreatorNativeToLarkLegacy(input);
  }

  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const context = await beginTikTokResumableSource({
    workStore: input.resumableWorkStore,
    workKey: input.workKey,
    cursorKey: input.cursorKey,
    requestedAt: input.requestedAt,
    generation: input.generation,
    accountId: input.accountId,
    sourceHandle: input.sourceHandle,
    metricDate: input.metricDate,
    syncMode: input.syncMode,
    incrementalEnabled: input.incrementalEnabled,
    dryRun: input.dryRun,
    rawTableId: input.tables?.rawTikTokCreatorVideos,
    assertLockActive,
  });

  if (context.work.superseded) {
    return supersededTikTokResult(syncRunId, context.generation);
  }
  if (context.work.completed) {
    return replayTikTokCompletedWork(context, syncRunId);
  }

  const sourceLoad = await stageTikTokResumableSource({
    context,
    repository: input.repository,
    tableId: input.tables?.rawTikTokCreatorVideos,
    pageSize: input.sourcePageSize,
    maxPages: input.sourceMaxPages,
    onProgress: input.onProgress,
  });
  const result = await syncTikTokStagedBusinessToLark({
    ...input,
    context,
    syncRunId,
    sourceSummary: sourceLoad.summary,
  });
  const completedResult = attachResumableSummary(result, context, sourceLoad.summary);
  await completeTikTokResumableSource(context, completedResult);
  return completedResult;
}

function attachResumableSummary(result, context, sourcePagination) {
  return Object.freeze({
    ...result,
    sourcePagination,
    resumableWork: Object.freeze({
      resumed: context.work?.resumed === true,
      complete: true,
      cleared: true,
      generation: context.generation,
      completionPhaseReplay: result?.stagedBusiness?.completionPhaseReplay === true,
    }),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok sync requires ${fieldName}`);
  }
  return value.trim();
}
