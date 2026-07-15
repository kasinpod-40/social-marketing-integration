import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { assertConnectorManualUatRunnable } from '../../packages/application/src/connectors/connector-registry.js';
import { assertJobManualUatImplemented, getJobDefinition, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';

test('allows YouTube only through the separate fail-closed manual UAT gate', () => {
  const runtime = loadCustomerRuntimeConfig({
    MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false', MKT_CONNECTOR_YOUTUBE_ENABLED: 'false',
  });
  const job = assertJobManualUatImplemented(getJobDefinition(JOB_TYPES.YOUTUBE_ORGANIC_SYNC), 'manual_uat');
  const connector = assertConnectorManualUatRunnable(runtime, 'youtube', {
    trigger: 'manual_uat', uatEnabled: true, featureFlagEnv: 'MKT_CONNECTOR_YOUTUBE_UAT_ENABLED',
  });
  assert.equal(job.implementationStatus, 'uat_pending');
  assert.equal(connector.enabled, false);
});

test('manual UAT remains blocked without the explicit flag or trigger', () => {
  const runtime = loadCustomerRuntimeConfig({
    MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false', MKT_CONNECTOR_YOUTUBE_ENABLED: 'false',
  });
  assert.throws(() => assertConnectorManualUatRunnable(runtime, 'youtube', {
    trigger: 'manual_uat', uatEnabled: false,
  }), (error) => error?.code === 'MKT_CONNECTOR_UAT_DISABLED');
  assert.throws(() => assertJobManualUatImplemented(
    getJobDefinition(JOB_TYPES.YOUTUBE_ORGANIC_SYNC), 'scheduled',
  ), (error) => error?.code === 'SYNC_JOB_UAT_TRIGGER_REQUIRED');
});
