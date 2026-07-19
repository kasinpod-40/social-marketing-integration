import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { assertConnectorRunnable } from '../../packages/application/src/connectors/connector-registry.js';
import { assertJobImplemented, getJobDefinition, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';

test('allows active YouTube jobs through the normal connector feature flag', () => {
  const runtime = loadCustomerRuntimeConfig({
    MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false', MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  const job = assertJobImplemented(getJobDefinition(JOB_TYPES.YOUTUBE_ORGANIC_SYNC));
  const connector = assertConnectorRunnable(runtime, 'youtube');
  assert.equal(job.implementationStatus, 'active');
  assert.equal(connector.enabled, true);
});

test('active YouTube remains fail-closed while its normal feature flag is disabled', () => {
  const runtime = loadCustomerRuntimeConfig({
    MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false', MKT_CONNECTOR_YOUTUBE_ENABLED: 'false',
  });
  assert.throws(
    () => assertConnectorRunnable(runtime, 'youtube'),
    (error) => error?.code === 'MKT_CONNECTOR_DISABLED',
  );
});
