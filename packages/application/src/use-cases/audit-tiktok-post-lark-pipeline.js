import { readLarkText } from '../../../connectors/src/shared/lark-cell-value.js';
import { probeTikTokNativeSourceWatermark } from './probe-tiktok-native-source-watermark.js';

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 1_000;
const MAX_GAP_EXAMPLES = 100;

/**
 * Read-only cross-layer audit. This use case exposes compact keys/counts only and has no write API.
 */
export async function auditTikTokPostLarkPipeline(input = {}) {
  const repository = requireRepository(input.repository);
  const d1AuditStore = requireD1AuditStore(input.d1AuditStore);
  const tables = requireTables(input.tables);
  const accountKey = requireText(input.accountKey, 'accountKey');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const sourceHandle = requireText(input.sourceHandle, 'sourceHandle');
  const pageSize = boundedPositiveInteger(
    input.pageSize ?? DEFAULT_PAGE_SIZE,
    'pageSize',
    DEFAULT_PAGE_SIZE,
  );
  const maxPages = boundedPositiveInteger(
    input.maxPages ?? DEFAULT_MAX_PAGES,
    'maxPages',
    DEFAULT_MAX_PAGES,
  );
  const maxContentRecords = pageSize * maxPages;

  const [raw, content, daily, d1] = await Promise.all([
    probeTikTokNativeSourceWatermark({
      repository,
      tableId: tables.rawTikTokCreatorVideos,
      accountKey,
      expectedSourceHandle: sourceHandle,
      pageSize,
      maxPages,
    }),
    scanCanonicalTable({
      repository,
      tableId: tables.mktContent,
      tableRole: 'content',
      keyField: 'content_key',
      accountKey,
      pageSize,
      maxPages,
    }),
    scanCanonicalTable({
      repository,
      tableId: tables.mktContentDaily,
      tableRole: 'daily',
      keyField: 'content_daily_key',
      accountKey,
      pageSize,
      maxPages,
    }),
    d1AuditStore.audit({ customerKey, accountKey, maxContentRecords }),
  ]);

  const rawIds = new Set(raw.externalContentIds);
  const contentIds = new Set(content.externalContentIds);
  const dailyIds = new Set(daily.externalContentIds);
  const d1Ids = new Set(d1.contentIdentities.map((item) => item.externalContentId));
  const gaps = Object.freeze({
    rawMissingInD1: createGap(rawIds, d1Ids),
    rawMissingInContent: createGap(rawIds, contentIds),
    d1MissingInContent: createGap(d1Ids, contentIds),
    contentMissingInDaily: createGap(contentIds, dailyIds),
    contentNotInRaw: createGap(contentIds, rawIds),
  });
  const issues = buildIssues({ raw, content, daily, d1, gaps });

  return Object.freeze({
    mode: 'read_only',
    platform: 'tiktok',
    customerKey,
    accountKey,
    sourceHandle: raw.sourceHandle,
    raw: Object.freeze({
      recordCount: raw.recordCount,
      pagesProcessed: raw.pagesProcessed,
      maxModifiedAt: raw.maxModifiedAt,
      sourceWatermark: raw.sourceWatermark,
      bounded: raw.bounded,
    }),
    d1,
    canonical: Object.freeze({ content, daily }),
    gaps,
    readyForManualProcessing: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

async function scanCanonicalTable(input) {
  const keyCounts = new Map();
  const externalContentIds = new Set();
  let totalRows = 0;
  let matchingRows = 0;
  let missingKeys = 0;
  let pageToken = null;
  const seenTokens = new Set();
  let pagesProcessed = 0;

  while (pagesProcessed < input.maxPages) {
    const page = await input.repository.listPage(input.tableId, {
      pageToken,
      pageSize: input.pageSize,
    });
    const records = requireArray(page?.records, `${input.tableRole}.records`);
    totalRows += records.length;
    for (const record of records) {
      const fields = record?.fields ?? {};
      const platform = String(readLarkText(fields.platform, {
        allowNull: true,
        label: `${input.tableRole}.platform`,
      }) ?? '').toLowerCase();
      const accountId = readLarkText(fields.account_id, {
        allowNull: true,
        label: `${input.tableRole}.account_id`,
      });
      if (platform !== 'tiktok' || accountId !== input.accountKey) continue;
      matchingRows += 1;
      const key = readLarkText(fields[input.keyField], {
        allowNull: true,
        label: `${input.tableRole}.${input.keyField}`,
      });
      if (!key) missingKeys += 1;
      else keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      const externalContentId = readLarkText(fields.external_content_id, {
        allowNull: true,
        label: `${input.tableRole}.external_content_id`,
      });
      if (externalContentId) externalContentIds.add(externalContentId);
    }

    pagesProcessed += 1;
    if (page?.hasMore !== true) break;
    const nextPageToken = requireText(page?.nextPageToken, `${input.tableRole}.nextPageToken`);
    if (nextPageToken === pageToken || seenTokens.has(nextPageToken)) {
      throw new Error(`TikTok ${input.tableRole} audit returned a repeated page token`);
    }
    if (pageToken) seenTokens.add(pageToken);
    pageToken = nextPageToken;
  }
  if (pagesProcessed >= input.maxPages && pageToken !== null) {
    throw new Error(`TikTok ${input.tableRole} audit exceeded its page limit`);
  }

  const duplicateKeys = [...keyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  return Object.freeze({
    tableRole: input.tableRole,
    totalRowsScanned: totalRows,
    matchingRows,
    distinctKeys: keyCounts.size,
    missingKeys,
    duplicateKeyCount: duplicateKeys.length,
    duplicateKeys: Object.freeze(duplicateKeys.slice(0, MAX_GAP_EXAMPLES)),
    externalContentIds: Object.freeze([...externalContentIds].sort()),
    externalContentCount: externalContentIds.size,
    pagesProcessed,
    bounded: true,
  });
}

function createGap(expected, observed) {
  const missing = [...expected].filter((value) => !observed.has(value)).sort();
  return Object.freeze({
    count: missing.length,
    externalContentIds: Object.freeze(missing.slice(0, MAX_GAP_EXAMPLES)),
    truncated: missing.length > MAX_GAP_EXAMPLES,
  });
}

function buildIssues(input) {
  const issues = [];
  if (input.content.missingKeys > 0 || input.content.duplicateKeyCount > 0) {
    issues.push(Object.freeze({
      code: 'TIKTOK_CANONICAL_CONTENT_KEY_INVALID',
      missingKeys: input.content.missingKeys,
      duplicateKeys: input.content.duplicateKeyCount,
    }));
  }
  if (input.daily.missingKeys > 0 || input.daily.duplicateKeyCount > 0) {
    issues.push(Object.freeze({
      code: 'TIKTOK_CANONICAL_DAILY_KEY_INVALID',
      missingKeys: input.daily.missingKeys,
      duplicateKeys: input.daily.duplicateKeyCount,
    }));
  }
  if (input.d1.state.duplicateKeys > 0 || input.d1.observations.duplicateKeys > 0) {
    issues.push(Object.freeze({ code: 'TIKTOK_D1_DUPLICATE_KEYS' }));
  }
  if (input.d1.missingObservationRows > 0 || Number(input.d1.missingCoverageRows ?? 0) > 0) {
    issues.push(Object.freeze({
      code: 'TIKTOK_D1_COVERAGE_GAP',
      missingObservationRows: input.d1.missingObservationRows,
      missingCoverageRows: input.d1.missingCoverageRows,
    }));
  }
  for (const [name, gap] of Object.entries(input.gaps)) {
    if (gap.count > 0 && name !== 'contentNotInRaw') {
      issues.push(Object.freeze({ code: 'TIKTOK_CROSS_LAYER_GAP', gap: name, count: gap.count }));
    }
  }
  return issues;
}

function requireRepository(value) {
  if (typeof value?.listPage !== 'function') {
    throw new TypeError('TikTok post-Lark audit requires repository.listPage');
  }
  return value;
}

function requireD1AuditStore(value) {
  if (typeof value?.audit !== 'function') {
    throw new TypeError('TikTok post-Lark audit requires d1AuditStore.audit');
  }
  return value;
}

function requireTables(value) {
  return Object.freeze({
    rawTikTokCreatorVideos: requireText(value?.rawTikTokCreatorVideos, 'tables.rawTikTokCreatorVideos'),
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
  });
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new TypeError(`${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}
