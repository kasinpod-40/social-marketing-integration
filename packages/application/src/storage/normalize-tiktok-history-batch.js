import { normalizeTikTokCreatorVideoBatch } from '../use-cases/normalize-tiktok-creator-video-batch.js';
import { evaluateSourceIdentity } from '../use-cases/prepare-tiktok-creator-lark-sync.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Normalize staged Lark Native records สำหรับ D1 history โดยไม่อ่าน/เขียน Lark Canonical tables. */
export function normalizeTikTokHistoryBatch(input = {}) {
  const records = requireArray(input.records, 'records');
  const rawRows = records.map((record) => record?.fields ?? {});
  const normalized = normalizeTikTokCreatorVideoBatch({
    rawRows,
    accountId: requireText(input.accountKey, 'accountKey'),
    metricDate: requireText(input.metricDate, 'metricDate'),
    sourceTimezone: requireText(input.sourceTimezone, 'sourceTimezone'),
    dictionaryRules: [],
  });
  const identity = evaluateSourceIdentity(
    requireText(input.sourceHandle, 'sourceHandle'),
    normalized.sourceHandles,
  );
  if (!identity.ok && normalized.contentRows.length > 0) {
    throw permanentError('TikTok history bootstrap source identity mismatch', {
      code: 'TIKTOK_HISTORY_SOURCE_IDENTITY_MISMATCH',
      details: {
        expectedHandle: identity.expectedHandle,
        detectedHandles: identity.detectedHandles,
      },
    });
  }

  return Object.freeze({
    rawRecords: records.length,
    contentRows: normalized.contentRows,
    dailySnapshotRows: normalized.dailySnapshotRows,
    skippedRows: normalized.skippedRows,
    duplicateContentRows: normalized.duplicateContentRows,
    duplicateDailyRows: normalized.duplicateDailyRows,
    sourceIdentity: identity,
  });
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok history bootstrap requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok history bootstrap requires ${fieldName}`);
  }
  return value.trim();
}
