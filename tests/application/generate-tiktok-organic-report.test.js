import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { generateTikTokOrganicReport } from '../../packages/application/src/use-cases/generate-tiktok-organic-report.js';
import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';
import { METRIC_DEFINITION_ROWS } from '../../packages/config/src/metric-definitions.seed.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const TABLES = Object.freeze({
  mktContent: 'content',
  mktContentDaily: 'daily',
  mktMetricDefinitions: 'metrics',
  mktReportSettings: 'settings',
  mktReportSnapshots: 'snapshots',
  mktReportMetricValues: 'metric_values',
  mktReportTopContent: 'top_content',
});

function buildRepository() {
  // Legacy fixture stays scoped to ft_pumkin so compatibility behavior remains tested.
  // Live Integration Workspace seeds only chemistry_k and cannot mix these records into customer reports.
  const dailySetting = {
    ...createReportSettingRowsForProfile('integration_workspace')[0],
    account_keys_json: '["ft_pumkin"]',
  };
  const tables = new Map(Object.entries({
    content: [{ recordId: 'content-1', fields: {
      content_key: 'tiktok:ft_pumkin:1', external_content_id: '1', account_id: 'ft_pumkin',
      platform: 'tiktok', caption: 'clip 1', content_url: 'https://tiktok.com/v/1',
      published_at: Date.parse('2026-07-01T01:00:00Z'),
    } }],
    daily: [
      { recordId: 'daily-base', fields: {
        content_daily_key: 'tiktok:ft_pumkin:1:2026-07-10', external_content_id: '1',
        account_id: 'ft_pumkin', platform: 'tiktok', metric_date: Date.parse('2026-07-09T17:00:00Z'),
        views: 100, likes: 10, comments: 2, shares: 1, avg_watch_time_seconds: 2,
        completion_rate: 0.2,
      } },
      { recordId: 'daily-current', fields: {
        content_daily_key: 'tiktok:ft_pumkin:1:2026-07-11', external_content_id: '1',
        account_id: 'ft_pumkin', platform: 'tiktok', metric_date: Date.parse('2026-07-10T17:00:00Z'),
        views: 150, likes: 15, comments: 4, shares: 2, avg_watch_time_seconds: 3,
        completion_rate: 0.3,
      } },
    ],
    settings: [{ recordId: 'setting-1', fields: dailySetting }],
    metrics: METRIC_DEFINITION_ROWS
      .filter((row) => row.metric_key.startsWith('tiktok:') && row.formula_version === 'tiktok-organic-v1')
      .map((fields, index) => ({ recordId: `metric-${index}`, fields })),
    snapshots: [], metric_values: [], top_content: [],
  }));
  let nextId = 1;

  return {
    tables,
    async prepareRows(_tableId, rows) { return rows; },
    async listByFieldValues(tableId, fieldName, values) {
      return (tables.get(tableId) ?? []).filter((record) => values.includes(record.fields[fieldName]));
    },
    async listPage(tableId, options = {}) {
      const rows = tables.get(tableId) ?? [];
      const pageSize = Number(options.pageSize ?? 500);
      const offset = options.pageToken ? Number(options.pageToken) : 0;
      const records = rows.slice(offset, offset + pageSize);
      const nextOffset = offset + records.length;
      return {
        records,
        hasMore: nextOffset < rows.length,
        nextPageToken: nextOffset < rows.length ? String(nextOffset) : null,
      };
    },
    async createMany(tableId, rows) {
      const target = tables.get(tableId);
      for (const fields of rows) target.push({ recordId: `${tableId}-${nextId++}`, fields: structuredClone(fields) });
      return { created: rows.length };
    },
    async updateMany(tableId, rows) {
      const target = tables.get(tableId);
      for (const row of rows) {
        const record = target.find((item) => item.recordId === row.recordId);
        record.fields = structuredClone(row.fields);
      }
      return { updated: rows.length };
    },
  };
}



