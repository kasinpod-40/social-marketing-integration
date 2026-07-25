import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('release examples declare provisioning separately and keep it disabled without embedding the Secret', async () => {
  const [wrangler, devVars] = await Promise.all([
    readFile(new URL('../../wrangler.example.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../../.dev.vars.example', import.meta.url), 'utf8'),
  ]);
  for (const source of [wrangler, devVars]) {
    assert.match(source, /MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED["=:\s]+false/u);
  }
  assert.doesNotMatch(
    wrangler,
    /"MKT_GOOGLE_ADS_SIGNING_SECRET"\s*:/u,
  );
  assert.match(devVars, /MKT_GOOGLE_ADS_SIGNING_SECRET=replace-with-256-bit-google-ads-signing-secret/u);
});
