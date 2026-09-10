import test from 'node:test';
import assert from 'node:assert/strict';

import { waitForMktAdsPreviewRoute } from '../../scripts/lib/mkt-ads-preview-readiness.js';

test('waits through transient alias 404 and accepts only dedicated read-only route response', async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), { status: 404 }),
    new Response(JSON.stringify({ ok: false, code: 'METHOD_NOT_ALLOWED' }), { status: 405 }),
  ];
  const result = await waitForMktAdsPreviewRoute({
    url: 'https://preview.example.com/__codex/mkt-ads-campaign-summary-retention-v1',
    delays: [0, 0],
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return responses.shift();
    },
  });

  assert.deepEqual(result, {
    ready: true,
    attemptCount: 2,
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    remoteMutationCount: 0,
  });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ init }) => init.method === 'GET'));
  assert.ok(requests.every(({ init }) => init.body === undefined));
});

test('fails closed when the dedicated route never becomes ready', async () => {
  await assert.rejects(
    waitForMktAdsPreviewRoute({
      url: 'https://preview.example.com/__codex/mkt-ads-campaign-summary-retention-v1',
      delays: [0, 0],
      sleep: async () => {},
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
        status: 404,
      }),
    }),
    (error) => error.code === 'MKT_ADS_PREVIEW_READINESS_TIMEOUT'
      && error.details.attemptCount === 2
      && error.details.lastStatus === 404,
  );
});

test('rejects non-HTTPS readiness targets before any fetch', async () => {
  let fetchCount = 0;
  await assert.rejects(
    waitForMktAdsPreviewRoute({
      url: 'http://preview.example.com/__codex/mkt-ads-campaign-summary-retention-v1',
      fetchImpl: async () => { fetchCount += 1; },
    }),
    (error) => error.code === 'MKT_ADS_PREVIEW_READINESS_INPUT_INVALID',
  );
  assert.equal(fetchCount, 0);
});
