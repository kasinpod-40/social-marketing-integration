import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWranglerOAuthEnvironment } from '../../scripts/lib/cloudflare-auth-environment.js';

test('Wrangler OAuth environment removes only the Queue API token override', () => {
  const source = Object.freeze({
    CLOUDFLARE_API_TOKEN: 'queue-api-token',
    CLOUDFLARE_ACCOUNT_ID: '20a3e747a98351d98bcd7e32e6ddb282',
    WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    PATH: '/usr/bin',
  });

  const result = buildWranglerOAuthEnvironment(source);

  assert.equal(result.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(result.CLOUDFLARE_ACCOUNT_ID, source.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(result.WRANGLER_CONFIG, source.WRANGLER_CONFIG);
  assert.equal(result.PATH, source.PATH);
  assert.equal(source.CLOUDFLARE_API_TOKEN, 'queue-api-token');
  assert.notEqual(result, source);
});
