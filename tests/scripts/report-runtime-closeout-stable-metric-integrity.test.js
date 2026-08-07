import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertD1LarkIntegrity,
  createReviewedStateRuntime,
} from '../../scripts/lib/report-runtime-closeout-reviewed-state.js';

const REPORT_ID = 'integration_workspace:chatwoot:rolling:1d:test';

function runtime() {
  return createReviewedStateRuntime({
    run: async () => {},
    runText: async () => JSON.stringify([{ results: [{ value: 1 }] }]),
    repositoryRoot: process.cwd(),
    outputRoot: 'outputs/test-report-stable-metric-integrity',
    configPath: 'wrangler.sync.jsonc',
    env: {},
    target: {
      platformScope: 'chatwoot',
      accountKey: 'chemistry_k',
    },
  });
}

function tableIds() {
  return {
    mktReportSnapshots: 'snapshots',
    mktReportMetricValues: 'metrics',
    mktReportTopContent: 'top-content',
    mktReportTopAds: 'top-ads',
  };
}

function metricRecord(reportMetricKey, metricKey, currentValue) {
  return {
    fields: {
      report_metric_key: reportMetricKey,
      metric_key: metricKey,
      current_value: currentValue,
    },
  };
}

test('Lark reviewed state permits repeated metric_key across dimensions when report_metric_key is unique', async () => {
  const records = [
    metricRecord(
      `${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-a`,
      'chatwoot:resolved_count',
      11,
    ),
    metricRecord(
      `${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-b`,
      'chatwoot:resolved_count',
      22,
    ),
  ];
  const client = {
    async searchRecords({ tableId }) {
      if (tableId === 'snapshots') return [{}];
      if (tableId === 'metrics') return records;
      return [];
    },
  };

  const state = await runtime().readLarkReportState(client, tableIds(), REPORT_ID);

  assert.equal(state.snapshots, 1);
  assert.equal(state.metrics, 2);
  assert.equal(state.duplicateMetricKeys, 0);
  assert.deepEqual(state.metricValues, {
    [`${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-a`]: 11,
    [`${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-b`]: 22,
  });
});

test('Lark reviewed state still detects duplicate report_metric_key identities', async () => {
  const stableKey = `${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-a`;
  const client = {
    async searchRecords({ tableId }) {
      if (tableId === 'snapshots') return [{}];
      if (tableId === 'metrics') return [
        metricRecord(stableKey, 'chatwoot:resolved_count', 11),
        metricRecord(stableKey, 'chatwoot:resolved_count', 22),
      ];
      return [];
    },
  };

  const state = await runtime().readLarkReportState(client, tableIds(), REPORT_ID);
  assert.equal(state.duplicateMetricKeys, 1);
  assert.throws(
    () => assertD1LarkIntegrity({
      report_id: REPORT_ID,
      payload_json: JSON.stringify({
        metricPayload: {
          'chatwoot:resolved_count': {
            metricKey: 'chatwoot:resolved_count',
            current: 11,
          },
        },
      }),
    }, state),
    (error) => error?.code === 'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_DUPLICATE',
  );
});

test('D1/Lark integrity verifies all dimensional values by report_metric_key stable identity', () => {
  const payload = {
    metricPayload: {
      'chatwoot:conversation_count': {
        metricKey: 'chatwoot:conversation_count',
        current: 100,
      },
    },
    collections: {
      dimension_metrics: [
        {
          metricKey: 'chatwoot:resolved_count',
          dimensionType: 'inbox',
          dimensionValue: 'inbox-a',
          current: 11,
        },
        {
          metricKey: 'chatwoot:resolved_count',
          dimensionType: 'inbox',
          dimensionValue: 'inbox-b',
          current: 22,
        },
      ],
    },
  };
  const lark = {
    duplicateMetricKeys: 0,
    metricValues: {
      [`${REPORT_ID}::chatwoot%3Aconversation_count::summary::all`]: 100,
      [`${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-a`]: 11,
      [`${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-b`]: 22,
    },
  };

  assert.deepEqual(assertD1LarkIntegrity({
    report_id: REPORT_ID,
    payload_json: JSON.stringify(payload),
  }, lark), {
    metricCount: 3,
    summaryMetricCount: 1,
    dimensionMetricCount: 2,
    mismatchCount: 0,
  });

  assert.throws(
    () => assertD1LarkIntegrity({
      report_id: REPORT_ID,
      payload_json: JSON.stringify(payload),
    }, {
      ...lark,
      metricValues: {
        ...lark.metricValues,
        [`${REPORT_ID}::chatwoot%3Aresolved_count::inbox::inbox-b`]: 23,
      },
    }),
    (error) => error?.code === 'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_VALUE_DRIFT',
  );
});
