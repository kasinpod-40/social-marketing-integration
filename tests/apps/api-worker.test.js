import test from 'node:test';
import assert from 'node:assert/strict';
import apiWorker from '../../apps/api-worker/src/index.js';

test('health endpoint exposes build health but not customer profile or secrets', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/health'),
    {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
      LARK_APP_SECRET: 'must-not-leak',
    },
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.environment, 'development');
  assert.equal('customerProfile' in body, false);
  assert.equal(JSON.stringify(body).includes('must-not-leak'), false);
});

test('internal project-brain route is not exposed publicly', async () => {
  const response = await apiWorker.fetch(
    new Request('https://example.test/project-brain'),
    {},
    {},
  );

  assert.equal(response.status, 404);
});
