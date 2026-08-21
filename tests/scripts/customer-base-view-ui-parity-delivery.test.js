import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browserFile = fileURLToPath(new URL('../../scripts/customer-base-view-ui-parity.browser.js', import.meta.url));
const serverFile = fileURLToPath(new URL('../../scripts/customer-base-view-ui-parity-server.mjs', import.meta.url));

test('View UI browser loads Base JS SDK only from the same local origin', async () => {
  const source = await readFile(browserFile, 'utf8');

  assert.match(source, /^import \{ bitable \} from '\/lark-base-js-sdk\.mjs';/u);
  assert.doesNotMatch(source, /https:\/\/esm\.sh\/@lark-base-open\/js-sdk/u);
  assert.match(source, /stage=browser-module-loaded/u);
});

test('View UI server resolves pinned SDK before READY and serves it locally', async () => {
  const source = await readFile(serverFile, 'utf8');

  assert.match(source, /const LARK_BASE_JS_SDK_VERSION = '1\.0\.2';/u);
  assert.match(source, /\?standalone&target=es2022/u);
  assert.match(source, /const sdkBundle = await loadPinnedLarkBaseJsSdk\(\);/u);
  assert.match(source, /path === '\/lark-base-js-sdk\.mjs'/u);
  assert.match(source, /sdkDeliveryMode: 'same-origin-pinned-standalone'/u);
  assert.match(source, /stage=html-executed/u);

  const resolveIndex = source.indexOf('const sdkBundle = await loadPinnedLarkBaseJsSdk();');
  const listenIndex = source.indexOf('server.listen(port, host');
  assert.ok(resolveIndex >= 0 && listenIndex > resolveIndex, 'SDK must resolve before the server can report READY');
});
