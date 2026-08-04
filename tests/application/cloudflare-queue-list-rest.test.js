import assert from 'node:assert/strict';
import test from 'node:test';

import { listCloudflareQueuesViaApi } from '../../scripts/lib/cloudflare-queue-list-rest.js';

const accountId = 'a'.repeat(32);

test('lists Queue inventory through the read-only Cloudflare REST endpoint', async () => {
  let request = null;
  const result = await listCloudflareQueuesViaApi({
    accountId,
    bearerToken: 'private-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            result: [{ queue_id: 'queue-id', queue_name: 'social-mkt-sync-jobs' }],
          };
        },
      };
    },
  });

  assert.equal(
    request.url,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues`,
  );
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.authorization, 'Bearer private-token');
  assert.deepEqual(result, {
    success: true,
    result: [{ queue_id: 'queue-id', queue_name: 'social-mkt-sync-jobs' }],
  });
});

test('fails closed without returning Cloudflare response details', async () => {
  await assert.rejects(
    () => listCloudflareQueuesViaApi({
      accountId,
      bearerToken: 'private-token',
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() {
          return {
            success: false,
            errors: [{ message: 'sensitive provider response' }],
          };
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'CLOUDFLARE_QUEUE_LIST_FAILED');
      assert.deepEqual(error.details, { status: 403 });
      assert.doesNotMatch(error.message, /sensitive provider response/u);
      return true;
    },
  );
});

test('rejects an invalid account identity before any request', async () => {
  let calls = 0;
  await assert.rejects(
    () => listCloudflareQueuesViaApi({
      accountId: 'invalid',
      bearerToken: 'private-token',
      fetchImpl: async () => { calls += 1; },
    }),
    (error) => error.code === 'CLOUDFLARE_QUEUE_LIST_ACCOUNT_INVALID',
  );
  assert.equal(calls, 0);
});
