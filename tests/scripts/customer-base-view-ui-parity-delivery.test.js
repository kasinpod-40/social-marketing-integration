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

  const sdkImportIndex = source.indexOf("import { bitable } from '/lark-base-js-sdk.mjs';");
  const bootMarkerIndex = source.indexOf('stage=browser-module-loaded');
  const preflightIndex = source.indexOf('async function preflight(plan)');
  assert.ok(
    sdkImportIndex === 0 && bootMarkerIndex > sdkImportIndex && preflightIndex > bootMarkerIndex,
    'same-origin SDK import and boot marker must be established before Base preflight code',
  );
});

test('View UI server resolves the exact pinned SDK bundle before READY and serves it locally', async () => {
  const source = await readFile(serverFile, 'utf8');

  assert.match(source, /loadPinnedLarkBaseJsSdkMirror/u);
  assert.match(source, /const sdkBundle = await loadPinnedLarkBaseJsSdkMirror\(\);/u);
  assert.match(source, /path === '\/lark-base-js-sdk\.mjs'/u);
  assert.match(source, /sdkDeliveryMode: sdkBundle\.deliveryMode/u);
  assert.match(source, /sdkModuleCount: sdkBundle\.moduleCount/u);
  assert.match(source, /stage=html-executed/u);
  assert.doesNotMatch(source, /esm\.sh\/@lark-base-open\/js-sdk/u);
  assert.doesNotMatch(source, /loadPinnedLarkBaseJsSdk\(/u);
  assert.doesNotMatch(source, /CUSTOMER_BASE_VIEW_UI_SDK_NOT_STANDALONE/u);

  const resolveIndex = source.indexOf('const sdkBundle = await loadPinnedLarkBaseJsSdkMirror();');
  const listenIndex = source.indexOf('server.listen(port, host');
  assert.ok(resolveIndex >= 0 && listenIndex > resolveIndex, 'SDK bundle must resolve before the server can report READY');
});

test('View UI semantic runner never mutates cosmetic row height or column width', async () => {
  const source = await readFile(browserFile, 'utf8');

  assert.match(source, /กำลังจัด sort \/ group/u);
  assert.match(source, /getSortInfo/u);
  assert.match(source, /addSort/u);
  assert.match(source, /getGroupInfo/u);
  assert.match(source, /addGroup/u);
  assert.doesNotMatch(source, /setRowHeight/u);
  assert.doesNotMatch(source, /setFieldWidth/u);
  assert.doesNotMatch(source, /getFieldWidth/u);
  assert.match(source, /ignoredCosmetic/u);
  assert.match(source, /non-authoritative presentation only/u);
});
