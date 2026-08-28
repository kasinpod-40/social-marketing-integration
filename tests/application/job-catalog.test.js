import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_TRIGGERS,
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
  listJobDefinitions,
} from '../../packages/application/src/jobs/job-catalog.js';

test('job catalog has unique types and connector mappings', () => {
  const definitions = listJobDefinitions();
  assert.equal(new Set(definitions.map((item) => item.type)).size, definitions.length);
  assert.equal(getJobDefinition(JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC).connectorKey, 'tiktok');
  assert.equal(getJobDefinition(JOB_TYPES.METRIC_DEFINITIONS_SEED).connectorKey, null);
});

test('active jobs pass implementation guard', () => {
  const definition = getJobDefinition(JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE);
  assert.equal(assertJobImplemented(definition), definition);
});

test('Chatwoot job is active for retained manual and scheduled daily triggers', () => {
  const definition = getJobDefinition(JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC);
  assert.equal(definition.connectorKey, 'chatwoot');
  assert.equal(definition.implementationStatus, 'active');
  assert.notEqual(definition.manualOnly, true);
  assert.deepEqual(definition.allowedTriggers, [
    JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT,
    JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL,
    JOB_TRIGGERS.CHATWOOT_SCHEDULED_DAILY,
  ]);
  assert.equal(assertJobImplemented(definition), definition);
});

test('Google Ads signed-delivery job is active after retained LIVE UAT', () => {
  const definition = getJobDefinition(JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS);
  assert.equal(definition.connectorKey, 'google_ads');
  assert.equal(definition.implementationStatus, 'active');
  assert.notEqual(definition.manualOnly, true);
  assert.equal(assertJobImplemented(definition), definition);
});

test('YouTube job is active after Live DEV reliability UAT passed', () => {
  const definition = getJobDefinition(JOB_TYPES.YOUTUBE_ORGANIC_SYNC);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(assertJobImplemented(definition), definition);
});

test('dead-letter redrive job is active but remains environment-gated', () => {
  const definition = getJobDefinition(JOB_TYPES.DEAD_LETTER_REDRIVE);
  assert.equal(definition.connectorKey, null);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(assertJobImplemented(definition), definition);
});

test('Lark notification job admits controlled UAT and reviewed runtime without schedule admission', () => {
  const definition = getJobDefinition(JOB_TYPES.LARK_NOTIFICATION_SEND);
  assert.equal(definition.connectorKey, null);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(definition.manualOnly, true);
  assert.deepEqual(definition.allowedTriggers, [
    JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
    JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME,
  ]);
  assert.equal(assertJobImplemented(definition), definition);
});

test('Customer Meta K2 snapshot import is exact-trigger manual-only', () => {
  const definition = getJobDefinition(JOB_TYPES.CUSTOMER_META_K2_LARK_SNAPSHOT_IMPORT);
  assert.equal(definition.connectorKey, null);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(definition.manualOnly, true);
  assert.deepEqual(definition.allowedTriggers, [
    JOB_TRIGGERS.CUSTOMER_META_K2_SNAPSHOT_IMPORT,
  ]);
});

test('Customer D1 snapshot import is exact-trigger manual-only', () => {
  const definition = getJobDefinition(JOB_TYPES.CUSTOMER_D1_LARK_SNAPSHOT_IMPORT);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(definition.manualOnly, true);
  assert.deepEqual(definition.allowedTriggers, [JOB_TRIGGERS.CUSTOMER_D1_SNAPSHOT_IMPORT]);
  assert.equal(definition.connectorKey, null);
});

test('Customer TikTok snapshot import is exact-trigger manual-only', () => {
  const definition = getJobDefinition(JOB_TYPES.CUSTOMER_TIKTOK_LARK_SNAPSHOT_IMPORT);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(definition.manualOnly, true);
  assert.deepEqual(definition.allowedTriggers, [JOB_TRIGGERS.CUSTOMER_TIKTOK_SNAPSHOT_IMPORT]);
});

test('Dashboard materialization job is one shared manual/scheduled report type', () => {
  const definition = getJobDefinition(JOB_TYPES.REPORT_MATERIALIZATION_GENERATE);
  assert.equal(definition.implementationStatus, 'active');
  assert.notEqual(definition.manualOnly, true);
  assert.deepEqual(definition.allowedTriggers, [
    JOB_TRIGGERS.DASHBOARD_PRESET,
    JOB_TRIGGERS.DASHBOARD_CUSTOM_RANGE,
    JOB_TRIGGERS.DASHBOARD_SCHEDULED,
  ]);
  assert.equal(definition.connectorKey, null);
  assert.equal(listJobDefinitions().some((item) => /report\.(3|7|9|15|30|90)d/u.test(item.type)), false);
});

test('unknown jobs remain unsupported permanent errors', () => {
  assert.throws(
    () => getJobDefinition('unknown.job'),
    (error) => error?.code === 'UNSUPPORTED_SYNC_JOB',
  );
});

test('blank job type is rejected as an invalid queue job', () => {
  assert.throws(
    () => getJobDefinition('   '),
    (error) => error?.code === 'INVALID_SYNC_JOB',
  );
});

test('every connector job points to a connector registered in the connector catalog', async () => {
  const { listConnectorKeys } = await import('../../packages/config/src/connector-catalog.js');
  const connectorKeys = new Set(listConnectorKeys());
  for (const definition of listJobDefinitions()) {
    if (definition.connectorKey) assert.equal(connectorKeys.has(definition.connectorKey), true);
  }
});
