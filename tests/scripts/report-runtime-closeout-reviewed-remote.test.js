import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReviewedRemoteRuntime,
} from '../../scripts/lib/report-runtime-closeout-reviewed-remote.js';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const DATABASE_ID = '22222222-2222-4222-8222-222222222222';
const NOTIFICATION_FLAGS = Object.freeze([
  'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
  'MKT_NOTIFICATION_LARK_SEND_ENABLED',
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
]);

const REQUIRED_TABLES = Object.freeze({
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktReportMetricValues: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  mktReportTopContent: 'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
  mktReportTopAds: 'LARK_TABLE_MKT_REPORT_TOP_ADS',
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  mktReportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  mktNotificationLog: 'LARK_TABLE_MKT_NOTIFICATION_LOG',
});
const BASELINE_REQUIRED_TABLES = Object.freeze({
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  mktReportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  mktNotificationLog: 'LARK_TABLE_MKT_NOTIFICATION_LOG',
});
const TABLE_IDS = Object.freeze({
  mktReportSnapshots: 'tbl-report-snapshots',
  mktReportMetricValues: 'tbl-report-metrics',
  mktReportTopContent: 'tbl-report-top-content',
  mktReportTopAds: 'tbl-report-top-ads',
  mktAiReportRuns: 'tbl-ai-runs',
  mktReportSettings: 'tbl-report-settings',
  mktNotificationLog: 'tbl-notification-log',
});

function binding(name, text) {
  return { name, type: 'plain_text', text };
}

function remoteBindings(overrides = {}) {
  const reportBindings = overrides.reportBindings ?? [
    binding('LARK_TABLE_MKT_REPORT_SNAPSHOTS', TABLE_IDS.mktReportSnapshots),
    binding('LARK_TABLE_MKT_REPORT_METRIC_VALUES', TABLE_IDS.mktReportMetricValues),
    binding('LARK_TABLE_MKT_REPORT_TOP_CONTENT', TABLE_IDS.mktReportTopContent),
  ];
  return [
    ...NOTIFICATION_FLAGS.map((name) => binding(name, 'true')),
    { name: 'MKT_STATE_DB', type: 'd1', database_id: DATABASE_ID },
    { name: 'MKT_SYNC_QUEUE', type: 'queue', queue_name: 'social-mkt-sync-jobs' },
    binding('LARK_TABLE_MKT_AI_REPORT_RUNS', TABLE_IDS.mktAiReportRuns),
    binding('LARK_TABLE_MKT_REPORT_SETTINGS', TABLE_IDS.mktReportSettings),
    binding('LARK_TABLE_MKT_NOTIFICATION_LOG', TABLE_IDS.mktNotificationLog),
    ...reportBindings,
  ];
}

function runtime(bindings) {
  const runText = async (_command, args) => {
    if (args[1] === 'deployments') {
      return JSON.stringify({ deployments: [{ percentage: 100, version_id: VERSION_ID }] });
    }
    if (args[1] === 'versions') {
      return JSON.stringify({ bindings });
    }
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
  return createReviewedRemoteRuntime({
    runCapture: async () => ({ stdout: '' }),
    runText,
    configPath: '/tmp/wrangler.sync.jsonc',
    repositoryRoot: '/tmp/repository',
    env: {},
    repositoryHead: 'a'.repeat(40),
    target: { activeTrueFlags: NOTIFICATION_FLAGS },
    requiredTables: REQUIRED_TABLES,
    config: {
      databaseId: DATABASE_ID,
      mainQueueName: 'social-mkt-sync-jobs',
      tableIds: TABLE_IDS,
      workerRequiredTables: BASELINE_REQUIRED_TABLES,
    },
  });
}

test('bootstrap baseline permits absent Report-only bindings while requiring Notification bindings', async () => {
  const result = await runtime(remoteBindings()).verifyDeployment('active');
  assert.equal(result.bindingContract, 'bootstrap_baseline');
  assert.equal(result.requiredTableBindingCount, 3);
  assert.equal(result.optionalTableBindingCount, 4);
});

test('bootstrap baseline rejects a present Report-only binding with the wrong identity', async () => {
  const bindings = remoteBindings({
    reportBindings: [
      binding('LARK_TABLE_MKT_REPORT_TOP_ADS', 'tbl-wrong-top-ads'),
    ],
  });
  await assert.rejects(
    runtime(bindings).verifyDeployment('active'),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_REMOTE_TABLE_MAPPING_MISMATCH'
      && error.details?.envName === 'LARK_TABLE_MKT_REPORT_TOP_ADS',
  );
});

test('exact deployed verification still requires every Report and Notification binding', async () => {
  await assert.rejects(
    runtime(remoteBindings()).verifyDeployment('active', VERSION_ID),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_REMOTE_BINDING_INVALID'
      && error.details?.label === 'LARK_TABLE_MKT_REPORT_TOP_ADS'
      && error.details?.matchCount === 0,
  );

  const complete = remoteBindings({
    reportBindings: [
      binding('LARK_TABLE_MKT_REPORT_SNAPSHOTS', TABLE_IDS.mktReportSnapshots),
      binding('LARK_TABLE_MKT_REPORT_METRIC_VALUES', TABLE_IDS.mktReportMetricValues),
      binding('LARK_TABLE_MKT_REPORT_TOP_CONTENT', TABLE_IDS.mktReportTopContent),
      binding('LARK_TABLE_MKT_REPORT_TOP_ADS', TABLE_IDS.mktReportTopAds),
    ],
  });
  const result = await runtime(complete).verifyDeployment('active', VERSION_ID);
  assert.equal(result.bindingContract, 'deployed_exact');
  assert.equal(result.requiredTableBindingCount, 7);
  assert.equal(result.optionalTableBindingCount, 0);
});
