import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCRIPT = new URL('../../scripts/mkt-ads-campaign-summary-retention-one-command.mjs', import.meta.url);

test('Customer PROD operator pins the reviewed Cloudflare auth profile for every Wrangler boundary', async () => {
  const source = await readFile(SCRIPT, 'utf8');
  assert.match(source, /const CLOUDFLARE_PROFILE = 'chemistry-k-prod';/u);
  assert.match(source, /'auth', 'token', '--json', '--profile', CLOUDFLARE_PROFILE/u);
  assert.match(source, /'versions', 'upload',[\s\S]*?'--profile', CLOUDFLARE_PROFILE/u);
  assert.match(source, /'deployments', 'status',[\s\S]*?'--profile', CLOUDFLARE_PROFILE/u);
});