function addReportableContent(repository, total = 5) {
  for (let id = 2; id <= total; id += 1) {
    repository.tables.get('content').push({ recordId: `content-${id}`, fields: {
      content_key: `tiktok:ft_pumkin:${id}`,
      external_content_id: String(id),
      account_id: 'ft_pumkin',
      platform: 'tiktok',
      caption: `clip ${id}`,
      content_url: `https://tiktok.com/v/${id}`,
      published_at: Date.parse('2026-07-01T01:00:00Z'),
    } });
    repository.tables.get('daily').push(
      { recordId: `daily-${id}-base`, fields: {
        content_daily_key: `tiktok:ft_pumkin:${id}:2026-07-10`,
        external_content_id: String(id), account_id: 'ft_pumkin', platform: 'tiktok',
        metric_date: Date.parse('2026-07-09T17:00:00Z'),
        views: 100 * id, likes: 10 * id, comments: id, shares: id,
        avg_watch_time_seconds: 2, completion_rate: 0.2,
      } },
      { recordId: `daily-${id}-current`, fields: {
        content_daily_key: `tiktok:ft_pumkin:${id}:2026-07-11`,
        external_content_id: String(id), account_id: 'ft_pumkin', platform: 'tiktok',
        metric_date: Date.parse('2026-07-10T17:00:00Z'),
        views: 100 * id + 10 * id, likes: 10 * id + id, comments: id + 1, shares: id + 1,
        avg_watch_time_seconds: 3, completion_rate: 0.3,
      } },
    );
  }
}

test('generates idempotent daily TikTok report rows across all report tables', async () => {
  const repository = buildRepository();
  const first = await generateTikTokOrganicReport({
    repository,
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace',
    accountId: 'ft_pumkin',
    reportType: 'daily_organic_report',
    reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11',
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    tables: TABLES,
  });

  assert.equal(first.dataStatus, 'complete');
  assert.equal(first.metricCount, 13);
  assert.equal(first.topContentCount, 1);
  assert.deepEqual(
    [first.reportSnapshot.created, first.reportMetricValues.created, first.reportTopContent.created],
    [1, 13, 5],
  );
  assert.equal(first.metricPayload['tiktok:period_views'].current, 50);

  const second = await generateTikTokOrganicReport({
    repository,
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace',
    accountId: 'ft_pumkin',
    reportType: 'daily_organic_report',
    reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11',
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    tables: TABLES,
  });

  assert.deepEqual(
    [second.reportSnapshot.skipped, second.reportMetricValues.skipped, second.reportTopContent.skipped],
    [1, 13, 5],
  );
  assert.equal(repository.tables.get('snapshots').length, 1);
  assert.equal(repository.tables.get('metric_values').length, 13);
  assert.equal(repository.tables.get('top_content').length, 5);
});

test('plans every output table before the first write', async () => {
  const repository = buildRepository();
  let planCalls = 0;
  let executeCalls = 0;
  const syncEngine = {
    async planByKey(input) {
      planCalls += 1;
      if (planCalls === 3) throw new Error(`Schema invalid for ${input.tableId}`);
      return { createRows: input.rows, updateRows: [], skipped: 0, duplicateInputRows: 0 };
    },
    async executePlan() { executeCalls += 1; },
  };

  await assert.rejects(() => generateTikTokOrganicReport({
    repository, syncEngine,
    customerProfile: 'integration_workspace', accountId: 'ft_pumkin',
    reportType: 'daily_organic_report', reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11', now: () => Date.parse('2026-07-12T01:00:00Z'), tables: TABLES,
  }), /Schema invalid/);

  assert.equal(planCalls, 3);
  assert.equal(executeCalls, 0);
});


test('keeps a first-table permanent rejection as failed instead of partial_success', async () => {
  const repository = buildRepository();
  let executeCalls = 0;
  const syncEngine = {
    async planByKey(input) {
      return Object.freeze({
        createRows: input.rows,
        updateRows: [],
        skipped: 0,
        duplicateInputRows: 0,
      });
    },
    async executePlan() {
      executeCalls += 1;
      throw permanentError('report snapshot rejected before write', {
        code: 'LARK_PERMANENT_API_ERROR',
      });
    },
  };

  await assert.rejects(() => generateTikTokOrganicReport({
    repository, syncEngine,
    customerProfile: 'integration_workspace', accountId: 'ft_pumkin',
    reportType: 'daily_organic_report', reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11', now: () => Date.parse('2026-07-12T01:00:00Z'), tables: TABLES,
  }), (error) => error.code === 'LARK_PERMANENT_API_ERROR'
    && error.code !== 'SYNC_PARTIAL_WRITE');

  assert.equal(executeCalls, 1);
});

