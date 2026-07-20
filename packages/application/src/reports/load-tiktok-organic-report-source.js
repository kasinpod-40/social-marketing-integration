import { readLarkText } from '../../../connectors/src/shared/lark-cell-value.js';
import { dateOnlyToEpochMilliseconds, requireDateOnly } from '../../../shared/src/date/date-only.js';
import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const DEFAULT_REPORT_MAX_CONTENT_RECORDS = 800;
export const DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS = 50_000;
export const DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS = 50_000;
export const DEFAULT_REPORT_MAX_PAGES_PER_QUERY = 100;
export const DEFAULT_REPORT_SOURCE_PAGE_SIZE = 500;

const PLATFORM = 'tiktok';

/**
 * โหลด Report source ด้วย Server-side filters เมื่อ Adapter รองรับ และใช้เฉพาะ
 * bounded page fallback สำหรับ Compatibility adapter รุ่นเก่าเท่านั้น.
 */
export async function loadTikTokOrganicReportSource(input = {}) {
  const repository = requireRepository(input.repository);
  const tables = requireTables(input.tables);
  const accountId = requireText(input.accountId, 'accountId');
  const period = requirePeriod(input.period);
  const utcOffset = requireText(input.utcOffset, 'utcOffset');
  const limits = readLimits(input);

  if (typeof repository.searchRecords === 'function') {
    return loadServerFilteredSource({
      repository,
      tables,
      accountId,
      period,
      utcOffset,
      limits,
    });
  }

  if (typeof repository.listPage === 'function') {
    return loadBoundedPageFallback({
      repository,
      tables,
      accountId,
      period,
      limits,
    });
  }

  throw permanentError('TikTok report source requires a bounded read adapter', {
    code: 'REPORT_SOURCE_BOUNDED_READ_REQUIRED',
  });
}

async function loadServerFilteredSource(input) {
  const earliestStart = input.period.compareStart ?? input.period.periodStart;
  const earliestStartEpoch = dateOnlyToEpochMilliseconds(earliestStart, {
    utcOffset: input.utcOffset,
    label: 'report earliestStart',
  });
  const periodEndEpoch = dateOnlyToEpochMilliseconds(input.period.periodEnd, {
    utcOffset: input.utcOffset,
    label: 'report periodEnd',
  });
  let rowsFetched = 0;
  let dailyQueries = 0;

  const contentRecords = await input.repository.searchRecords(input.tables.mktContent, {
    filter: accountPlatformFilter(input.accountId),
    sort: [{ fieldName: 'external_content_id', desc: false }],
    pageSize: input.limits.pageSize,
    maxPages: input.limits.maxPagesPerQuery,
    maxItems: input.limits.maxContentRecords + 1,
    stopWhen: ({ totalRows }) => totalRows > input.limits.maxContentRecords,
  });
  rowsFetched += contentRecords.length;
  assertWithinLimit(contentRecords.length, input.limits.maxContentRecords, {
    code: 'REPORT_SOURCE_CONTENT_LIMIT_EXCEEDED',
    label: 'content records',
  });

  // Window discovery preserves active snapshot identities even when Content metadata is missing.
  const windowRecords = await input.repository.searchRecords(input.tables.mktContentDaily, {
    filter: {
      conjunction: 'and',
      conditions: [
        ...accountPlatformFilter(input.accountId).conditions,
        { fieldName: 'metric_date', operator: 'isGreaterEqual', value: [earliestStartEpoch] },
        { fieldName: 'metric_date', operator: 'isLessEqual', value: [periodEndEpoch] },
      ],
    },
    sort: [
      { fieldName: 'external_content_id', desc: false },
      { fieldName: 'metric_date', desc: true },
    ],
    pageSize: input.limits.pageSize,
    maxPages: input.limits.maxPagesPerQuery,
    maxItems: input.limits.maxSnapshotRecords + 1,
    stopWhen: ({ totalRows }) => totalRows > input.limits.maxSnapshotRecords,
  });
  dailyQueries += 1;
  rowsFetched += windowRecords.length;
  assertWithinLimit(windowRecords.length, input.limits.maxSnapshotRecords, {
    code: 'REPORT_SOURCE_SNAPSHOT_LIMIT_EXCEEDED',
    label: 'snapshot records',
  });

  const externalContentIds = new Set();
  for (const record of contentRecords) externalContentIds.add(readExternalContentId(record));
  for (const record of windowRecords) externalContentIds.add(readExternalContentId(record));

  const dailyByIdentity = new Map();
  for (const record of windowRecords) dailyByIdentity.set(snapshotIdentity(record), record);

  assertWithinLimit(externalContentIds.size, input.limits.maxContentRecords, {
    code: 'REPORT_SOURCE_CONTENT_LIMIT_EXCEEDED',
    label: 'tracked content identities',
  });

  let snapshotRowsFetched = windowRecords.length;
  for (const externalContentId of externalContentIds) {
    const remaining = input.limits.maxSnapshotRecords - snapshotRowsFetched;
    if (remaining <= 0) {
      throw limitError('REPORT_SOURCE_SNAPSHOT_LIMIT_EXCEEDED', 'snapshot records', {
        limit: input.limits.maxSnapshotRecords,
        observed: snapshotRowsFetched,
      });
    }

    const hasWindowSnapshot = windowRecords.some(
      (record) => readExternalContentId(record) === externalContentId,
    );
    const dateCondition = hasWindowSnapshot
      ? { fieldName: 'metric_date', operator: 'isLess', value: [earliestStartEpoch] }
      : { fieldName: 'metric_date', operator: 'isLessEqual', value: [periodEndEpoch] };
    const records = await input.repository.searchRecords(input.tables.mktContentDaily, {
      filter: {
        conjunction: 'and',
        conditions: [
          ...accountPlatformFilter(input.accountId).conditions,
          { fieldName: 'external_content_id', operator: 'is', value: [externalContentId] },
          dateCondition,
        ],
      },
      sort: [{ fieldName: 'metric_date', desc: true }],
      // Query นี้ต้องคืนเพียง Baseline ล่าสุด หรือ Latest เก่าหนึ่งแถวเท่านั้น.
      pageSize: 1,
      maxPages: 1,
      maxItems: 1,
      stopWhen: () => true,
    });
    dailyQueries += 1;
    rowsFetched += records.length;
    snapshotRowsFetched += records.length;
    assertWithinLimit(snapshotRowsFetched, input.limits.maxSnapshotRecords, {
      code: 'REPORT_SOURCE_SNAPSHOT_LIMIT_EXCEEDED',
      label: 'snapshot records',
    });
    for (const record of records) dailyByIdentity.set(snapshotIdentity(record), record);
  }

  return Object.freeze({
    contentRecords: Object.freeze([...contentRecords]),
    dailyRecords: Object.freeze([...dailyByIdentity.values()]),
    readSummary: Object.freeze({
      strategy: 'server_filtered_range',
      bounded: true,
      contentRecords: contentRecords.length,
      dailySnapshotRecords: dailyByIdentity.size,
      externalContentIds: externalContentIds.size,
      contentQueries: 1,
      dailyQueries,
      rowsFetched,
      fallbackRowsScanned: 0,
    }),
  });
}

