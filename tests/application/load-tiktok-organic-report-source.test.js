import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTikTokOrganicReportSource } from '../../packages/application/src/reports/load-tiktok-organic-report-source.js';

const TABLES = Object.freeze({ mktContent: 'content', mktContentDaily: 'daily' });
const period = Object.freeze({
  periodStart: '2026-07-08',
  periodEnd: '2026-07-14',
  compareStart: '2026-07-01',
  compareEnd: '2026-07-07',
});

function content(id) {
  return { recordId: `content-${id}`, fields: {
    account_id: 'ft_pumkin', platform: 'tiktok', external_content_id: String(id),
  } };
}

function daily(id, date, suffix = date) {
  return { recordId: `daily-${id}-${suffix}`, fields: {
    content_daily_key: `tiktok:ft_pumkin:${id}:${date}`,
    account_id: 'ft_pumkin', platform: 'tiktok', external_content_id: String(id),
    metric_date: Date.parse(`${date}T00:00:00+07:00`),
  } };
}

test('server-filtered report source keeps one baseline before the earliest period and stops older history', async () => {
  const calls = [];
  const byId = new Map([
    ['1', [daily(1, '2026-07-14'), daily(1, '2026-07-08'), daily(1, '2026-07-07'), daily(1, '2026-06-30'), daily(1, '2026-06-01')]],
    ['2', [daily(2, '2026-06-20')]],
    ['3', [daily(3, '2026-07-10'), daily(3, '2026-06-30')]],
  ]);
  const repository = {
    async searchRecords(tableId, options) {
      calls.push({ tableId, options });
      if (tableId === 'content') return [content(1), content(2)];
      const externalCondition = options.filter.conditions.find((condition) => condition.fieldName === 'external_content_id');
      if (!externalCondition) {
        return [
          daily(1, '2026-07-14'), daily(1, '2026-07-08'), daily(1, '2026-07-07'),
          daily(3, '2026-07-10'),
        ];
      }
      const rows = byId.get(String(externalCondition.value[0])) ?? [];
      const dateCondition = options.filter.conditions.find((condition) => condition.fieldName === 'metric_date');
      const boundary = Number(dateCondition.value[0]);
      const filtered = rows.filter((row) => {
        const value = Number(row.fields.metric_date);
        return dateCondition.operator === 'isLess' ? value < boundary : value <= boundary;
      });
      return filtered.slice(0, options.maxItems);
    },
  };

  const result = await loadTikTokOrganicReportSource({
    repository,
    tables: TABLES,
    accountId: 'ft_pumkin',
    period,
    utcOffset: '+07:00',
    maxContentRecords: 10,
    maxSnapshotRecords: 20,
    maxPagesPerQuery: 5,
  });

  assert.equal(result.readSummary.strategy, 'server_filtered_range');
  assert.equal(result.readSummary.contentQueries, 1);
  assert.equal(result.readSummary.dailyQueries, 4); // discovery + content IDs 1/2 + active orphan 3
  assert.deepEqual(
    result.dailyRecords.map((record) => record.recordId).sort(),
    [
      'daily-1-2026-06-30',
      'daily-1-2026-07-07',
      'daily-1-2026-07-08',
      'daily-1-2026-07-14',
      'daily-2-2026-06-20',
      'daily-3-2026-06-30',
      'daily-3-2026-07-10',
    ],
  );
  assert.equal(result.dailyRecords.some((record) => record.recordId === 'daily-1-2026-06-01'), false);
  const historyCalls = calls.filter((call) => call.options.pageSize === 1);
  assert.equal(historyCalls.length, 3);
  assert.ok(historyCalls.every((call) => (
    call.options.maxPages === 1
    && call.options.maxItems === 1
    && typeof call.options.stopWhen === 'function'
  )));
});

test('bounded page fallback fails closed on scan cap before returning source rows', async () => {
  let calls = 0;
  const repository = {
    async listPage(tableId) {
      calls += 1;
      return {
        records: tableId === 'content'
          ? [content(1), content(2)]
          : [daily(1, '2026-07-14'), daily(2, '2026-07-14')],
        hasMore: false,
        nextPageToken: null,
      };
    },
  };

  await assert.rejects(() => loadTikTokOrganicReportSource({
    repository,
    tables: TABLES,
    accountId: 'ft_pumkin',
    period,
    utcOffset: '+07:00',
    maxFallbackScanRecords: 1,
  }), (error) => error.code === 'REPORT_SOURCE_FALLBACK_LIMIT_EXCEEDED');
  assert.equal(calls, 1);
});

test('bounded page fallback rejects repeated cursors instead of looping', async () => {
  let calls = 0;
  const repository = {
    async listPage() {
      calls += 1;
      return { records: [], hasMore: true, nextPageToken: 'same' };
    },
  };

  await assert.rejects(() => loadTikTokOrganicReportSource({
    repository,
    tables: TABLES,
    accountId: 'ft_pumkin',
    period,
    utcOffset: '+07:00',
    maxPagesPerQuery: 5,
  }), (error) => error.code === 'REPORT_SOURCE_PAGINATION_INVALID');
  assert.equal(calls, 2);
});
