import { normalizeTikTokCreatorVideoBatch } from './normalize-tiktok-creator-video-batch.js';
import { loadClassificationDictionary } from './load-classification-dictionary.js';

const DEFAULT_SAMPLE_LIMIT = 5;

/**
 * Non-mutating live validation for the first Lark integration flow.
 * It reads the real RAW TikTok Creator and Classification Dictionary tables,
 * normalizes records in memory, and reports whether the system is ready to
 * perform the actual upsert into MKT_Content and MKT_Content_Daily.
 *
 * @param {Object} input
 * @param {{ listAll: Function, prepareRows: Function }} input.repository
 * @param {Object} input.tables
 * @param {string} input.tables.rawTikTokCreatorVideos
 * @param {string} input.tables.mktClassificationDictionary
 * @param {string} input.tables.mktContent
 * @param {string} input.tables.mktContentDaily
 * @param {string} input.accountId
 * @param {string} input.metricDate YYYY-MM-DD
 * @param {number} [input.sampleLimit]
 */
export async function validateLarkLiveSync(input) {
  const repository = requireRepository(input?.repository);
  const tables = requireTables(input?.tables);
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireDate(input?.metricDate, 'metricDate');
  const sampleLimit = readSafeLimit(input?.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);

  const startedAt = new Date().toISOString();
  const [rawRecords, dictionaryRules] = await Promise.all([
    repository.listAll(tables.rawTikTokCreatorVideos),
    loadClassificationDictionary({
      repository,
      tableId: tables.mktClassificationDictionary,
    }),
  ]);

  const rawRows = rawRecords.map((record) => record?.fields ?? {});
  const normalized = normalizeTikTokCreatorVideoBatch({
    rawRows,
    accountId,
    metricDate,
    dictionaryRules,
  });

  const contentRows = normalized.contentRows;
  const dailyRows = normalized.dailySnapshotRows;

  // Production-like preflight: load the real destination schemas and serialize
  // every row exactly as the write path would, without creating or updating.
  const [preparedContentRows, preparedDailyRows] = await Promise.all([
    repository.prepareRows(tables.mktContent, contentRows, { keyField: 'content_key' }),
    repository.prepareRows(tables.mktContentDaily, dailyRows, { keyField: 'content_daily_key' }),
  ]);
  const sourceIdentity = evaluateSourceIdentity(accountId, normalized.sourceHandles);
  const readyToWrite = sourceIdentity.ok
    && rawRows.length > 0
    && dictionaryRules.length > 0
    && contentRows.length > 0
    && dailyRows.length > 0;

  return Object.freeze({
    ok: readyToWrite,
    mode: 'dry_run',
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    startedAt,
    finishedAt: new Date().toISOString(),
    rawRecords: rawRows.length,
    classificationRules: dictionaryRules.length,
    contentRows: contentRows.length,
    dailySnapshotRows: dailyRows.length,
    sourceIdentity,
    schemaPreflight: Object.freeze({
      contentRows: preparedContentRows.length,
      dailySnapshotRows: preparedDailyRows.length,
    }),
    skippedRows: normalized.skippedRows,
    sample: Object.freeze({
      contentKeys: Object.freeze(contentRows.slice(0, sampleLimit).map((row) => row.content_key)),
      dailyKeys: Object.freeze(dailyRows.slice(0, sampleLimit).map((row) => row.content_daily_key)),
      matchedContentRows: countRowsWithRuleMatches(contentRows),
      manualReviewRows: contentRows.filter((row) => String(row.manual_tag_note ?? '').includes('manual_review')).length,
    }),
    warnings: Object.freeze(buildWarnings({
      rawCount: rawRows.length,
      dictionaryRuleCount: dictionaryRules.length,
      contentRows,
      dailyRows,
      skippedRows: normalized.skippedRows,
      sourceIdentity,
    })),
  });
}

function countRowsWithRuleMatches(contentRows) {
  return contentRows.filter((row) => Number(row.classification_confidence ?? 0) > 0.2).length;
}

function evaluateSourceIdentity(accountId, sourceHandles) {
  const handles = Array.isArray(sourceHandles) ? sourceHandles : [];
  const expected = accountId.replace(/^@/u, '').trim().toLowerCase();
  if (handles.length === 0) return Object.freeze({ ok: true, expectedHandle: expected, detectedHandles: Object.freeze([]) });
  const ok = handles.length === 1 && handles[0] === expected;
  return Object.freeze({ ok, expectedHandle: expected, detectedHandles: Object.freeze([...handles]) });
}

function buildWarnings(input) {
  const warnings = [];
  if (input.rawCount === 0) {
    warnings.push('RAW_TikTok_Creator_Videos has no records to validate.');
  }
  if (input.dictionaryRuleCount === 0) {
    warnings.push('MKT_Classification_Dictionary has no enabled valid rules.');
  }
  if (input.contentRows.length === 0 && input.rawCount > 0) {
    warnings.push('No valid MKT_Content rows were produced from raw rows.');
  }
  if (input.dailyRows.length === 0 && input.rawCount > 0) {
    warnings.push('No valid MKT_Content_Daily rows were produced from raw rows.');
  }
  if (!input.sourceIdentity.ok) {
    warnings.push(`RAW TikTok source handle mismatch: expected @${input.sourceIdentity.expectedHandle}, detected ${input.sourceIdentity.detectedHandles.map((value) => `@${value}`).join(', ') || 'none'}.`);
  }
  if (input.skippedRows.length > 0) {
    warnings.push(`${input.skippedRows.length} raw row(s) were skipped during normalization.`);
  }
  return warnings;
}

function requireRepository(repository) {
  for (const method of ['listAll', 'prepareRows']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`validateLarkLiveSync requires repository.${method}`);
    }
  }

  return repository;
}

function requireTables(tables) {
  const required = ['rawTikTokCreatorVideos', 'mktClassificationDictionary', 'mktContent', 'mktContentDaily'];
  const result = {};

  for (const key of required) {
    result[key] = requireText(tables?.[key], `tables.${key}`);
  }

  return Object.freeze(result);
}

function readSafeLimit(value) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) return DEFAULT_SAMPLE_LIMIT;
  return Math.min(numberValue, 20);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Lark live sync validation requires ${fieldName}`);
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
