import { normalizeTikTokCreatorVideo } from './normalize-tiktok-creator-video.js';

/**
 * Converts a batch of Lark Native TikTok Creator rows into upsert-ready rows.
 * The function is intentionally pure and O(n); it does not perform Lark writes.
 *
 * @param {Object} input
 * @param {Array<Record<string, unknown>>} input.rawRows
 * @param {string} input.accountId
 * @param {string} input.metricDate YYYY-MM-DD in the reporting timezone.
 * @param {Array<Object>} [input.dictionaryRules]
 * @returns {{contentRows: Object[], dailySnapshotRows: Object[], skippedRows: Object[]}}
 */
export function normalizeTikTokCreatorVideoBatch(input) {
  const rawRows = requireArray(input?.rawRows, 'rawRows');
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireText(input?.metricDate, 'metricDate');
  const dictionaryRules = Array.isArray(input?.dictionaryRules) ? input.dictionaryRules : [];
  const seenContentKeys = new Set();
  const seenDailyKeys = new Set();
  const contentRows = [];
  const dailySnapshotRows = [];
  const skippedRows = [];

  for (let index = 0; index < rawRows.length; index += 1) {
    try {
      const normalized = normalizeTikTokCreatorVideo({
        accountId,
        metricDate,
        rawRow: rawRows[index],
        dictionaryRules,
      });

      if (!seenContentKeys.has(normalized.content.content_key)) {
        seenContentKeys.add(normalized.content.content_key);
        contentRows.push(normalized.content);
      }

      if (!seenDailyKeys.has(normalized.dailySnapshot.content_daily_key)) {
        seenDailyKeys.add(normalized.dailySnapshot.content_daily_key);
        dailySnapshotRows.push(normalized.dailySnapshot);
      }
    } catch (error) {
      skippedRows.push(Object.freeze({
        rowIndex: index,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return Object.freeze({
    contentRows: Object.freeze(contentRows),
    dailySnapshotRows: Object.freeze(dailySnapshotRows),
    skippedRows: Object.freeze(skippedRows),
  });
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TikTok Creator batch normalization requires ${fieldName}`);
  }

  return value.trim();
}