test('wraps a later table failure as partial only after a prior table wrote rows', async () => {
  const repository = buildRepository();
  let executeCalls = 0;
  const syncEngine = {
    async planByKey(input) {
      return Object.freeze({
        createRows: input.rows,
        updateRows: [],
        skipped: 0,
        duplicateInputRows: 0,
      });
    },
    async executePlan(plan) {
      executeCalls += 1;
      if (executeCalls === 1) {
        return Object.freeze({
          created: plan.createRows.length,
          updated: 0,
          skipped: 0,
          duplicateInputRows: 0,
          writeOutcome: 'confirmed',
        });
      }
      throw permanentError('metric table rejected', { code: 'LARK_PERMANENT_API_ERROR' });
    },
  };

  await assert.rejects(() => generateTikTokOrganicReport({
    repository, syncEngine,
    customerProfile: 'integration_workspace', accountId: 'ft_pumkin',
    reportType: 'daily_organic_report', reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11', now: () => Date.parse('2026-07-12T01:00:00Z'), tables: TABLES,
  }), (error) => error.code === 'SYNC_PARTIAL_WRITE'
    && error.details.failedPhase === 'reportMetricValues'
    && error.partialResult.reportSnapshot.created === 1
    && error.partialResult.reportMetricValues.writeOutcome === 'not_started');
});

test('uses one bounded top-content limit for snapshot JSON and normalized rows', async () => {
  const repository = buildRepository();
  addReportableContent(repository, 5);
  const result = await generateTikTokOrganicReport({
    repository,
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace',
    accountId: 'ft_pumkin',
    reportType: 'daily_organic_report',
    reportSettingKey: 'integration_workspace:tiktok:daily',
    topContentLimit: 3,
    periodEnd: '2026-07-11',
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    tables: TABLES,
  });

  const snapshot = repository.tables.get('snapshots')[0].fields;
  assert.equal(JSON.parse(snapshot.top_content_json).length, 3);
  assert.equal(result.topContentLimit, 3);
  assert.equal(result.topContentSlotCount, 3);
  assert.equal(repository.tables.get('top_content').length, 3);

  await assert.rejects(() => generateTikTokOrganicReport({
    repository,
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace',
    accountId: 'ft_pumkin',
    reportType: 'daily_organic_report',
    reportSettingKey: 'integration_workspace:tiktok:daily',
    topContentLimit: 101,
    periodEnd: '2026-07-11',
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    tables: TABLES,
  }), (error) => error.code === 'INVALID_SYNC_JOB');
});

test('neutralizes stale ranks when top-content limit is reduced', async () => {
  const repository = buildRepository();
  addReportableContent(repository, 5);
  await generateTikTokOrganicReport({
    repository,
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace', accountId: 'ft_pumkin',
    reportType: 'daily_organic_report', reportSettingKey: 'integration_workspace:tiktok:daily',
    topContentLimit: 5,
    periodEnd: '2026-07-11', now: () => Date.parse('2026-07-12T01:00:00Z'), tables: TABLES,
  });

  const second = await generateTikTokOrganicReport({
    repository,
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace', accountId: 'ft_pumkin',
    reportType: 'daily_organic_report', reportSettingKey: 'integration_workspace:tiktok:daily',
    topContentLimit: 3,
    periodEnd: '2026-07-11', now: () => Date.parse('2026-07-12T02:00:00Z'), tables: TABLES,
  });

  const rows = repository.tables.get('top_content')
    .map((record) => record.fields)
    .sort((left, right) => left.rank - right.rank);
  assert.equal(second.topContentLimit, 3);
  assert.equal(second.topContentSlotCount, 5);
  assert.equal(rows.length, 5);
  assert.equal(rows[3].data_status, 'no_data');
  assert.equal(rows[4].data_status, 'no_data');
  assert.equal(JSON.parse(repository.tables.get('snapshots')[0].fields.top_content_json).length, 3);
});

