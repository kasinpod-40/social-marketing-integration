import assert from 'node:assert/strict';
import test from 'node:test';
import { compactLarkNativeAiWeeklyEvidence } from '../../packages/application/src/reports/compact-lark-native-ai-weekly-evidence.js';

function buildChannel(index, readinessStatus = 'report_partial') {
  return {
    channelKey: `channel_${index}`,
    displayName: `Channel ${index}`,
    readinessStatus,
    readinessMessage: 'internal readiness prose that should not be repeated into compact AI evidence',
    sourceReportId: `report-${index}`,
    sourceWatermark: `watermark-${index}`,
    availableMetrics: Array.from({ length: 12 }, (_, metricIndex) => ({
      metric_key: `metric_${metricIndex}`,
      display_name: `Metric ${metricIndex}`,
      current_value: 100 + metricIndex,
      previous_value: 90 + metricIndex,
      change_percent: 11.111,
      availability_status: 'available',
      long_internal_note: 'x'.repeat(500),
    })),
    topContent: Array.from({ length: 3 }, (_, rank) => ({
      rank: rank + 1,
      title: `Top content ${rank + 1} ${'y'.repeat(300)}`,
      views: 1000 - rank,
      permalink: `https://example.invalid/content/${rank + 1}`,
      raw_payload: 'z'.repeat(800),
    })),
    topAds: Array.from({ length: 3 }, (_, rank) => ({
      rank: rank + 1,
      ad_name: `Ad ${rank + 1}`,
      spend_micros: 123456,
      impressions: 999,
      raw_payload: 'z'.repeat(800),
    })),
    collections: {
      payment_method: Array.from({ length: 4 }, (_, rank) => ({ rank: rank + 1, name: `Method ${rank + 1}`, value: 100 - rank, raw: 'q'.repeat(400) })),
      product: Array.from({ length: 4 }, (_, rank) => ({ rank: rank + 1, name: `Product ${rank + 1}`, value: 100 - rank, raw: 'q'.repeat(400) })),
      shipping_method: Array.from({ length: 4 }, (_, rank) => ({ rank: rank + 1, name: `Shipping ${rank + 1}`, value: 100 - rank, raw: 'q'.repeat(400) })),
    },
  };
}

test('compacts weekly Executive evidence below reviewed input budgets while retaining business facts', () => {
  const channels = Array.from({ length: 9 }, (_, index) => buildChannel(index, index < 4 ? 'report_partial' : 'report_missing'));
  const summary = {
    evidenceShape: 'executive_business_first_v2',
    overallCoverageState: 'partial_coverage',
    counts: { report_partial: 4, report_missing: 5, validated: 4 },
    channelStatuses: channels.map((channel) => ({
      channelKey: channel.channelKey,
      displayName: channel.displayName,
      readinessStatus: channel.readinessStatus,
      readinessMessage: channel.readinessMessage,
      sourceReportChecksum: 'a'.repeat(64),
      availableMetricCount: channel.availableMetrics.length,
    })),
    channelBusinessEvidence: channels,
    sourceReportIds: Array.from({ length: 20 }, (_, index) => `report-${index}`),
  };
  const original = JSON.stringify(summary);
  const compact = compactLarkNativeAiWeeklyEvidence({
    metricSummaryJson: original,
    channelStatusVectorJson: JSON.stringify(summary.channelStatuses),
  });
  const parsed = JSON.parse(compact.metricSummaryJson);
  const status = JSON.parse(compact.channelStatusVectorJson);

  assert.equal(parsed.evidenceShape, 'executive_business_first_v2');
  assert.equal(parsed.promptShape, 'lark_ai_compact_v1');
  assert.equal(parsed.channelBusinessEvidence.length, 9);
  assert.equal(status.length, 9);
  assert.ok(compact.metricSummaryChars <= 2800);
  assert.ok(compact.channelStatusVectorChars <= 700);
  assert.ok(compact.metricSummaryChars < original.length);
  assert.equal(parsed.channelBusinessEvidence[0].availableMetrics[0].metric_key, 'metric_0');
  assert.equal(parsed.channelBusinessEvidence[0].availableMetrics[0].current_value, 100);
  assert.equal(parsed.channelBusinessEvidence[0].availableMetrics[0].previous_value, 90);
  assert.ok(parsed.channelBusinessEvidence[0].topContent.length >= 1);
  assert.ok(parsed.channelBusinessEvidence[0].topAds.length >= 1);
  assert.equal(Object.hasOwn(parsed.channelBusinessEvidence[0], 'sourceWatermark'), false);
});

test('rejects non Executive business-first evidence', () => {
  assert.throws(
    () => compactLarkNativeAiWeeklyEvidence({
      metricSummaryJson: JSON.stringify({ evidenceShape: 'legacy', channelBusinessEvidence: [] }),
      channelStatusVectorJson: '[]',
    }),
    (error) => error?.code === 'LARK_AI_EVIDENCE_SHAPE_INVALID',
  );
});
