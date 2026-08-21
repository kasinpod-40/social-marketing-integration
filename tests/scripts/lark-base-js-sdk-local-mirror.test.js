import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_BASE_JS_SDK_CDN_ROOT,
  LARK_BASE_JS_SDK_ENTRY_URL,
  LARK_BASE_JS_SDK_ESBUILD_VERSION,
  loadPinnedLarkBaseJsSdkMirror,
  localPathForPinnedModule,
} from '../../scripts/lib/lark-base-js-sdk-local-mirror.js';

function response(url, body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async text() { return body; },
  };
}

test('bundles the pinned SDK graph into one standalone browser module', async () => {
  const childUrl = new URL('./chunk-a.mjs', LARK_BASE_JS_SDK_ENTRY_URL).href;
  const rootBody = `export { bitable } from './chunk-a.mjs';\n${'x'.repeat(70_000)}`;
  const childBody = `export const bitable = { ready: true };\n${'a'.repeat(40_000)}`;
  const bodies = new Map([
    [LARK_BASE_JS_SDK_ENTRY_URL, rootBody],
    [childUrl, childBody],
  ]);

  const bundle = await loadPinnedLarkBaseJsSdkMirror({
    fetchImpl: async (url) => response(url, bodies.get(url) ?? '', bodies.has(url) ? 200 : 404),
  });

  assert.equal(bundle.version, '1.0.2');
  assert.equal(bundle.deliveryMode, 'same-origin-pinned-esbuild-single-bundle');
  assert.equal(bundle.esbuildVersion, LARK_BASE_JS_SDK_ESBUILD_VERSION);
  assert.equal(bundle.moduleCount, 2);
  assert.equal(bundle.modules.size, 0);
  assert.match(bundle.entryBody, /bitable/u);
  assert.doesNotMatch(bundle.entryBody, /chunk-a\.mjs/u);
  assert.doesNotMatch(bundle.entryBody, /cdn\.jsdelivr\.net/u);
  assert.equal(typeof bundle.sha256, 'string');
  assert.equal(bundle.sha256.length, 64);
  assert.ok(bundle.bytes >= 100_000);
});

test('esbuild parser discovers nested imports without the retired hand-written scanner', async () => {
  const aUrl = new URL('./chunk-a.mjs', LARK_BASE_JS_SDK_ENTRY_URL).href;
  const bUrl = new URL('./nested/chunk-b.mjs', aUrl).href;
  const bodies = new Map([
    [LARK_BASE_JS_SDK_ENTRY_URL, `export { bitable } from './chunk-a.mjs';\n${'x'.repeat(60_000)}`],
    [aUrl, `export { bitable } from './nested/chunk-b.mjs';\n${'a'.repeat(30_000)}`],
    [bUrl, `export const bitable = {};\n${'b'.repeat(20_000)}`],
  ]);

  const bundle = await loadPinnedLarkBaseJsSdkMirror({
    fetchImpl: async (url) => response(url, bodies.get(url) ?? '', bodies.has(url) ? 200 : 404),
  });

  assert.equal(bundle.moduleCount, 3);
  assert.match(bundle.entryBody, /bitable/u);
  assert.doesNotMatch(bundle.entryBody, /chunk-b\.mjs/u);
});

test('fails closed when the SDK imports outside the exact versioned package graph', async () => {
  const rootBody = `import 'https://evil.example/sdk.mjs';\nexport const bitable = {};\n${'x'.repeat(120_000)}`;

  await assert.rejects(
    () => loadPinnedLarkBaseJsSdkMirror({
      fetchImpl: async (url) => response(url, rootBody),
    }),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_EXTERNAL_IMPORT'
      && error?.details?.specifier === 'https://evil.example/sdk.mjs',
  );
});

test('fails closed when the CDN redirects a module to a different package path', async () => {
  const childUrl = new URL('./chunk-a.mjs', LARK_BASE_JS_SDK_ENTRY_URL).href;
  const redirectedChildUrl = `${LARK_BASE_JS_SDK_CDN_ROOT}canonical/chunk-a.mjs`;
  const bodies = new Map([
    [LARK_BASE_JS_SDK_ENTRY_URL, `export { bitable } from './chunk-a.mjs';\n${'x'.repeat(70_000)}`],
    [childUrl, `export const bitable = {};\n${'a'.repeat(40_000)}`],
  ]);

  await assert.rejects(
    () => loadPinnedLarkBaseJsSdkMirror({
      fetchImpl: async (url) => {
        if (url === childUrl) return response(redirectedChildUrl, bodies.get(url));
        return response(url, bodies.get(url) ?? '', bodies.has(url) ? 200 : 404);
      },
    }),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_UI_SDK_REDIRECT_PATH_CHANGED',
  );
});

test('fails closed when the bundler version is outside the repository lock authority', async () => {
  await assert.rejects(
    () => loadPinnedLarkBaseJsSdkMirror({
      fetchImpl: async () => response(LARK_BASE_JS_SDK_ENTRY_URL, ''),
      esbuildImpl: { build: async () => ({}), version: '0.0.1' },
    }),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_UI_SDK_BUNDLER_VERSION_MISMATCH',
  );
});

test('local path conversion remains exact-version scoped', () => {
  assert.equal(
    localPathForPinnedModule('https://cdn.jsdelivr.net/npm/@lark-base-open/js-sdk@1.0.2/dist/api_modules/foo.mjs'),
    '/lark-base-js-sdk/api_modules/foo.mjs',
  );
  assert.throws(
    () => localPathForPinnedModule('https://cdn.jsdelivr.net/npm/@lark-base-open/js-sdk@1.0.1/dist/index.mjs'),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_UI_SDK_ORIGIN_MISMATCH',
  );
});
