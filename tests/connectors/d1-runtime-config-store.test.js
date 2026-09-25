import test from 'node:test';
import assert from 'node:assert/strict';
import { D1RuntimeConfigStore } from '../../packages/connectors/src/d1-runtime-config-store.js';

test('D1 runtime config store returns allowlisted customer rows', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...values) { call.bindings = values; return this; },
        async all() {
          return { results: [{
            config_key: 'LARK_TABLE_MKT_ADS_DAILY',
            config_value: 'tbl-ads-daily',
            source: 'wrangler_cutover',
            updated_at: 1000,
          }] };
        },
      };
    },
  };
  const store = new D1RuntimeConfigStore({ db });
  const rows = await store.list({ environment: 'production', customerKey: 'chemistry_k' });
  assert.deepEqual(rows, [{
    configKey: 'LARK_TABLE_MKT_ADS_DAILY',
    configValue: 'tbl-ads-daily',
    source: 'wrangler_cutover',
    updatedAt: 1000,
  }]);
  assert.deepEqual(calls[0].bindings, ['production', 'chemistry_k']);
});
