import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE,
  assertReportRuntimeOrganicIntegrity,
  assertReportRuntimeWindowChanged,
  assertReportRuntimeWindowRepairConfirmation,
  assertReportRuntimeWindowTargetPrestate,
  parseReportRuntimeWindowRepairArgs,
  selectReportRuntimeWindowTarget,
} from '../../scripts/lib/report-runtime-window-repair.js';

function candidates() {
  return [1, 3, 7, 9, 15, 30, 90].map((windowDays) => ({
    windowDays,
    reportId: `report-${windowDays}`,
    reportSettingKey: `setting-${windowDays}`,
    period: { periodStart: '2026-07-01', periodEnd: '2026-07-30' },
    job: { type: 'report.materialization.generate', windowDays },
  }));
}

test('Report window repair is plan-only by default and requires exact confirmation', () => {
  assert.deepEqual(parseReportRuntimeWindowRepairArgs([]), { execute: false });
  assert.deepEqual(parseReportRuntimeWindowRepairArgs(['--execute']), { execute: true });
  assert.throws(() => parseReportRuntimeWindowRepairArgs(['--force']));
  assert.throws(() => assertReportRuntimeWindowRepairConfirmation({}));
  assert.equal(assertReportRuntimeWindowRepairConfirmation({
    CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR: REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  }), true);
});

test('Report window repair sequence refreshes 3D/7D and creates 1D/30D', () => {
  assert.deepEqual(REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE, [
    { windowDays: 3, operation: 'refresh' },
    { windowDays: 7, operation: 'refresh' },
    { windowDays: 1, operation: 'fresh' },
    { windowDays: 30, operation: 'fresh' },
  ]);
});

test('Report window target selection is explicit and fail-closed', () => {
  const source = candidates();
  assert.deepEqual(selectReportRuntimeWindowTarget(source, ['report-1'], {}), {
    ...source[1], operation: 'fresh',
  });
  assert.deepEqual(selectReportRuntimeWindowTarget(source, ['report-3', 'report-7'], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '3',
    MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
  }), { ...source[1], operation: 'refresh' });
  assert.deepEqual(selectReportRuntimeWindowTarget(source, ['report-3', 'report-7'], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '1',
    MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'fresh',
  }), { ...source[0], operation: 'fresh' });
  assert.throws(() => selectReportRuntimeWindowTarget(source, [], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '7',
    MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
  }), (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_TARGET_MISSING');
  assert.throws(() => selectReportRuntimeWindowTarget(source, ['report-30'], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '30',
    MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
  }), (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_WINDOW_NOT_APPROVED');
  assert.throws(() => selectReportRuntimeWindowTarget(source, ['report-1'], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '1',
    MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'fresh',
  }), (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_FRESH_TARGET_EXISTS');
});

test('Report window target prestates distinguish fresh create from stable-ID refresh', () => {
  assert.equal(assertReportRuntimeWindowTargetPrestate({
    operation: 'fresh', reportId: 'report-1',
    d1: { materialization_count: 0 },
    lark: { snapshots: 0, metrics: 0, topContent: 0 },
  }), true);
  assert.equal(assertReportRuntimeWindowTargetPrestate({
    operation: 'refresh', reportId: 'report-3',
    d1: { report_id: 'report-3', materialization_count: 1, payload_checksum: 'before' },
    lark: { snapshots: 1, metrics: 10, topContent: 5 },
  }), true);
  assert.throws(() => assertReportRuntimeWindowTargetPrestate({
    operation: 'refresh', reportId: 'report-3',
    d1: { report_id: 'report-3', materialization_count: 2, payload_checksum: 'before' },
    lark: { snapshots: 1, metrics: 10, topContent: 5 },
  }));
});

test('Report window transition requires refresh payload replacement under one stable row', () => {
  assert.equal(assertReportRuntimeWindowChanged({
    operation: 'fresh',
    before: { materialization_count: 0 },
    after: { materialization_count: 1, payload_checksum: 'new' },
  }), true);
  assert.equal(assertReportRuntimeWindowChanged({
    operation: 'refresh',
    before: { materialization_count: 1, payload_checksum: 'old' },
    after: { materialization_count: 1, payload_checksum: 'new' },
  }), true);
  assert.throws(() => assertReportRuntimeWindowChanged({
    operation: 'refresh',
    before: { materialization_count: 1, payload_checksum: 'same' },
    after: { materialization_count: 1, payload_checksum: 'same' },
  }));
});

test('Incomplete Organic baseline requires null aggregate KPIs in D1 and Lark', () => {
  const metricPayload = Object.fromEntries([
    'period_views', 'period_likes', 'period_comments', 'period_shares',
    'period_engagement', 'period_engagement_rate',
  ].map((name) => [`tiktok:${name}`, { current: null }]));
  const result = assertReportRuntimeOrganicIntegrity({
    payload: { coverageRate: 0.999, metricPayload },
    larkMetrics: Object.fromEntries(Object.keys(metricPayload).map((key) => [key, null])),
  });
  assert.equal(result.incompleteBaseline, true);
  assert.equal(result.aggregateNullCount, 6);
  assert.throws(() => assertReportRuntimeOrganicIntegrity({
    payload: {
      coverageRate: 0.999,
      metricPayload: { ...metricPayload, 'tiktok:period_views': { current: 123 } },
    },
    larkMetrics: { ...Object.fromEntries(Object.keys(metricPayload).map((key) => [key, null])), 'tiktok:period_views': 123 },
  }), (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_PARTIAL_AGGREGATE_NUMERIC');
});

test('One-command wrapper secures local secrets before gates and keeps unsafe features disabled', () => {
  const source = readFileSync(
    new URL('../../scripts/report-runtime-window-repair.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE/u);
  assert.match(source, /MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION/u);
  assert.match(source, /MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS/u);
  assert.match(source, /CONFIRM_REPORT_RUNTIME_FINALIZE/u);
  assert.match(source, /CONFIRM_REPORT_RUNTIME_CLOSEOUT/u);
  assert.match(source, /await ensureDevVarsPermissions\(\);[\s\S]*runRequiredStep\('report-runtime-finalizer'/u);
  assert.match(source, /before\.isSymbolicLink\(\)/u);
  assert.match(source, /chmod\(devVarsPath, 0o600\)/u);
  assert.match(source, /\(after\.mode & 0o077\) !== 0/u);
  assert.doesNotMatch(source, /MKT_SCHEDULE_DAILY_REPORT_ENABLED\s*:\s*['"]true['"]/u);
  assert.doesNotMatch(source, /MKT_REPORT_AI_SUMMARY_ENABLED\s*:\s*['"]true['"]/u);
});
