import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH,
  LARK_BASE_JS_SDK_ENTRY_URL,
  loadPinnedLarkBaseJsSdkMirror,
  localPathForPinnedModule,
  rewriteModuleSpecifiers,
} from '../../scripts/lib/lark-base-js-sdk-local-mirror.js';

function response(url, body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async text() { return body; },
  };
}

test('mirrors a pinned relative SDK module graph and rewrites imports to same-origin paths', async () => {
  const rootBody = `export { bitable } from './chunk-a.mjs';\nimport './chunk-b.mjs';\n${'x'.repeat(60_000)}`;
  const childA = `export const bitable = {};\n${'a'.repeat(30_000)}`;
  const childB = `export * from './nested/chunk-c.mjs';\n${'b'.repeat(20_000)}`;
  const childC = `export const marker = true;\n${'c'.repeat(10_000)}`;
  const bodies = new Map([
    [LARK_BASE_JS_SDK_ENTRY_URL, rootBody],
    [new URL('./chunk-a.mjs', LARK_BASE_JS_SDK_ENTRY_URL).href, childA],
    [new URL('./chunk-b.mjs', LARK_BASE_JS_SDK_ENTRY_URL).href, childB],
    [new URL('./nested/chunk-c.mjs', LARK_BASE_JS_SDK_ENTRY_URL).href, childC],
  ]);

  const mirror = await loadPinnedLarkBaseJsSdkMirror({
    fetchImpl: async (url) => response(url, bodies.get(url) ?? '', bodies.has(url) ? 200 : 404),
  });

  assert.equal(mirror.version, '1.0.2');
  assert.equal(mirror.deliveryMode, 'same-origin-pinned-jsdelivr-module-graph');
  assert.equal(mirror.moduleCount, 4);
  assert.equal(mirror.modules.get(LARK_BASE_JS_SDK_ENTRY_LOCAL_PATH), mirror.entryBody);
  assert.match(mirror.entryBody, /from '\/lark-base-js-sdk\/chunk-a\.mjs'/u);
  assert.match(mirror.entryBody, /import '\/lark-base-js-sdk\/chunk-b\.mjs'/u);
  assert.match(mirror.modules.get('/lark-base-js-sdk/chunk-b.mjs'), /from '\/lark-base-js-sdk\/nested\/chunk-c\.mjs'/u);
  assert.equal(typeof mirror.sha256, 'string');
  assert.equal(mirror.sha256.length, 64);
});

test('fails closed when the pinned graph imports outside the exact versioned dist root', async () => {
  const rootBody = `import 'https://evil.example/sdk.mjs';\n${'x'.repeat(120_000)}\nbitable`;
  await assert.rejects(
    () => loadPinnedLarkBaseJsSdkMirror({
      fetchImpl: async (url) => response(url, rootBody),
    }),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_UI_SDK_GRAPH_EXTERNAL_IMPORT',
  );
});

test('local path conversion is exact-version scoped', () => {
  assert.equal(
    localPathForPinnedModule('https://cdn.jsdelivr.net/npm/@lark-base-open/js-sdk@1.0.2/dist/api_modules/foo.mjs'),
    '/lark-base-js-sdk/api_modules/foo.mjs',
  );
  assert.throws(
    () => localPathForPinnedModule('https://cdn.jsdelivr.net/npm/@lark-base-open/js-sdk@1.0.1/dist/index.mjs'),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_UI_SDK_ORIGIN_MISMATCH',
  );
});

test('specifier rewrite replaces the exact quoted module path used by the graph', () => {
  const source = `import x from './a.mjs';\nexport { x };`;
  const rewritten = rewriteModuleSpecifiers(source, new Map([['./a.mjs', '/lark-base-js-sdk/a.mjs']]));
  assert.match(rewritten, /from '\/lark-base-js-sdk\/a\.mjs'/u);
  assert.doesNotMatch(rewritten, /from '\.\/a\.mjs'/u);
});
