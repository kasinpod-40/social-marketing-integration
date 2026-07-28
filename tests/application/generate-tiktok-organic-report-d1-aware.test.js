import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { generateTikTokOrganicReportD1Aware } from '../../packages/application/src/use-cases/generate-tiktok-organic-report-d1-aware.js';
import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';
import { METRIC_DEFINITION_ROWS } from '../../packages/config/src/metric-definitions.seed.js';

const PROFILE = 'integration_workspace';
const ACCOUNT = 'chemistry_k';
const TABLES = Object.freeze({
  mktContent: 'content',
  mktContentDaily: 'daily',
  mktMetricDefinitions: 'metrics',
  mktReportSettings: 'settings',
  mktReportSnapshots: 'snapshots',
  mktReportMetricValues: 'metric_values',
  mktReportTopContent: 'top_content',
});

function dailyRecord(date, views) {
  return {
    recordId: `daily-${date}`,
    fields: {
      content_daily_key: `tiktok:${ACCOUNT}:1:${date}`,
      external_content_id: '1',
      account_id: ACCOUNT,
      platform: 'tiktok',
      metric_date: Date.parse(`${date}T00:00:00+07:00`),
      views,
      likes: views / 10,
      comments: 1,
      shares: 1,
      avg_watch_time_seconds: 2,
      total_watch_time_seconds: views * 2,
      completion_rate: 0.5,
    },
  };
}

function d1Snapshot(date, views) {
  return Object.freeze({
    recordId: `observation-${date}`,
    contentDailyKey: `observation-${date}`,
    externalContentId: '1',
    accountId: ACCOUNT,
    platform: 'tiktok',
    metricDate: date,
    views,
    likes: views / 10,
    comments: 1,
    shares: 1,
    uniqueViewers: null,
    avgWatchTimeSeconds: 2,
    totalWatchTimeSeconds: views * 2,
    completionRate: 0.5,
  });
}

function buildRepository() {
  const dailySetting = createReportSettingRowsForProfile(PROFILE)[0];
  const tables = new Map(Object.entries({
    content: [{
      recordId: 'content-1',
      fields: {
        content_key: `tiktok:${ACCOUNT}:1`,
        external_content_id: '1',
        account_id: ACCOUNT,
        platform: 'tiktok',
        caption: 'Lark metadata',
        content_url: 'https://www.tiktok.com/@chemistry_k/video/1',
        published_at: Date.parse('2026-01-01T00:00:00Z'),
      },
    }],
    daily: [
      dailyRecord('2026-07-09', 100),
      dailyRecord('2026-07-10', 120),
      dailyRecord('2026-07-11', 150),
    ],
    settings: [{ recordId: 'setting-1', fields: dailySetting }],
    metrics: METRIC_DEFINITION_ROWS
      .filter((row) => row.metric_key.startsWith('tiktok:') && row.formula_version === 'tiktok-organic-v1')
      .map((fields, index) => ({ recordId: `metric-${index}`, fields })),
    snapshots: [],
    metric_values: [],
    top_content: [],
  }));
  let nextId = 1;
  const writes = [];
  return {
    tables,
    writes,
    async prepareRows(_tableId, rows) { return rows; },
    async listByFieldValues(tableId, fieldName, values) {
      return (tables.get(tableId) ?? []).filter((record) => values.includes(record.fields[fieldName]));
    },
    async listPage(tableId, options = {}) {
      const rows = tables.get(tableId) ?? [];
      const pageSize = Number(options.pageSize ?? 500);
      const offset = options.pageToken ? Number(options.pageToken) : 0;
      const records = rows.slice(offset, offset + pageSize);
      const next = offset + records.length;
      return {
        records,
        hasMore: next < rows.length,
        nextPageToken: next < rows.length ? String(next) : null,
      };
    },
    async createMany(tableId, rows) {
      writes.push({ operation: 'create', tableId, rows: structuredClone(rows) });
      const target = tables.get(tableId);
      for (const fields of rows) target.push({ recordId: `${tableId}-${nextId++}`, fields: structuredClone(fields) });
      return { created: rows.length };
    },
    async updateMany(tableId, rows) {
      writes.push({ operation: 'update', tableId, rows: structuredClone(rows) });
      const target = tables.get(tableId);
      for (const row of rows) {
        const record = target.find((item) => item.recordId === row.recordId);
        record.fields = structuredClone(row.fields);
      }
      return { updated: rows.length };
    },
  };
}

function d1Source(currentViews = 150) {
  return {
    async load() {
      return Object.freeze({
        contents: Object.freeze([Object.freeze({
          recordId: 'd1-content-1',
          contentKey: `tiktok:${ACCOUNT}:1`,
          externalContentId: '1',
          accountId: ACCOUNT,
          platform: 'tiktok',
          caption: null,
          contentUrl: null,
          thumbnailUrl: null,
          publishedAt: Date.parse('2026-01-01T00:00:00Z'),
          publishedDate: '2026-01-01',
        })]),
        dailySnapshots: Object.freeze([
          d1Snapshot('2026-07-09', 100),
          d1Snapshot('2026-07-10', 120),
          d1Snapshot('2026-07-11', currentViews),
        ]),
        readSummary: Object.freeze({
          strategy: 'd1_observation_range',
          coverageStatus: 'complete',
          coverageRunId: 'coverage:tiktok:1',
          failedRows: 0,
          uncoveredContentCount: 0,
          sourceWatermark: 'watermark-1',
        }),
      });
    },
  };
}

