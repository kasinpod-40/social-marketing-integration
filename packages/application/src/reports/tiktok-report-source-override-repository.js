import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';

/**
 * Override only MKT_Content/MKT_Content_Daily reads while forwarding configuration,
 * output planning and writes to the original Lark repository.
 */
export function createTikTokReportSourceOverrideRepository(input = {}) {
  const repository = requireRepository(input.repository);
  const tables = requireTables(input.tables);
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
  const contentRecords = input.contents.map((row) => Object.freeze({
    recordId: row.recordId ?? row.contentKey,
    fields: Object.freeze({
      content_key: row.contentKey,
      platform: 'tiktok',
      account_id: row.accountId,
      external_content_id: row.externalContentId,
      caption: row.caption ?? null,
      content_url: row.contentUrl ?? null,
      thumbnail_url: row.thumbnailUrl ?? null,
      published_at: row.publishedAt ?? null,
    }),
  }));
  const dailyRecords = input.dailySnapshots.map((row) => Object.freeze({
    recordId: row.recordId ?? row.contentDailyKey,
    fields: Object.freeze({
      content_daily_key: row.contentDailyKey,
      platform: 'tiktok',
      account_id: row.accountId,
      external_content_id: row.externalContentId,
      metric_date: dateOnlyInTimeZoneToEpochMilliseconds(row.metricDate, timeZone, {
        label: 'D1 report metricDate',
      }),
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      unique_viewers: row.uniqueViewers,
      avg_watch_time_seconds: row.avgWatchTimeSeconds,
      total_watch_time_seconds: row.totalWatchTimeSeconds,
      completion_rate: row.completionRate,
    }),
  }));

  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'searchRecords') {
        return async (tableId, options = {}) => {
          if (tableId === tables.mktContent) {
            return applyQuery(contentRecords, options);
          }
          if (tableId === tables.mktContentDaily) {
            return applyQuery(dailyRecords, options);
          }
          return target.searchRecords(tableId, options);
        };
      }
      if (property === 'listPage') {
        return async (tableId, options = {}) => {
          if (tableId !== tables.mktContent && tableId !== tables.mktContentDaily) {
            return target.listPage(tableId, options);
          }
          const rows = tableId === tables.mktContent ? contentRecords : dailyRecords;
          const offset = options.pageToken ? Number(options.pageToken) : 0;
          const pageSize = Number(options.pageSize ?? 500);
          const records = rows.slice(offset, offset + pageSize);
          const next = offset + records.length;
          return Object.freeze({
            records,
            hasMore: next < rows.length,
            nextPageToken: next < rows.length ? String(next) : null,
          });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function applyQuery(records, options) {
  let rows = records.filter((record) => matchesFilter(record, options.filter));
  for (const sort of [...(options.sort ?? [])].reverse()) {
    rows = [...rows].sort((left, right) => compareField(left, right, sort));
  }
  const maxItems = Number(options.maxItems ?? rows.length);
  return Object.freeze(rows.slice(0, maxItems));
}

function matchesFilter(record, filter) {
  if (!filter || !Array.isArray(filter.conditions)) return true;
  const results = filter.conditions.map((condition) => matchesCondition(record.fields, condition));
  return filter.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function matchesCondition(fields, condition) {
  const value = fields[condition.fieldName];
  const expected = Array.isArray(condition.value) ? condition.value[0] : condition.value;
  switch (condition.operator) {
    case 'is': return String(value ?? '') === String(expected ?? '');
    case 'isGreaterEqual': return Number(value) >= Number(expected);
    case 'isLessEqual': return Number(value) <= Number(expected);
    case 'isLess': return Number(value) < Number(expected);
    default: throw new TypeError(`Unsupported D1 report override filter: ${condition.operator}`);
  }
}

function compareField(left, right, sort) {
  const a = left.fields[sort.fieldName];
  const b = right.fields[sort.fieldName];
  const compared = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a ?? '').localeCompare(String(b ?? ''));
  return sort.desc === true ? -compared : compared;
}

function requireRepository(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('TikTok report override requires repository');
  }
  return value;
}

function requireTables(value) {
  return Object.freeze({
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok report override requires ${fieldName}`);
  }
  return value.trim();
}
