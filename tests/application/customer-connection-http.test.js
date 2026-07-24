import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerConnectionHttpHandler } from '../../apps/sync-worker/src/customer-connection-http.js';

const OPERATOR_TOKEN = 'operator-token-that-must-never-appear-in-output';

test('operator route creates an allowlisted invitation response with no-store policy', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const response = await handler(new Request(
    'https://worker.example/operator/connection-invitations',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OPERATOR_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        connectorKey: 'google_ads',
        customerKey: 'customer-a',
        maxAttempts: 4,
      }),
    },
  ), {});
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    invitation: {
      connector: 'google_ads',
      customerKey: 'customer-a',
      connectUrl: 'https://worker.example/connect/google-ads?invitation=signed',
      expiresAt: '2026-07-25T00:00:00.000Z',
      environment: 'development',
      maxAttempts: 4,
    },
  });
  assert.equal(JSON.stringify(body).includes(OPERATOR_TOKEN), false);
  assert.deepEqual(calls[0], {
    connectorKey: 'google_ads',
    customerKey: 'customer-a',
    environment: 'development',
    publicOrigin: 'https://worker.example/',
    redirectUri: 'https://worker.example/oauth/google-ads/callback',
    ttlMs: undefined,
    maxAttempts: 4,
  });
});

test('operator route rejects wrong credentials without calling invitation service', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const original = console.error;
  console.error = () => {};
  try {
    const response = await handler(new Request(
      'https://worker.example/operator/connection-invitations',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer wrong',
          'content-type': 'application/json',
        },
        body: '{}',
      },
    ), {});
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Unauthorized',
      code: 'CONNECTION_OPERATOR_UNAUTHORIZED',
    });
    assert.equal(calls.length, 0);
  } finally {
    console.error = original;
  }
});

test('HTTP boundary returns 405 for a known path and 404 for an unknown path', async () => {
  const handler = createHandler([]);
  const methodResponse = await handler(new Request(
    'https://worker.example/operator/connection-invitations',
  ), {});
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'POST');

  const missingResponse = await handler(new Request(
    'https://worker.example/not-a-route',
  ), {});
  assert.equal(missingResponse.status, 404);
});

test('connect routes allow confirmation GET/POST only and reject scanner HEAD without side effects', async () => {
  const connectorCalls = [];
  const handler = createCustomerConnectionHttpHandler({
    createRuntime() {
      throw new Error('runtime must not load for rejected methods');
    },
    async handleConnectorRequest(input) {
      connectorCalls.push(input);
      return null;
    },
  });
  const response = await handler(new Request(
    'https://worker.example/connect/google-ads?invitation=signed',
    { method: 'HEAD' },
  ), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
  assert.deepEqual(connectorCalls, []);
});

test('adding fetch keeps scheduled and queue handlers independently injectable', async () => {
  const { createSyncWorker } = await import('../../apps/sync-worker/src/sync-worker.js');
  const events = [];
  const worker = createSyncWorker({
    handleHttp: async () => new Response('fetch-ok'),
    processJob: async () => events.push('queue'),
  });
  assert.equal(await (await worker.fetch(new Request('https://worker.example/'), {})).text(), 'fetch-ok');
  assert.equal(typeof worker.scheduled, 'function');
  assert.equal(typeof worker.queue, 'function');
});

function createHandler(calls) {
  return createCustomerConnectionHttpHandler({
    createRuntime() {
      return {
        config: {
          environment: 'development',
          publicOrigin: 'https://worker.example/',
          customerKey: 'customer-a',
          operatorToken: OPERATOR_TOKEN,
          redirectUris: {
            google_ads: 'https://worker.example/oauth/google-ads/callback',
            youtube: 'https://worker.example/oauth/youtube/callback',
          },
        },
        service: {
          async createInvitation(input) {
            calls.push(input);
            return {
              connector: input.connectorKey,
              customerKey: input.customerKey,
              connectUrl: 'https://worker.example/connect/google-ads?invitation=signed',
              expiresAt: '2026-07-25T00:00:00.000Z',
              environment: input.environment,
              maxAttempts: input.maxAttempts,
            };
          },
        },
      };
    },
  });
}
