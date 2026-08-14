import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { META_END_TO_END_LARK_TABLES } from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import { WOOCOMMERCE_LARK_TABLE_KEYS } from '../../packages/config/src/woocommerce-runtime-config.js';
import { CHATWOOT_LARK_TABLE_KEYS } from '../../packages/config/src/chatwoot-runtime-config.js';
import { YOUTUBE_REQUIRED_LARK_TABLE_KEYS } from '../../packages/config/src/youtube-organic-runtime-config.js';
import { YOUTUBE_LARK_SCHEMA } from '../../packages/config/src/youtube-lark-schema.js';
import { WOOCOMMERCE_LARK_TABLES } from '../../packages/application/src/commerce/woocommerce-commerce-model.js';
import { CHATWOOT_LARK_WRITE_TARGETS } from '../../packages/application/src/use-cases/prepare-chatwoot-analytics-sync.js';

const NON_TIKTOK_RAW_ENV = /LARK_TABLE_RAW_(?!TIKTOK_CREATOR_VIDEOS)/gu;

test('active connector contracts contain no non-TikTok Lark RAW destination', () => {
  const tableKeys = [
    ...META_END_TO_END_LARK_TABLES.map((entry) => entry.tableKey),
    ...WOOCOMMERCE_LARK_TABLE_KEYS,
    ...WOOCOMMERCE_LARK_TABLES.map((entry) => entry.tableKey),
    ...CHATWOOT_LARK_TABLE_KEYS,
    ...CHATWOOT_LARK_WRITE_TARGETS.map((entry) => entry.tableKey),
    ...YOUTUBE_REQUIRED_LARK_TABLE_KEYS,
  ];
  assert.equal(tableKeys.some((key) => /^raw/iu.test(key)), false);
  assert.equal(YOUTUBE_LARK_SCHEMA.length, 0);
});

test('customer config examples expose only the protected TikTok Native RAW mapping', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile('.dev.vars.example', 'utf8'),
    readFile('wrangler.sync.example.jsonc', 'utf8'),
  ]);
  assert.equal(devVars.match(NON_TIKTOK_RAW_ENV), null);
  assert.equal(wrangler.match(NON_TIKTOK_RAW_ENV), null);
  assert.match(devVars, /^LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS=/mu);
  assert.match(wrangler, /"LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS"/u);
});
