import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTrueMktExecutionFlags,
  materializeMetaPaidLarkSafeConfig,
} from '../../scripts/lib/meta-paid-lark-safe-config.js';

test('paid Meta safe config closes every declared MKT execution flag and preserves non-flag config', () => {
  const source = `{
    "name": "social-mkt-sync-worker",
    "vars": {
      "MKT_ENV": "development",
      "MKT_CONNECTOR_FACEBOOK_ENABLED": "true",
      "MKT_CONNECTOR_META_ADS_ENABLED": true,
      "MKT_META_D1_WRITE_ENABLED": "false",
      "MKT_META_LARK_WRITE_ENABLED": false,
      "MKT_SCHEDULE_META_ADS_ENABLED": "true",
      "KEEP_ME": "unchanged"
    }
  }`;
  const result = materializeMetaPaidLarkSafeConfig(source);
  assert.deepEqual(result.changedFlags, [
    'MKT_CONNECTOR_FACEBOOK_ENABLED',
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_SCHEDULE_META_ADS_ENABLED',
  ]);
  assert.deepEqual(result.remainingTrueFlags, []);
  assert.deepEqual(collectTrueMktExecutionFlags(result.text), []);
  assert.match(result.text, /"MKT_CONNECTOR_FACEBOOK_ENABLED": "false"/u);
  assert.match(result.text, /"MKT_CONNECTOR_META_ADS_ENABLED": "false"/u);
  assert.match(result.text, /"MKT_SCHEDULE_META_ADS_ENABLED": "false"/u);
  assert.match(result.text, /"KEEP_ME": "unchanged"/u);
});

test('paid Meta safe config rejects missing execution-flag declarations and empty input', () => {
  assert.throws(
    () => materializeMetaPaidLarkSafeConfig('{ "name": "worker" }'),
    (error) => error.code === 'META_PAID_LARK_SAFE_CONFIG_FLAGS_MISSING',
  );
  assert.throws(
    () => materializeMetaPaidLarkSafeConfig(''),
    (error) => error.code === 'META_PAID_LARK_SAFE_CONFIG_INPUT_INVALID',
  );
});
