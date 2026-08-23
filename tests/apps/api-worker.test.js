import test from 'node:test';
import assert from 'node:assert/strict';
import apiWorker from '../../apps/api-worker/src/index.js';

test('health endpoint exposes build health but not customer profile, identity or secrets', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/health'),
    {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      LARK_APP_SECRET: 'must-not-leak',
    },
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.environment, 'development');
  assert.equal('customerProfile' in body, false);
  assert.equal(body.connectors.find((item) => item.key === 'tiktok').runnable, true);
  assert.equal(body.connectors.find((item) => item.key === 'facebook').runnable, false);
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(body).includes('chemistry_k'), false);
  assert.equal(JSON.stringify(body).includes('integration_workspace'), false);
  assert.equal(JSON.stringify(body).includes('dev_ft_pumkin'), false);
});

test('internal project-brain route is not exposed publicly', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/project-brain'),
    {},
    {},
  );

  assert.equal(response.status, 404);
});

test('signed-delivery path exposes only POST and stays hidden while disabled', async () => {
  const getResponse = await apiWorker.fetch(
    new Request('https://example.test/v1/google-ads/manager-script/deliveries'),
    {},
    {},
  );
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get('allow'), 'POST');

  const postResponse = await apiWorker.fetch(
    new Request('https://example.test/v1/google-ads/manager-script/deliveries', {
      method: 'POST',
      body: '{}',
    }),
    { MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED: 'false' },
    {},
  );
  assert.equal(postResponse.status, 404);
});


test('health endpoint reports verified TikTok as runnable without exposing secrets', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/health'),
    {
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      LARK_APP_SECRET: 'must-never-appear',
    },
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.connectors.find((item) => item.key === 'tiktok').runnable, true);
  assert.equal(JSON.stringify(body).includes('must-never-appear'), false);
});
