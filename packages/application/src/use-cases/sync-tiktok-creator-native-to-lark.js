import {
  assertTikTokSyncReady,
  prepareTikTokCreatorLarkSync,
} from './prepare-tiktok-creator-lark-sync.js';

/**
 * Sync RAW TikTok Creator ไปยัง MKT_Content และ MKT_Content_Daily
 *
 * ลำดับที่ปลอดภัย:
 * 1. อ่าน RAW + Dictionary
 * 2. Normalize และตรวจ Source identity
 * 3. Preflight Schema และวาง Plan ของทั้งสองตาราง
 * 4. ตรวจ Account identity conflict
 * 5. เมื่อทุกอย่างผ่านจึง Execute Content แล้ว Daily Snapshot
 *
 * การแยก Plan ออกจาก Execute ทำให้ Error ด้าน Field/URL/Date/Select ของตารางหลัง
 * ถูกพบก่อนตารางแรกเริ่มเขียน ลด Partial write จาก Validation error
 */
export async function syncTikTokCreatorNativeToLark(input) {
  const progress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
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
      platform: prepared.platform,
      source: prepared.source,
      mode: 'dry_run',
      readyToWrite: prepared.readyToWrite,
      rawRecords: prepared.rawRecords,
      classificationRules: prepared.classificationRules,
      classificationDictionary: prepared.classificationDictionary,
      content: planSummary(prepared.plans.content),
      dailySnapshots: planSummary(prepared.plans.dailySnapshots),
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
    createRows: prepared.plans.content.createRows.length,
    updateRows: prepared.plans.content.updateRows.length,
  });
  const contentResult = await input.syncEngine.executePlan(prepared.plans.content, {
    onProgress: (event) => progress({ scope: 'content', ...event }),
  });
  progress({ stage: 'content_synced', result: contentResult });

  progress({
    stage: 'executing_daily_snapshot_plan',
    createRows: prepared.plans.dailySnapshots.createRows.length,
    updateRows: prepared.plans.dailySnapshots.updateRows.length,
  });
  const dailyResult = await input.syncEngine.executePlan(prepared.plans.dailySnapshots, {
    onProgress: (event) => progress({ scope: 'daily_snapshots', ...event }),
  });
  progress({ stage: 'daily_snapshots_synced', result: dailyResult });

  return Object.freeze({
    platform: prepared.platform,
    source: prepared.source,
    mode: 'write',
    rawRecords: prepared.rawRecords,
    content: contentResult,
    dailySnapshots: dailyResult,
    classificationRules: prepared.classificationRules,
    classificationDictionary: prepared.classificationDictionary,
    skippedRows: prepared.normalized.skippedRows,
    sourceIdentity: prepared.sourceIdentity,
    accountConflicts: prepared.accountConflicts,
    warnings: prepared.warnings,
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