function reportInput(repository, overrides = {}) {
  return {
    repository,
    syncEngine: new TableSyncEngine(),
    d1Source: d1Source(),
    materializationStore: {
      writes: [],
      async saveReportMaterialization(value) {
        this.writes.push(value);
        return { created: true, updated: false, skipped: false };
      },
    },
    storageConfig: {
      reportD1ReadEnabled: false,
      reportD1ShadowReadEnabled: false,
      reportPresetMaterializationEnabled: false,
    },
    customerKey: 'chemistry_k',
    customerProfile: PROFILE,
    accountId: ACCOUNT,
    reportType: 'daily_organic_report',
    reportSettingKey: `${PROFILE}:tiktok:daily`,
    periodEnd: '2026-07-11',
    now: () => Date.parse('2026-07-12T01:00:00Z'),
    d1MaxContentRecords: 2_000,
    shadowMaxContentRecords: 2_000,
    maxContentRecords: 800,
    maxSnapshotRecords: 50_000,
    maxFallbackScanRecords: 50_000,
    maxPagesPerQuery: 100,
    sourcePageSize: 500,
    tables: TABLES,
    ...overrides,
  };
}

test('D1 shadow parity leaves Lark primary output authoritative', async () => {
  const repository = buildRepository();
  const result = await generateTikTokOrganicReportD1Aware(reportInput(repository, {
    storageConfig: {
      reportD1ReadEnabled: false,
      reportD1ShadowReadEnabled: true,
      reportPresetMaterializationEnabled: false,
    },
  }));

  assert.equal(result.source, 'mkt_content_daily');
  assert.equal(result.reportParity.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.metricPayload['tiktok:period_views'].current, 30);
  assert.ok(repository.writes.length > 0);
});

test('shadow mismatch is diagnostic and does not replace Lark primary output', async () => {
  const repository = buildRepository();
  const result = await generateTikTokOrganicReportD1Aware(reportInput(repository, {
    d1Source: d1Source(151),
    storageConfig: {
      reportD1ReadEnabled: false,
      reportD1ShadowReadEnabled: true,
      reportPresetMaterializationEnabled: false,
    },
  }));

  assert.equal(result.source, 'mkt_content_daily');
  assert.equal(result.metricPayload['tiktok:period_views'].current, 30);
  assert.equal(result.reportParity.ok, false);
  assert.equal(result.warnings[0].code, 'REPORT_D1_SHADOW_PARITY_MISMATCH');
  assert.ok(repository.writes.length > 0);
});

test('D1 primary with shadow mismatch fails before any Report output write', async () => {
  const repository = buildRepository();
  await assert.rejects(() => generateTikTokOrganicReportD1Aware(reportInput(repository, {
    d1Source: d1Source(151),
    storageConfig: {
      reportD1ReadEnabled: true,
      reportD1ShadowReadEnabled: true,
      reportPresetMaterializationEnabled: false,
    },
  })), (error) => error.code === 'REPORT_D1_PARITY_MISMATCH');
  assert.equal(repository.writes.length, 0);
});

test('D1 primary hydrates bounded Lark metadata and materializes the deterministic result', async () => {
  const repository = buildRepository();
  const materializationStore = {
    writes: [],
    async saveReportMaterialization(value) {
      this.writes.push(value);
      return { created: true, updated: false, skipped: false };
    },
  };
  const result = await generateTikTokOrganicReportD1Aware(reportInput(repository, {
    materializationStore,
    storageConfig: {
      reportD1ReadEnabled: true,
      reportD1ShadowReadEnabled: false,
      reportPresetMaterializationEnabled: true,
    },
  }));

  assert.equal(result.source, 'd1_organic_observations');
  assert.equal(result.metricPayload['tiktok:period_views'].current, 30);
  assert.equal(result.d1SourceRead.sourceWatermark, 'watermark-1');
  assert.equal(result.materialization.created, true);
  assert.equal(materializationStore.writes.length, 1);
  assert.equal(materializationStore.writes[0].source_watermark, 'watermark-1');
  assert.match(materializationStore.writes[0].payload_json, /tiktok-organic-materialization-v1/u);
  const topRow = repository.tables.get('top_content')[0].fields;
  assert.equal(topRow.caption, 'Lark metadata');
});

test('D1 primary rejects incomplete per-entity Coverage before output writes', async () => {
  const repository = buildRepository();
  const incompleteSource = d1Source();
  incompleteSource.load = async () => {
    const result = await d1Source().load();
    return Object.freeze({
      ...result,
      readSummary: Object.freeze({ ...result.readSummary, uncoveredContentCount: 1 }),
    });
  };
  await assert.rejects(() => generateTikTokOrganicReportD1Aware(reportInput(repository, {
    d1Source: incompleteSource,
    storageConfig: {
      reportD1ReadEnabled: true,
      reportD1ShadowReadEnabled: false,
      reportPresetMaterializationEnabled: false,
    },
  })), (error) => error.code === 'REPORT_D1_COVERAGE_INCOMPLETE');
  assert.equal(repository.writes.length, 0);
});

test('D1 primary custom range reuses the organic calculator and writes custom materialization', async () => {
  const repository = buildRepository();
  const materializationStore = {
    writes: [],
    async saveReportMaterialization(value) {
      this.writes.push(value);
      return { status: 'written', changes: 1 };
    },
  };
  const result = await generateTikTokOrganicReportD1Aware(reportInput(repository, {
    materializationStore,
    periodKind: 'custom_range',
    periodStart: '2026-07-10',
    periodEnd: '2026-07-11',
    storageConfig: {
      reportD1ReadEnabled: true,
      reportD1ShadowReadEnabled: false,
      reportPresetMaterializationEnabled: true,
    },
  }));
  assert.equal(result.period.periodKind, 'custom_range');
  assert.equal(result.period.windowDays, 2);
  assert.equal(result.metricPayload['tiktok:period_views'].current, 50);
  assert.equal(materializationStore.writes[0].period_kind, 'custom_range');
  assert.equal(materializationStore.writes[0].window_days, null);
});
