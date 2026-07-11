import { prepareTikTokCreatorLarkSync } from './prepare-tiktok-creator-lark-sync.js';

const DEFAULT_SAMPLE_LIMIT = 5;

/**
 * ตรวจ Live Lark flow แบบไม่เขียนข้อมูล
 *
 * Validation ใช้ Prepare path เดียวกับ Write จริง จึงครอบคลุม:
 * - Source identity
 * - Normalization ทุกแถว
 * - Schema/Field type/Select option
 * - Existing record search และ Diff plan
 * - Account identity conflict
 */
export async function validateLarkLiveSync(input) {
  const startedAt = new Date().toISOString();
  const sampleLimit = readSafeLimit(input?.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);
  const prepared = await prepareTikTokCreatorLarkSync({
    repository: input?.repository,
    syncEngine: input?.syncEngine,
    tables: input?.tables,
    accountId: input?.accountId,
    sourceHandle: input?.sourceHandle,
    metricDate: input?.metricDate,
    onProgress: input?.onProgress,
  });
  const contentRows = prepared.normalized.contentRows;
  const dailyRows = prepared.normalized.dailySnapshotRows;

  return Object.freeze({
    ok: prepared.readyToWrite,
    mode: 'dry_run',
    platform: prepared.platform,
    source: prepared.source,
    startedAt,
    finishedAt: new Date().toISOString(),
    rawRecords: prepared.rawRecords,
    classificationRules: prepared.classificationRules,
    classificationDictionary: prepared.classificationDictionary,
    contentRows: contentRows.length,
    dailySnapshotRows: dailyRows.length,
    sourceIdentity: prepared.sourceIdentity,
    schemaPreflight: Object.freeze({
      contentRows: prepared.plans.content.inputRows,
      dailySnapshotRows: prepared.plans.dailySnapshots.inputRows,
    }),
    syncPlan: Object.freeze({
      content: summarizePlan(prepared.plans.content),
      dailySnapshots: summarizePlan(prepared.plans.dailySnapshots),
    }),
    accountConflicts: prepared.accountConflicts,
    skippedRows: prepared.normalized.skippedRows,
    sample: Object.freeze({
      contentKeys: Object.freeze(contentRows.slice(0, sampleLimit).map((row) => row.content_key)),
      dailyKeys: Object.freeze(dailyRows.slice(0, sampleLimit).map((row) => row.content_daily_key)),
      matchedContentRows: countRowsWithRuleMatches(contentRows),
      manualReviewRows: contentRows.filter((row) => String(row.manual_tag_note ?? '').includes('manual_review')).length,
    }),
    issues: prepared.issues,
    warnings: prepared.warnings,
  });
}

/** นับแถวที่มี Rule confidence สูงกว่าค่า fallback manual review */
function countRowsWithRuleMatches(contentRows) {
  return contentRows.filter((row) => Number(row.classification_confidence ?? 0) > 0.2).length;
}

/** สรุป Plan เฉพาะข้อมูลที่แสดงใน Dry-run output ได้ */
function summarizePlan(plan) {
  return Object.freeze({
    createRows: plan.createRows.length,
    updateRows: plan.updateRows.length,
    skipped: plan.skipped,
    duplicateInputRows: plan.duplicateInputRows,
    existingRecordsRead: plan.existingRecordsRead,
    existingReadStrategy: plan.existingReadStrategy,
  });
}

/** จำกัดจำนวน Sample เพื่อไม่ให้ Terminal output ใหญ่เกินไป */
function readSafeLimit(value) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) return DEFAULT_SAMPLE_LIMIT;
  return Math.min(numberValue, 20);
}
