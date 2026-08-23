import test from 'node:test';
import assert from 'node:assert/strict';
import { readWranglerScalarVars } from '../../scripts/lib/wrangler-jsonc-vars.js';

test('reads scalar Wrangler vars through comments, URLs, and trailing commas', () => {
  const vars = readWranglerScalarVars(`{
    // runtime vars
    "vars": {
      "MKT_ENV": "development",
      "MKT_CONNECTION_PUBLIC_ORIGIN": "https://example.com/a//b",
      "LARK_TABLE_MKT_ADS_CREATIVES": "tbl_creatives",
      "LARK_TABLE_MKT_ADS_DAILY": "tbl_daily", // keep
      "BOOL_VALUE": false,
      "NUMBER_VALUE": 12,
    },
  }`);
  assert.equal(vars.MKT_ENV, 'development');
  assert.equal(vars.MKT_CONNECTION_PUBLIC_ORIGIN, 'https://example.com/a//b');
  assert.equal(vars.LARK_TABLE_MKT_ADS_CREATIVES, 'tbl_creatives');
  assert.equal(vars.LARK_TABLE_MKT_ADS_DAILY, 'tbl_daily');
  assert.equal(vars.BOOL_VALUE, 'false');
  assert.equal(vars.NUMBER_VALUE, '12');
});

test('ignores nested Wrangler vars because process env must remain scalar', () => {
  const vars = readWranglerScalarVars(`{
    "vars": {
      "SCALAR": "ok",
      "NESTED": { "value": "not-env" },
      "LIST": [1, 2, 3]
    }
  }`);
  assert.deepEqual(vars, { SCALAR: 'ok' });
});

test('fails closed on malformed or unterminated JSONC', () => {
  assert.throws(
    () => readWranglerScalarVars('{ "vars": { "MKT_ENV": "development" '),
    (error) => error?.code === 'WRANGLER_JSONC_VARS_PARSE_FAILED',
  );
  assert.throws(
    () => readWranglerScalarVars('{ /* no end '),
    (error) => error?.code === 'WRANGLER_JSONC_VARS_PARSE_FAILED',
  );
});
