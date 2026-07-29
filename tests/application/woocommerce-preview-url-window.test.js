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
  assert.match(contract, /enabled:\s*false/u);
  assert.match(contract, /previews_enabled:\s*previewsEnabled/u);
  assert.doesNotMatch(source, /wrangler',\s*'deploy'|queues?['"],\s*['"]send|d1['"],\s*['"]execute|secret['"],\s*['"]put/u);
  assert.doesNotMatch(source, /console\.log\(.*token|process\.stdout\.write\(.*token/iu);
});
