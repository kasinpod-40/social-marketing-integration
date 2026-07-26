import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('planned jobs fail explicitly instead of returning fake success', () => {
  const definition = getJobDefinition(JOB_TYPES.FACEBOOK_ORGANIC_SYNC);
  assert.throws(
    () => assertJobImplemented(definition),
    (error) => error?.code === 'SYNC_JOB_NOT_IMPLEMENTED',
  );
});

test('Google Ads signed-delivery job is centrally registered and remains UAT-pending', () => {
  const definition = getJobDefinition(JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS);
  assert.equal(definition.connectorKey, 'google_ads');
  assert.equal(definition.implementationStatus, 'uat_pending');
  assert.equal(definition.manualOnly, true);
  assert.throws(
    () => assertJobImplemented(definition),
    (error) => error?.code === 'SYNC_JOB_UAT_PENDING',
  );
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
