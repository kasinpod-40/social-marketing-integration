import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAdsPeriodMetrics } from '../../packages/application/src/reports/calculate-ads-period-metrics.js';
import {
  admitDashboardReportRequest,
  buildDashboardPresetJob,
} from '../../packages/application/src/reports/dashboard-report-request.js';
import { saveDashboardReportMaterialization } from '../../packages/application/src/reports/report-materialization.js';

test('Ads metrics aggregate daily facts before calculating ratios and preserve zero/null', () => {
  const result = calculateAdsPeriodMetrics({
    coverageStatus: 'complete',
    coverageRate: 1,
    rows: [
      { spend_micros: 100, impressions: 100, reach: null, clicks: 10, conversions: 1, conversion_value_micros: 300, video_views: 20, data_status: 'complete' },
      { spend_micros: 0, impressions: 0, reach: null, clicks: 0, conversions: 0, conversion_value_micros: 0, video_views: 0, data_status: 'complete' },
    ],
  });
  assert.equal(result.spend_micros, 100);
  assert.equal(result.reach, null);
  assert.equal(result.ctr, 0.1);
  assert.equal(result.roas, 3);
  assert.equal(result.data_status, 'complete');
});

test('same custom request and watermark claims and enqueues only one deterministic job', async () => {
  const rows = new Map();
  const sent = [];
  const store = {
    async claim(input) {
      const existing = rows.get(input.requestId);
      if (existing) return { created: false, request: existing };
      const request = Object.freeze({ ...input, status: 'pending' });
      rows.set(input.requestId, request);
      return { created: true, request };
    },
  };
  const input = {
    store,
    queue: { async send(body) { sent.push(body); } },
    customerKey: 'customer',
    accountKey: 'account',
    platformScope: 'tiktok',
    reportSettingKey: 'setting',
    formulaVersion: 'formula-v1',
    sourceWatermark: 'watermark-1',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-09',
    timeZone: 'Asia/Bangkok',
    requestedAt: Date.parse('2026-07-11T00:00:00Z'),
  };
  const first = await admitDashboardReportRequest(input);
  const second = await admitDashboardReportRequest(input);
  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].periodKind, 'custom_range');
  assert.equal(sent[0].type, 'report.materialization.generate');
});

test('every rolling preset uses the same materialization job type and period contract', () => {
  const jobs = [3, 7, 9, 15, 30, 90].map((windowDays) => buildDashboardPresetJob({
    windowDays,
    periodEnd: '2026-07-26',
    timeZone: 'Asia/Bangkok',
    requestedAt: Date.parse('2026-07-28T00:00:00Z'),
    reportSettingKey: 'setting',
    platformScope: 'tiktok',
    sourceWatermark: 'watermark',
  }));
  assert.deepEqual(new Set(jobs.map((job) => job.type)), new Set(['report.materialization.generate']));
  assert.deepEqual(jobs.map((job) => job.windowDays), [3, 7, 9, 15, 30, 90]);
  assert.equal(jobs.every((job) => job.trigger === 'dashboard_preset'), true);
});

test('materialization stable key ignores watermark while checksum/no-op dimensions remain deterministic', async () => {
  const writes = [];
  const base = {
    store: { async saveReportMaterialization(row) { writes.push(row); return { status: 'written' }; } },
    result: {
      platform: 'tiktok',
      reportId: 'lark-report',
      reportSettingKey: 'setting',
      reportType: 'daily_organic_report',
      period: {
        periodKind: 'custom_range',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-09',
        comparisonMode: 'previous_period',
        compareStart: '2026-06-22',
        compareEnd: '2026-06-30',
      },
      dataStatus: 'partial',
      metricPayload: { views: { current: 0, compare: null } },
    },
    customerKey: 'customer',
    accountKey: 'account',
    platformScope: 'tiktok',
    formulaVersion: 'formula-v1',
    schemaVersion: 'dashboard-materialization-v1',
    generatedAt: 1,
  };
  const first = await saveDashboardReportMaterialization({ ...base, sourceWatermark: 'a' });
  const second = await saveDashboardReportMaterialization({ ...base, sourceWatermark: 'b', generatedAt: 2 });
  assert.equal(first.reportId, second.reportId);
  assert.equal(writes[0].window_days, null);
  assert.equal(writes[0].payload_json.includes('\"current\":0'), true);
  assert.equal(writes[0].payload_json.includes('\"compare\":null'), true);
});
