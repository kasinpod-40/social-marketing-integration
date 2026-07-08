import { normalizeTikTokCreatorVideoBatch } from './normalize-tiktok-creator-video-batch.js';

/**
 * Reads the Lark native TikTok Creator raw table, normalizes records, and upserts
 * report-ready rows into MKT_Content and MKT_Content_Daily.
 *
 * @param {Object} input
 * @param {{ listAll: Function, upsertByKey: Function }} input.repository
 * @param {Object} input.tables
 * @param {string} input.tables.rawTikTokCreatorVideos
 * @param {string} input.tables.mktContent
 * @param {string} input.tables.mktContentDaily
 * @param {string} input.accountId
 * @param {string} input.metricDate YYYY-MM-DD
 */
export async function syncTikTokCreatorNativeToLark(input) {
  const repository = requireRepository(input?.repository);
  const tables = requireTables(input?.tables);
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireDate(input?.metricDate, 'metricDate');

  const rawRecords = await repository.listAll(tables.rawTikTokCreatorVideos);
  const rawRows = rawRecords.map((record) => record?.fields ?? {});
  const normalized = normalizeTikTokCreatorVideoBatch({ rawRows, accountId, metricDate });

  const [contentResult, dailyResult] = await Promise.all([
    repository.upsertByKey({
      tableId: tables.mktContent,
      keyField: 'content_key',
      rows: normalized.contentRows,
    }),
    repository.upsertByKey({
      tableId: tables.mktContentDaily,
      keyField: 'content_daily_key',
      rows: normalized.dailySnapshotRows,
    }),
  ]);

  return Object.freeze({
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    rawRecords: rawRows.length,
    content: contentResult,
    dailySnapshots: dailyResult,
    skippedRows: normalized.skippedRows,
  });
}

function requireRepository(repository) {
  if (typeof repository?.listAll !== 'function' || typeof repository?.upsertByKey !== 'function') {
    throw new TypeError('syncTikTokCreatorNativeToLark requires repository with listAll and upsertByKey');
  }

  return repository;
}

function requireTables(tables) {
  const required = ['rawTikTokCreatorVideos', 'mktContent', 'mktContentDaily'];
  const result = {};

  for (const key of required) {
    result[key] = requireText(tables?.[key], `tables.${key}`);
  }

  return Object.freeze(result);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TikTok Creator sync requires ${fieldName}`);
  }

  return value.trim();
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }

  return text;
}
