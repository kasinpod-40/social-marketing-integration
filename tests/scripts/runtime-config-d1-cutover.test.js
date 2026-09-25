import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeConfigCutoverPlan } from '../../scripts/lib/runtime-config-d1-cutover.js';

test('cutover moves Lark IDs plus TikTok App ID to D1 and prunes only existing safe vars', () => {
  const source = `{
    "d1_databases": [{"binding":"MKT_STATE_DB","database_name":"customer-db"}],
    "vars": {
      "MKT_ENV": "production",
      "MKT_CONNECTION_CUSTOMER_KEY": "chemistry_k",
      "LARK_TABLE_MKT_ADS_DAILY": "tbl-daily",
      "LARK_TABLE_MKT_ADS_ADS": "tbl-ads",
      "META_ACCESS_TOKEN": "must-stay-out"
    }
  }`;
  const plan = buildRuntimeConfigCutoverPlan({
    sourceText: source,
    extraValues: { TIKTOK_ADS_APP_ID: '7670007933899390993' },
    updatedAt: 1000,
  });
  assert.equal(plan.databaseName, 'customer-db');
  assert.deepEqual(plan.rows.map((row) => row.configKey), [
    'LARK_TABLE_MKT_ADS_ADS',
    'LARK_TABLE_MKT_ADS_DAILY',
    'TIKTOK_ADS_APP_ID',
  ]);
  assert.deepEqual(plan.removableKeys, [
    'LARK_TABLE_MKT_ADS_ADS',
    'LARK_TABLE_MKT_ADS_DAILY',
  ]);
  assert.doesNotMatch(plan.prunedSourceText, /LARK_TABLE_MKT_ADS_/u);
  assert.match(plan.prunedSourceText, /META_ACCESS_TOKEN/u);
  assert.doesNotMatch(plan.sql, /must-stay-out/u);
  assert.match(plan.sql, /TIKTOK_ADS_APP_ID/u);
});