async function loadBoundedPageFallback(input) {
  const contentScan = await scanTableBounded({
    repository: input.repository,
    tableId: input.tables.mktContent,
    pageSize: input.limits.pageSize,
    maxPages: input.limits.maxPagesPerQuery,
    maxRows: input.limits.maxFallbackScanRecords,
  });
  const dailyScan = await scanTableBounded({
    repository: input.repository,
    tableId: input.tables.mktContentDaily,
    pageSize: input.limits.pageSize,
    maxPages: input.limits.maxPagesPerQuery,
    maxRows: input.limits.maxFallbackScanRecords,
  });

  const contentRecords = contentScan.records.filter((record) => matchesAccountPlatform(record, input.accountId));
  const dailyRecords = dailyScan.records.filter((record) => matchesAccountPlatform(record, input.accountId));
  assertWithinLimit(contentRecords.length, input.limits.maxContentRecords, {
    code: 'REPORT_SOURCE_CONTENT_LIMIT_EXCEEDED',
    label: 'content records',
  });
  assertWithinLimit(dailyRecords.length, input.limits.maxSnapshotRecords, {
    code: 'REPORT_SOURCE_SNAPSHOT_LIMIT_EXCEEDED',
    label: 'snapshot records',
  });

  return Object.freeze({
    contentRecords: Object.freeze(contentRecords),
    dailyRecords: Object.freeze(dailyRecords),
    readSummary: Object.freeze({
      strategy: 'bounded_page_fallback',
      bounded: true,
      contentRecords: contentRecords.length,
      dailySnapshotRecords: dailyRecords.length,
      externalContentIds: new Set(dailyRecords.map(readExternalContentId)).size,
      contentQueries: 0,
      dailyQueries: 0,
      rowsFetched: contentScan.rowsScanned + dailyScan.rowsScanned,
      fallbackRowsScanned: contentScan.rowsScanned + dailyScan.rowsScanned,
    }),
  });
}