function enableServerFilteredSearch(repository) {
  repository.searchRecords = async (tableId, options = {}) => {
    let rows = [...(repository.tables.get(tableId) ?? [])];
    const conditions = options.filter?.conditions ?? [];
    rows = rows.filter((record) => conditions.every((condition) => {
      const actual = record.fields[condition.fieldName];
      const expected = condition.value?.[0];
      if (condition.operator === 'is') return String(actual) === String(expected);
      if (condition.operator === 'isGreaterEqual') return Number(actual) >= Number(expected);
      if (condition.operator === 'isLess') return Number(actual) < Number(expected);
      if (condition.operator === 'isLessEqual') return Number(actual) <= Number(expected);
      throw new Error(`Unsupported fake filter operator: ${condition.operator}`);
    }));
    for (const sort of [...(options.sort ?? [])].reverse()) {
      rows.sort((left, right) => {
        const a = left.fields[sort.fieldName];
        const b = right.fields[sort.fieldName];
        const compared = typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b));
        return sort.desc ? -compared : compared;
      });
    }
    const selected = [];
    for (const row of rows.slice(0, options.pageSize ?? rows.length)) {
      selected.push(row);
      if (options.stopWhen?.({ item: row }) === true) break;
    }
    if (options.maxItems && selected.length > options.maxItems) {
      throw permanentError('bounded fake search exceeded maxItems', {
        code: 'LARK_BOUNDED_READ_LIMIT_EXCEEDED',
      });
    }
    return selected;
  };
  return repository;
}

function addHistoricalBaseline(repository, date = '2026-07-09') {
  repository.tables.get('daily').push({ recordId: `daily-old-${date}`, fields: {
    content_daily_key: `tiktok:ft_pumkin:1:${date}`,
    external_content_id: '1', account_id: 'ft_pumkin', platform: 'tiktok',
    metric_date: Date.parse(`${date}T00:00:00+07:00`),
    views: 80, likes: 8, comments: 1, shares: 1, avg_watch_time_seconds: 1.5,
    completion_rate: 0.15,
  } });
}

test('server-filtered source produces the same report metrics as bounded full-page compatibility reads', async () => {
  const fallbackRepository = buildRepository();
  const filteredRepository = enableServerFilteredSearch(buildRepository());
  addHistoricalBaseline(fallbackRepository);
  addHistoricalBaseline(filteredRepository);
  addHistoricalBaseline(fallbackRepository, '2026-06-01');
  addHistoricalBaseline(filteredRepository, '2026-06-01');

  const common = {
    syncEngine: new TableSyncEngine(),
    customerProfile: 'integration_workspace',
    accountId: 'ft_pumkin',
    reportType: 'daily_organic_report',
    reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11',
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    tables: TABLES,
  };
  const fallback = await generateTikTokOrganicReport({ ...common, repository: fallbackRepository });
  const filtered = await generateTikTokOrganicReport({ ...common, repository: filteredRepository });

  assert.deepEqual(filtered.metricPayload, fallback.metricPayload);
  assert.equal(filtered.dataStatus, fallback.dataStatus);
  assert.equal(filtered.baselineCoverageRate, fallback.baselineCoverageRate);
  assert.equal(filtered.sourceSnapshotCount, fallback.sourceSnapshotCount);
  assert.equal(filtered.sourceRead.strategy, 'server_filtered_range');
  assert.equal(fallback.sourceRead.strategy, 'bounded_page_fallback');
  assert.ok(filtered.sourceDailySnapshotRecords < fallbackRepository.tables.get('daily').length);
});

test('bounded fallback cap fails before any report output plan or write', async () => {
  const repository = buildRepository();
  let planCalls = 0;
  let executeCalls = 0;
  const syncEngine = {
    async planByKey() { planCalls += 1; return {}; },
    async executePlan() { executeCalls += 1; return {}; },
  };

  await assert.rejects(() => generateTikTokOrganicReport({
    repository,
    syncEngine,
    customerProfile: 'integration_workspace',
    accountId: 'ft_pumkin',
    reportType: 'daily_organic_report',
    reportSettingKey: 'integration_workspace:tiktok:daily',
    periodEnd: '2026-07-11',
    maxFallbackScanRecords: 1,
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    tables: TABLES,
  }), (error) => error.code === 'REPORT_SOURCE_FALLBACK_LIMIT_EXCEEDED');

  assert.equal(planCalls, 0);
  assert.equal(executeCalls, 0);
});
