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
  assert.match(source, /'--strict'/u);
  assert.match(source, /secret-bootstrap\.attempt\.json/u);
  assert.match(source, /assertRemoteWorkerAllFlagsFalse/u);
  assert.match(source, /controllerResume/u);
  assert.match(source, /activeVersionVerification:\s*'exact_controller_resume'/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_RESUME_BLOCKED/u);
  assert.match(source, /CHATWOOT_API_ACCESS_TOKEN/u);
  assert.match(source, /name !== 'CHATWOOT_API_ACCESS_TOKEN'/u);
  assert.match(source, /serializeChatwootFinalSecretsFile/u);
  assert.match(source, /finally\s*\{[\s\S]*rm\(secretFilePath/u);
  assert.doesNotMatch(source, /wrangler['"],\s*'secret',\s*'put'/u);
  assert.doesNotMatch(source, /CHATWOOT_API_TOKEN/u);
  assert.doesNotMatch(source, /production:\s*true/u);
});

test('controller resume verifies existing Secret names without a bootstrap deployment', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-final-30d-daily-uat-launcher.mjs', import.meta.url),
    'utf8',
  );
  const resumeStart = source.indexOf('if (controllerResume) {');
  const ordinaryStart = source.indexOf(
    'const safeVersionBefore = assertRemoteWorkerAllFlagsFalse',
    resumeStart,
  );
  assert.ok(resumeStart >= 0);
  assert.ok(ordinaryStart > resumeStart);
  const resumeBranch = source.slice(resumeStart, ordinaryStart);
  assert.match(resumeBranch, /readWorkerSecretNames/u);
  assert.match(resumeBranch, /assertChatwootFinalWorkerSecrets/u);
  assert.match(resumeBranch, /remoteMutationCount:\s*0/u);
  assert.doesNotMatch(resumeBranch, /wrangler', 'deploy/u);
  assert.doesNotMatch(resumeBranch, /sourceEnv\.CHATWOOT_API_ACCESS_TOKEN/u);
});
