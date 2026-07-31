import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATWOOT_FINAL_SECRET_NAMES,
  assertChatwootFinalWorkerSecrets,
  parseChatwootWorkerSecretNames,
  resolveChatwootFinalSecretBootstrap,
  serializeChatwootFinalSecretsFile,
  summarizeChatwootFinalSecretPlan,
} from '../../scripts/lib/chatwoot-final-secret-bootstrap.js';

const TOKEN = 'private-chatwoot-access-token';
const EXISTING = ['LARK_APP_ID', 'LARK_APP_SECRET'];

test('existing remote Chatwoot Secret performs zero local Secret reads', () => {
  let localReads = 0;
  const plan = resolveChatwootFinalSecretBootstrap({
    remoteSecretNames: [...EXISTING, 'CHATWOOT_API_ACCESS_TOKEN'],
    readLocalAccessToken() {
      localReads += 1;
      throw new Error('must not read local Secret');
    },
  });
  assert.equal(plan.provision, false);
  assert.equal(plan.source, 'remote_existing');
  assert.equal(localReads, 0);
  assert.equal(Object.hasOwn(plan, 'secretValue'), true);
  assert.equal(Object.keys(plan).includes('secretValue'), false);
});

test('missing remote Chatwoot Secret stages only the private local value', () => {
  const plan = resolveChatwootFinalSecretBootstrap({
    remoteSecretNames: EXISTING,
    readLocalAccessToken: () => TOKEN,
  });
  assert.equal(plan.provision, true);
  assert.equal(plan.source, 'local_dev_vars_staged');
  assert.equal(plan.secretValue, TOKEN);
  assert.equal(JSON.stringify(plan).includes(TOKEN), false);
  assert.deepEqual(JSON.parse(serializeChatwootFinalSecretsFile(plan)), {
    CHATWOOT_API_ACCESS_TOKEN: TOKEN,
  });
  assert.deepEqual(summarizeChatwootFinalSecretPlan(plan), {
    provisionedByLauncher: true,
    source: 'local_dev_vars_staged',
    secretName: 'CHATWOOT_API_ACCESS_TOKEN',
    requiredSecretCount: 3,
  });
});

test('missing or placeholder local Chatwoot Secret fails before deployment', () => {
  for (const value of ['', 'replace-with-chatwoot-api-access-token']) {
    assert.throws(
      () => resolveChatwootFinalSecretBootstrap({
        remoteSecretNames: EXISTING,
        readLocalAccessToken: () => value,
      }),
      (error) => error?.code === 'CHATWOOT_FINAL_UAT_LOCAL_SECRET_MISSING'
        && !JSON.stringify(error).includes(TOKEN),
    );
  }
});

test('Lark Worker Secrets remain mandatory before bootstrap', () => {
  assert.throws(
    () => resolveChatwootFinalSecretBootstrap({
      remoteSecretNames: ['LARK_APP_ID'],
      readLocalAccessToken: () => TOKEN,
    }),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_SECRET_MISSING'
      && error.details?.missing?.includes('LARK_APP_SECRET'),
  );
});

test('Secret-list parsing and post-deploy verification are exact', () => {
  const output = JSON.stringify([
    { name: 'LARK_APP_SECRET', type: 'secret_text' },
    { name: 'CHATWOOT_API_ACCESS_TOKEN', type: 'secret_text' },
    { name: 'LARK_APP_ID', type: 'secret_text' },
  ]);
  const names = parseChatwootWorkerSecretNames(output);
  assert.deepEqual(names, [...CHATWOOT_FINAL_SECRET_NAMES].sort());
  assert.deepEqual(assertChatwootFinalWorkerSecrets(names), {
    verified: true,
    requiredSecretCount: 3,
  });
  assert.throws(
    () => assertChatwootFinalWorkerSecrets(EXISTING),
    (error) => error?.code === 'CHATWOOT_FINAL_UAT_SECRET_MISSING'
      && error.details?.missing?.includes('CHATWOOT_API_ACCESS_TOKEN'),
  );
});

test('invalid or duplicated Secret-list contracts fail closed', () => {
  for (const value of ['not-json', JSON.stringify({ result: null }), JSON.stringify([{ name: 'A' }, { name: 'A' }])]) {
    assert.throws(
      () => parseChatwootWorkerSecretNames(value),
      (error) => error?.code === 'CHATWOOT_FINAL_UAT_SECRET_LIST_INVALID',
    );
  }
});
