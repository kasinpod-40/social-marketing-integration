import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertWooCommercePreviewUrlActive,
  assertWooCommercePreviewUrlBaseline,
  assertWooCommercePreviewUrlRestored,
  buildWooCommercePreviewUrlMutation,
  parseWooCommercePreviewUrlState,
} from '../../scripts/lib/woocommerce-preview-url-window.js';
import {
  parseAccountWorkersDevSubdomain,
  readAccountWorkersDevSubdomain,
} from '../../scripts/woocommerce-worker-provider-diagnostics-preview-window.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const BEARER_TOKEN = 'fixture-bearer-token-that-must-not-escape';
const ACCOUNT_SUBDOMAIN = 'account-preview-fixture';

test('parses exact Cloudflare Worker subdomain state', () => {
  assert.deepEqual(parseWooCommercePreviewUrlState({
    success: true,
    result: { enabled: false, previews_enabled: false },
  }), {
    enabled: false,
    previewsEnabled: false,
  });
  assert.throws(
    () => parseWooCommercePreviewUrlState({ success: false, errors: [{ code: 10000 }] }),
    (error) => (
      error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_API_FAILED'
      && error?.details?.errorCodes?.[0] === 10000
    ),
  );
  assert.throws(
    () => parseWooCommercePreviewUrlState({
      success: true,
      result: { enabled: 'false', previews_enabled: false },
    }),
    (error) => error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_STATE_INVALID',
  );
});

test('requires disabled baseline, isolated active state and exact disabled restore', () => {
  const disabled = { enabled: false, previewsEnabled: false };
  const active = { enabled: false, previewsEnabled: true };
  assert.deepEqual(assertWooCommercePreviewUrlBaseline(disabled), disabled);
  assert.deepEqual(assertWooCommercePreviewUrlActive(active), active);
  assert.deepEqual(assertWooCommercePreviewUrlRestored(disabled), disabled);
  assert.throws(
    () => assertWooCommercePreviewUrlBaseline({ enabled: true, previewsEnabled: false }),
    (error) => error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_BASELINE_INVALID',
  );
  assert.throws(
    () => assertWooCommercePreviewUrlActive({ enabled: true, previewsEnabled: true }),
    (error) => error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_ENABLE_FAILED',
  );
  assert.throws(
    () => assertWooCommercePreviewUrlRestored(active),
    (error) => error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_RESTORE_FAILED',
  );
});

test('builds mutations that never enable the base workers.dev route', () => {
  assert.deepEqual(buildWooCommercePreviewUrlMutation(true), {
    enabled: false,
    previews_enabled: true,
  });
  assert.deepEqual(buildWooCommercePreviewUrlMutation(false), {
    enabled: false,
    previews_enabled: false,
  });
  assert.throws(
    () => buildWooCommercePreviewUrlMutation('true'),
    (error) => error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_INPUT_INVALID',
  );
});

test('parses only a successful lowercase DNS-safe account workers.dev subdomain', () => {
  assert.equal(parseAccountWorkersDevSubdomain({
    success: true,
    result: { subdomain: ACCOUNT_SUBDOMAIN },
  }), ACCOUNT_SUBDOMAIN);
  for (const payload of [
    null,
    { success: false, result: { subdomain: ACCOUNT_SUBDOMAIN } },
    { success: true, result: null },
    { success: true, result: { subdomain: '' } },
    { success: true, result: { subdomain: 'Uppercase' } },
    { success: true, result: { subdomain: 'unsafe.value' } },
    { success: true, result: { subdomain: 'https://unsafe' } },
    { success: true, result: { subdomain: 'unsafe/value' } },
    { success: true, result: { subdomain: 'a'.repeat(64) } },
    { success: true, result: { subdomain: ACCOUNT_SUBDOMAIN, unexpected: true } },
  ]) {
    assert.throws(
      () => parseAccountWorkersDevSubdomain(payload),
      (error) => error?.code === 'WOOCOMMERCE_PREVIEW_URL_WINDOW_ACCOUNT_SUBDOMAIN_INVALID',
    );
  }
});

test('reads account workers.dev subdomain with one exact GET and returns only the label', async () => {
  const calls = [];
  const result = await readAccountWorkersDevSubdomain({
    accountId: ACCOUNT_ID,
    bearerToken: BEARER_TOKEN,
  }, async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      success: true,
      result: { subdomain: ACCOUNT_SUBDOMAIN },
      errors: [],
      messages: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  assert.equal(result, ACCOUNT_SUBDOMAIN);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain`,
  );
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${BEARER_TOKEN}`);
});

test('account subdomain lookup fails closed without exposing sensitive inputs', async () => {
  const rawSubdomain = 'Unsafe.Raw.Subdomain';
  const responses = [
    new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: 403 }),
    new Response(JSON.stringify({
      success: true,
      result: { subdomain: rawSubdomain },
    }), { status: 200 }),
  ];
  for (const response of responses) {
    await assert.rejects(
      readAccountWorkersDevSubdomain({
        accountId: ACCOUNT_ID,
        bearerToken: BEARER_TOKEN,
      }, async () => response),
      (error) => {
        const serialized = JSON.stringify({
          message: error?.message,
          code: error?.code,
          details: error?.details,
        });
        return !serialized.includes(ACCOUNT_ID)
          && !serialized.includes(BEARER_TOKEN)
          && !serialized.includes(rawSubdomain);
      },
    );
  }
});

test('Preview window wrapper is confirmation-gated and restores in finally', async () => {
  const [source, contract] = await Promise.all([
    readFile(
      new URL('../../scripts/woocommerce-worker-provider-diagnostics-preview-window.mjs', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../scripts/lib/woocommerce-preview-url-window.js', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(source, /CONFIRM_WOOCOMMERCE_PREVIEW_URL_WINDOW/u);
  assert.match(source, /OPEN_AND_RESTORE_WOOCOMMERCE_PREVIEW_URLS/u);
  assert.match(source, /finally\s*\{/u);
  assert.match(source, /restorePreviewUrls\(\)/u);
  assert.match(source, /buildWooCommercePreviewUrlMutation\(previewsEnabled\)/u);
  assert.match(source, /previewUrlsRestored/u);
  assert.match(source, /productionTrafficChange:\s*false/u);
  assert.match(source, /stdio:\s*'inherit'/u);
  assert.match(source, /MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN/u);
  assert.match(source, /readAccountWorkersDevSubdomain/u);
  assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN:\s*auth\.token/u);
  assert.match(contract, /enabled:\s*false/u);
  assert.match(contract, /previews_enabled:\s*previewsEnabled/u);
  assert.doesNotMatch(source, /wrangler',\s*'deploy'|queues?['"],\s*['"]send|d1['"],\s*['"]execute|secret['"],\s*['"]put/u);
  assert.doesNotMatch(source, /console\.log\(.*token|process\.stdout\.write\(.*token/iu);
});