async function scanTableBounded(input) {
  const records = [];
  const seenTokens = new Set();
  let pageToken = null;

  for (let pageNumber = 1; pageNumber <= input.maxPages; pageNumber += 1) {
    const page = await input.repository.listPage(input.tableId, {
      pageToken,
      pageSize: input.pageSize,
    });
    const pageRecords = requireRecords(page?.records, 'repository.listPage records');
    records.push(...pageRecords);
    if (records.length > input.maxRows) {
      throw limitError('REPORT_SOURCE_FALLBACK_LIMIT_EXCEEDED', 'fallback scan records', {
        limit: input.maxRows,
        observed: records.length,
      });
    }

    if (page?.hasMore !== true) {
      return Object.freeze({ records: Object.freeze(records), rowsScanned: records.length });
    }
    const nextPageToken = optionalText(page?.nextPageToken);
    if (!nextPageToken || nextPageToken === pageToken || seenTokens.has(nextPageToken)) {
      throw permanentError('TikTok report bounded fallback returned an invalid page cursor', {
        code: 'REPORT_SOURCE_PAGINATION_INVALID',
        details: { pageNumber, rowsScanned: records.length },
      });
    }
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  throw permanentError('TikTok report bounded fallback exceeded its page limit', {
    code: 'REPORT_SOURCE_PAGINATION_LIMIT_EXCEEDED',
    details: { maxPages: input.maxPages, rowsScanned: records.length },
  });
}

function readLimits(input) {
  return Object.freeze({
    maxContentRecords: positiveInteger(
      input.maxContentRecords ?? DEFAULT_REPORT_MAX_CONTENT_RECORDS,
      'maxContentRecords',
    ),
    maxSnapshotRecords: positiveInteger(
      input.maxSnapshotRecords ?? DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS,
      'maxSnapshotRecords',
    ),
    maxFallbackScanRecords: positiveInteger(
      input.maxFallbackScanRecords ?? DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS,
      'maxFallbackScanRecords',
    ),
    maxPagesPerQuery: positiveInteger(
      input.maxPagesPerQuery ?? DEFAULT_REPORT_MAX_PAGES_PER_QUERY,
      'maxPagesPerQuery',
    ),
    pageSize: boundedPositiveInteger(
      input.pageSize ?? DEFAULT_REPORT_SOURCE_PAGE_SIZE,
      'pageSize',
      DEFAULT_REPORT_SOURCE_PAGE_SIZE,
    ),
  });
}

function accountPlatformFilter(accountId) {
  return Object.freeze({
    conjunction: 'and',
    conditions: Object.freeze([
      { fieldName: 'account_id', operator: 'is', value: [accountId] },
      { fieldName: 'platform', operator: 'is', value: [PLATFORM] },
    ]),
  });
}

function matchesAccountPlatform(record, accountId) {
  const fields = record?.fields ?? {};
  return readLarkText(fields.account_id, { label: 'account_id' }) === accountId
    && String(readLarkText(fields.platform, { label: 'platform' }) ?? '').toLowerCase() === PLATFORM;
}

function readExternalContentId(record) {
  const value = readLarkText(record?.fields?.external_content_id, {
    label: 'external_content_id',
    allowNull: false,
  });
  return requireText(value, 'externalContentId');
}

function readMetricDateEpoch(record) {
  return toEpochMilliseconds(record?.fields?.metric_date, { label: 'metric_date' });
}

function snapshotIdentity(record) {
  return optionalText(record?.recordId ?? record?.record_id)
    ?? optionalText(readLarkText(record?.fields?.content_daily_key, { label: 'content_daily_key' }))
    ?? `${readExternalContentId(record)}:${readMetricDateEpoch(record)}`;
}

function assertWithinLimit(observed, limit, input) {
  if (observed > limit) {
    throw limitError(input.code, input.label, { limit, observed });
  }
}

function limitError(code, label, details) {
  return permanentError(`TikTok report ${label} exceeded the configured bounded limit`, {
    code,
    details,
  });
}

function requireRepository(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('TikTok report source requires repository');
  }
  return value;
}

function requireTables(value) {
  return Object.freeze({
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
  });
}

function requirePeriod(value) {
  if (!value || typeof value !== 'object') throw new TypeError('TikTok report source requires period');
  return Object.freeze({
    periodStart: requireDateOnly(value.periodStart, { label: 'period.periodStart' }),
    periodEnd: requireDateOnly(value.periodEnd, { label: 'period.periodEnd' }),
    compareStart: value.compareStart ? requireDateOnly(value.compareStart, { label: 'period.compareStart' }) : null,
    compareEnd: value.compareEnd ? requireDateOnly(value.compareEnd, { label: 'period.compareEnd' }) : null,
  });
}

function requireRecords(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok report source requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok report source requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`TikTok report source ${fieldName} must be a positive integer`);
  }
  return number;
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = positiveInteger(value, fieldName);
  if (number > maximum) {
    throw new RangeError(`TikTok report source ${fieldName} must not exceed ${maximum}`);
  }
  return number;
}
