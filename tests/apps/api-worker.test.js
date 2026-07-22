import test from 'node:test';
import assert from 'node:assert/strict';
import apiWorker from '../../apps/api-worker/src/index.js';

test('health endpoint exposes build health but not customer profile or secrets', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/health'),
    {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
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
  assert.equal(JSON.stringify(body).includes('ft_pumkin'), false);
  assert.equal(JSON.stringify(body).includes('ft.pumkin'), false);
  assert.equal(JSON.stringify(body).includes('integration_workspace'), false);
});

test('internal project-brain route is not exposed publicly', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/project-brain'),
    {},
    {},
  );

  assert.equal(response.status, 404);
});


test('health endpoint fails safely when an unfinished connector is enabled', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/health'),
    {
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
      MKT_CONNECTOR_FACEBOOK_ENABLED: 'true',
      LARK_APP_SECRET: 'must-never-appear',
    },
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: 'Unhandled API error' });
  assert.equal(JSON.stringify(body).includes('must-never-appear'), false);
});
