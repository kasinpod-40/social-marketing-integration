import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('public launcher stages a missing Secret only through a Safe private deployment', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-final-30d-daily-uat-launcher.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /ensureChatwootWorkerSecret/u);
  assert.match(source, /--secrets-file/u);
  assert.match(source, /secret-bootstrap\.attempt\.json/u);
  assert.match(source, /assertRemoteWorkerAllFlagsFalse/u);
  assert.match(source, /CHATWOOT_API_ACCESS_TOKEN/u);
  assert.match(source, /serializeChatwootFinalSecretsFile/u);
  assert.match(source, /finally\s*\{[\s\S]*rm\(secretFilePath/u);
  assert.doesNotMatch(source, /wrangler['"],\s*'secret',\s*'put'/u);
  assert.doesNotMatch(source, /CHATWOOT_API_TOKEN/u);
  assert.doesNotMatch(source, /production:\s*true/u);
});
