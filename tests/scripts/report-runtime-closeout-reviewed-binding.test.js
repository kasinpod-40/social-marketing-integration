import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportRuntimeCloseoutCandidates,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  assertYouTubeReportRuntimeCloseoutPreflight,
  buildReportRuntimeMultiwindowExecutionPlan,
  resolveReviewedReportRuntimeCloseoutTarget,
} from '../../scripts/lib/report-runtime-closeout-channel-binding.js';
import { buildReportRuntimeOrganicPreflightSql } from '../../scripts/lib/report-runtime-closeout-reviewed-binding.js';

const REQUESTED_AT = Date.parse('2026-08-03T05:00:00Z');

test('shared selector and Organic preflight bind exact YouTube contract', () => {
  const target = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'youtube',
  });
  assert.equal(target.platformScope, 'youtube');
  assert.equal(target.capability, 'organic');
  assert.equal(target.reviewedHandoffRequired, true);
  assert.equal(target.multiwindowRequired, true);
  const sql = buildReportRuntimeOrganicPreflightSql({ target: { ...target, customerKey: 'chemistry_k' } });
  assert.match(sql, /platform = 'youtube'/u);
  assert.match(sql, /dataset_key = 'organic_content_cumulative'/u);
  assert.equal(assertYouTubeReportRuntimeCloseoutPreflight({
    coverage_status: 'complete', source_watermark: 'youtube-watermark', period_end: '2026-08-01',
    content_state_count: 837, observation_count: 837, active_report_locks: 0, open_report_dlq: 0,
  }), true);
});

test('multiwindow planner filters shared presets to exact reviewed 1/3/7/30 order', () => {
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: REQUESTED_AT, periodEnd: '2026-08-01', sourceWatermark: 'youtube-watermark',
    platformScope: 'youtube', accountKey: 'chemistry_k', formulaVersion: 'youtube-organic-v1',
  });
  const required = candidates.filter((row) => [1, 3, 7, 30].includes(row.windowDays));
  const existing = required.filter((row) => [3, 7].includes(row.windowDays)).map((row) => row.reportId);
  const plan = buildReportRuntimeMultiwindowExecutionPlan(candidates, existing, [
    { windowDays: 1, action: 'create_materialization' },
    { windowDays: 3, action: 'refresh_or_repair_materialization' },
    { windowDays: 7, action: 'reuse_or_idempotent_verify' },
    { windowDays: 30, action: 'create_materialization' },
  ]);
  assert.deepEqual(plan.map((row) => row.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(plan.map((row) => row.operation), ['fresh', 'refresh', 'verify', 'fresh']);
});
