import { normalizeTikTokCreatorVideoBatch } from './normalize-tiktok-creator-video-batch.js';
import { loadClassificationDictionary } from './load-classification-dictionary.js';

/**
 * Reads the Lark native TikTok Creator raw table, normalizes records, and uses
 * the storage-neutral sync engine to persist report-ready rows.
 */
export async function syncTikTokCreatorNativeToLark(input) {
  const repository = requireReadRepository(input?.repository);
  const syncEngine = requireSyncEngine(input?.syncEngine);
  const tables = requireTables(input?.tables);
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireDate(input?.metricDate, 'metricDate');
  const progress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;

  progress({ stage: 'loading_source_data' });
  const [rawRecords, dictionaryRules] = await Promise.all([
    repository.listAll(tables.rawTikTokCreatorVideos),
    loadClassificationDictionary({ repository, tableId: tables.mktClassificationDictionary }),
  ]);

  const rawRows = rawRecords.map((record) => record?.fields ?? {});
  progress({ stage: 'normalizing', rawRecords: rawRows.length, classificationRules: dictionaryRules.length });
  const normalized = normalizeTikTokCreatorVideoBatch({
    rawRows,
    accountId,
    metricDate,
    dictionaryRules,
  });

  assertSourceIdentity(accountId, normalized.sourceHandles);

  if (input?.dryRun === true) {
    return Object.freeze({
      platform: 'tiktok',
      source: 'lark_native_tiktok_for_creator',
      mode: 'dry_run',
      rawRecords: rawRows.length,
      content: Object.freeze({ created: 0, updated: 0, skipped: 0, duplicateInputRows: 0, rowsReady: normalized.contentRows.length }),
      dailySnapshots: Object.freeze({ created: 0, updated: 0, skipped: 0, duplicateInputRows: 0, rowsReady: normalized.dailySnapshotRows.length }),
      classificationRules: dictionaryRules.length,
      skippedRows: normalized.skippedRows,
    });
  }

  progress({ stage: 'syncing_content', rows: normalized.contentRows.length });
  const contentResult = await syncEngine.syncByKey({
    repository,
    tableId: tables.mktContent,
    keyField: 'content_key',
    rows: normalized.contentRows,
    onProgress: (event) => progress({ scope: 'content', ...event }),
  });
  progress({ stage: 'content_synced', result: contentResult });
  progress({ stage: 'syncing_daily_snapshots', rows: normalized.dailySnapshotRows.length });
  const dailyResult = await syncEngine.syncByKey({
    repository,
    tableId: tables.mktContentDaily,
    keyField: 'content_daily_key',
    rows: normalized.dailySnapshotRows,
    onProgress: (event) => progress({ scope: 'daily_snapshots', ...event }),
  });

  progress({ stage: 'daily_snapshots_synced', result: dailyResult });

  return Object.freeze({
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    mode: 'write',
    rawRecords: rawRows.length,
    content: contentResult,
    dailySnapshots: dailyResult,
    classificationRules: dictionaryRules.length,
    skippedRows: normalized.skippedRows,
  });
}

function requireReadRepository(repository) {
  for (const method of ['listAll', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`syncTikTokCreatorNativeToLark requires repository.${method}`);
    }
  }
  return repository;
}

function requireSyncEngine(syncEngine) {
  if (typeof syncEngine?.syncByKey !== 'function') {
    throw new TypeError('syncTikTokCreatorNativeToLark requires syncEngine.syncByKey');
  }
  return syncEngine;
}

function requireTables(tables) {
  const required = ['rawTikTokCreatorVideos', 'mktContent', 'mktContentDaily', 'mktClassificationDictionary'];
  return Object.freeze(Object.fromEntries(required.map((key) => [key, requireText(tables?.[key], `tables.${key}`)])));
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`TikTok Creator sync requires ${fieldName}`);
  return value.trim();
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must be YYYY-MM-DD`);
  return text;
}


function assertSourceIdentity(accountId, sourceHandles) {
  if (!Array.isArray(sourceHandles) || sourceHandles.length === 0) return;
  if (sourceHandles.length > 1) {
    throw new Error(`RAW TikTok source contains multiple account handles: ${sourceHandles.join(', ')}`);
  }
  const expected = accountId.replace(/^@/u, '').trim().toLowerCase();
  if (sourceHandles[0] !== expected) {
    throw new Error(`RAW TikTok source handle @${sourceHandles[0]} does not match TIKTOK_CREATOR_ACCOUNT_ID=${accountId}`);
  }
}
