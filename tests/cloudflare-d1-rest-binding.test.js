import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudflareD1RestBinding } from '../scripts/lib/cloudflare-d1-rest-binding.js';

test('CloudflareD1RestBinding sends parameterized raw batches and exposes D1 binding results', async () => {
  const calls = [];
  const db = new CloudflareD1RestBinding({
    accountId: 'account',
    databaseId: 'database',
    tokenProvider: async () => 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            result: [{ success: true, results: { columns: ['value'], rows: [[7]] }, meta: { changes: 1 } }],
          };
        },
      };
    },
  });
  const result = await db.prepare('SELECT ? AS value').bind(7).first();
  assert.deepEqual(result, { value: 7 });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    batch: [{ sql: 'SELECT ? AS value', params: [7] }],
  });
  assert.doesNotMatch(calls[0].options.body, /token/u);
});
