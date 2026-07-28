import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportAiSummary } from '../../packages/application/src/use-cases/generate-report-ai-summary.js';

const GENERATED_AT = Date.parse('2026-07-28T00:00:00Z');

test('AI summary is default-off without resolving a provider', async () => {
  const result = await generateReportAiSummary({
    enabled: false,
    provider: null,
    materializationPayload: payload({ dataStatus: 'complete' }),
  });
  assert.deepEqual(result, { status: 'disabled', summary: null });
});

test('source-unavailable materialization skips AI before resolving a provider', async () => {
  const result = await generateReportAiSummary({
    enabled: true,
    provider: null,
    materializationPayload: payload({ dataStatus: 'source_unavailable' }),
  });
  assert.deepEqual(result, {
    status: 'skipped',
    reason: 'source_unavailable',
    summary: null,
  });
});

test('enabled AI with available facts fails closed when provider binding is absent', async () => {
  await assert.rejects(
    () => generateReportAiSummary({
      enabled: true,
      provider: null,
      materializationPayload: payload({ dataStatus: 'complete' }),
    }),
    (error) => error.code === 'REPORT_AI_PROVIDER_UNAVAILABLE',
  );
});

function payload(input) {
  return {
    schemaVersion: 'dashboard-materialization-v2',
    sourceReportId: null,
    platformScope: 'youtube',
    capability: 'organic',
    reportType: 'dashboard_performance_report',
    period: {
      periodKind: 'rolling_days',
      windowDays: 3,
      periodStart: '2026-07-25',
      periodEnd: '2026-07-27',
      comparisonMode: 'previous_period',
      compareStart: '2026-07-22',
      compareEnd: '2026-07-24',
    },
    dataStatus: input.dataStatus,
    coverageRate: input.dataStatus === 'complete' ? 1 : null,
    metricPayload: {},
    topContent: [],
    topAds: [],
    source: input.dataStatus === 'source_unavailable' ? 'report_platform_catalog' : 'd1_organic_observations',
    sourceWatermark: input.dataStatus === 'complete' ? 'wm' : null,
    generatedAt: GENERATED_AT,
    sourceUnavailableReason: input.dataStatus === 'source_unavailable' ? 'REPORT_SOURCE_UAT_PENDING' : null,
    aiSummary: null,
  };
}
