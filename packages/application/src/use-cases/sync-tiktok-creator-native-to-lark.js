import {
  assertTikTokSyncReady,
  prepareTikTokCreatorLarkSync,
} from './prepare-tiktok-creator-lark-sync.js';
import { partialSyncError } from '../../../shared/src/errors/runtime-error.js';

/**
 * Sync RAW TikTok Creator ไปยัง MKT_Content และ MKT_Content_Daily
 *
 * Flow แยก Prepare/Execute และส่ง syncRunId ลงผลลัพธ์ เพื่อให้ Reliability layer
 * เชื่อม Log, Alert และ Recovery ของรอบเดียวกันได้ครบ
 */
export async function syncTikTokCreatorNativeToLark(input) {
  const progress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
  const syncRunId = optionalText(input?.syncRunId);
  const prepared = await prepareTikTokCreatorLarkSync({
    repository: input?.repository,
    syncEngine: input?.syncEngine,
    tables: input?.tables,
    accountId: input?.accountId,
    sourceHandle: input?.sourceHandle,
    metricDate: input?.metricDate,
    onProgress: progress,
  });

  if (input?.dryRun === true) {
    return Object.freeze({
      syncRunId,
      platform: prepared.platform,
      source: prepared.source,
      mode: 'dry_run',
      readyToWrite: prepared.readyToWrite,
      rawRecords: prepared.rawRecords,
      classificationRules: prepared.classificationRules,
      classificationDictionary: prepared.classificationDictionary,
      content: planSummary(prepared.plans.content),
      dailySnapshots: planSummary(prepared.plans.dailySnapshots),
      reconciliation: prepared.reconciliation,
      skippedRows: prepared.normalized.skippedRows,
      sourceIdentity: prepared.sourceIdentity,
      accountConflicts: prepared.accountConflicts,
      issues: prepared.issues,
      warnings: prepared.warnings,
    });
  }

  assertTikTokSyncReady(prepared);

  progress({
    stage: 'executing_content_plan',
    syncRunId,
    createRows: prepared.plans.content.createRows.length,
    updateRows: prepared.plans.content.updateRows.length,
  });
  const contentResult = await input.syncEngine.executePlan(prepared.plans.content, {
    onProgress: (event) => progress({ scope: 'content', syncRunId, ...event }),
  });
  progress({ stage: 'content_synced', syncRunId, result: contentResult });

  progress({
    stage: 'executing_daily_snapshot_plan',
    syncRunId,
    createRows: prepared.plans.dailySnapshots.createRows.length,
    updateRows: prepared.plans.dailySnapshots.updateRows.length,
  });

  let dailyResult;
  try {
    dailyResult = await input.syncEngine.executePlan(prepared.plans.dailySnapshots, {
      onProgress: (event) => progress({ scope: 'daily_snapshots', syncRunId, ...event }),
    });
  } catch (cause) {
    const partialResult = buildResult({
      syncRunId,
      prepared,
      contentResult,
      dailyResult: {
        created: 0,
        updated: 0,
        skipped: prepared.plans.dailySnapshots.skipped,
        duplicateInputRows: prepared.plans.dailySnapshots.duplicateInputRows,
        writeOutcome: 'unknown',
      },
      reconciliationStatus: 'partial_write_detected',
    });

    throw partialSyncError('TikTok content sync succeeded but daily snapshot sync failed', {
      cause,
      partialResult,
      details: {
        syncRunId,
        failedPhase: 'daily_snapshots',
        contentCreated: contentResult.created,
        contentUpdated: contentResult.updated,
        dailyCreatePlanned: prepared.plans.dailySnapshots.createRows.length,
        dailyUpdatePlanned: prepared.plans.dailySnapshots.updateRows.length,
        causeMessage: cause instanceof Error ? cause.message : String(cause),
      },
    });
  }

  progress({ stage: 'daily_snapshots_synced', syncRunId, result: dailyResult });
  return buildResult({
    syncRunId,
    prepared,
    contentResult,
    dailyResult,
    reconciliationStatus: prepared.reconciliation.required ? 'recovered' : 'not_required',
  });
}

function buildResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: input.prepared.platform,
    source: input.prepared.source,
    mode: 'write',
    rawRecords: input.prepared.rawRecords,
    content: Object.freeze({ ...input.contentResult }),
    dailySnapshots: Object.freeze({ ...input.dailyResult }),
    reconciliation: Object.freeze({
      ...input.prepared.reconciliation,
      status: input.reconciliationStatus,
      recovered: input.reconciliationStatus === 'recovered',
    }),
    classificationRules: input.prepared.classificationRules,
    classificationDictionary: input.prepared.classificationDictionary,
    skippedRows: input.prepared.normalized.skippedRows,
    sourceIdentity: input.prepared.sourceIdentity,
    accountConflicts: input.prepared.accountConflicts,
    warnings: input.prepared.warnings,
  });
}

/** สรุป Plan สำหรับ Dry run โดยไม่เปิดเผย Repository ภายใน */
function planSummary(plan) {
  return Object.freeze({
    rowsReady: plan.inputRows,
    createRows: plan.createRows.length,
    updateRows: plan.updateRows.length,
    skipped: plan.skipped,
    duplicateInputRows: plan.duplicateInputRows,
    existingRecordsRead: plan.existingRecordsRead,
    existingReadStrategy: plan.existingReadStrategy,
  });
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('syncRunId must be a non-empty string');
  }
  return value.trim();
}
