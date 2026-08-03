import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptLarkNativeAiControlledPreviewReportSource,
} from '../../scripts/lib/adapt-lark-native-ai-controlled-preview-report-source.js';

const BASE = Object.freeze({
  schemaVersion: 'source-v1',
  contractVersion: 'contract-v1',
  repositoryHead: 'a'.repeat(40),
  provenance: {},
  schemaAuthority: {},
  remoteAuthority: {},
});

test('adapter preserves numeric values and original Report scope while creating AI summary scope', async () => {
  const input = packageWithMetric({
    metric_scope: 'period_delta',
    dimension_type: 'summary',
    availability_status: 'available',
    current_value: 120,
    compare_value: 100,
  });
  const result = await adaptLarkNativeAiControlledPreviewReportSource(input);
  const metric = result.offlineInputs[0].channels[0].report.metricValues[0];
  assert.equal(metric.metric_scope, 'summary');
  assert.equal(metric.source_metric_scope, 'period_delta');
  assert.equal(metric.current_value, 120);
  assert.equal(metric.compare_value, 100);
  assert.equal(metric.availability_status, 'available');
  assert.equal(metric.observed, true);
  assert.match(result.packageSha256, /^[a-f0-9]{64}$/u);
  assert.equal(input.offlineInputs[0].channels[0].report.metricValues[0].source_metric_scope, undefined);
});

test('adapter maps Report not_observed to AI not_available without inventing zero', async () => {
  const result = await adaptLarkNativeAiControlledPreviewReportSource(packageWithMetric({
    metric_scope: 'current_total',
    dimension_type: 'summary',
    availability_status: 'not_observed',
    current_value: null,
  }));
  const metric = result.offlineInputs[0].channels[0].report.metricValues[0];
  assert.equal(metric.metric_scope, 'summary');
  assert.equal(metric.source_metric_scope, 'current_total');
  assert.equal(metric.availability_status, 'not_available');
  assert.equal(metric.current_value, null);
  assert.equal(metric.observed, false);
});

test('adapter rejects stale or missing numeric values that contradict availability', async () => {
  await assert.rejects(
    () => adaptLarkNativeAiControlledPreviewReportSource(packageWithMetric({
      availability_status: 'available',
      current_value: null,
    })),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_VALUE_MISSING',
  );
  await assert.rejects(
    () => adaptLarkNativeAiControlledPreviewReportSource(packageWithMetric({
      availability_status: 'source_unavailable',
      current_value: 99,
    })),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_STALE_VALUE',
  );
});

function packageWithMetric(overrides) {
  return {
    ...structuredClone(BASE),
    offlineInputs: [{
      channels: [{
        platform: 'tiktok',
        report: {
          metricValues: [{
            metric_key: 'views',
            metric_scope: 'period_delta',
            dimension_type: 'summary',
            dimension_value: 'all',
            availability_status: 'available',
            current_value: 1,
            compare_value: null,
            ...overrides,
          }],
        },
      }],
    }],
  };
}
