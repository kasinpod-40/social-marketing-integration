import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_K2_PREVIEW_ALIAS_READINESS,
  classifyMetaK2PreviewAliasReadiness,
  shouldGuardMetaK2ContinuationFetch,
  waitForAttestedMetaK2PreviewAlias,
} from '../../scripts/lib/meta-k2-preview-alias-readiness.js';
import {
  META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';

const URL =
  'https://meta-k2-recovery-abc123-social-mkt-sync-worker.integration-workspace.workers.dev/operator/meta/d1-only-partial-staging-continuation';
const ENV = {
  [META_K2_PREVIEW_ALIAS_READINESS.envName]:
    META_K2_PREVIEW_ALIAS_READINESS.value,
  MKT_META_K2_PREVIEW_ALIAS: 'meta-k2-recovery-abc123',
  MKT_META_K2_PREVIEW_SUBDOMAIN: 'integration-workspace',
};
const VERSION = '11111111-1111-4111-8111-111111111111';
const ATTESTATION = 'a'.repeat(64);

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function unauthorizedBody(overrides = {}) {
  return {
    ok: false,
    stage: 'meta-exact-operation-continuation',
    phase: null,
    error: 'Unauthorized',
    code: 'META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED',
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
    larkWriteEnabled: false,
    scheduleEnabled: false,
    production: false,
    ...overrides,
  };
}

test('guards only the exact aliased continuation request with the real token', () => {
  assert.equal(shouldGuardMetaK2ContinuationFetch(URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${'r'.repeat(48)}` },
  }, ENV), true);
  assert.equal(shouldGuardMetaK2ContinuationFetch(URL, {
    method: 'POST',
    headers: { authorization: 'Bearer meta-k2-safe-preview-probe-only' },
  }, ENV), false);
  assert.equal(shouldGuardMetaK2ContinuationFetch(
    URL.replace('/operator/meta/', '/operator/other/'),
    { method: 'POST', headers: { authorization: `Bearer ${'r'.repeat(48)}` } },
    ENV,
  ), false);
});

test('accepts only an exact non-mutating unauthorized response with attested headers', () => {
  const accepted = classifyMetaK2PreviewAliasReadiness({
    status: 401,
    body: unauthorizedBody(),
    headers: new Headers({
      [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: ATTESTATION,
      'x-mkt-worker-version-id': VERSION,
    }),
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.directUseCaseInvocationCount, 0);
  assert.match(accepted.attestationFingerprint, /^[0-9a-f]{64}$/u);
  assert.match(accepted.workerVersionFingerprint, /^[0-9a-f]{64}$/u);

  for (const input of [
    { status: 400, body: { ...unauthorizedBody(), code: 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID' } },
    { status: 401, body: unauthorizedBody({ directUseCaseInvocationCount: 1 }) },
    { status: 401, body: unauthorizedBody(), headers: { 'x-mkt-worker-version-id': VERSION } },
  ]) {
    assert.equal(classifyMetaK2PreviewAliasReadiness(input).accepted, false);
  }
});

test('waits through stale Safe alias responses and accepts the attested Active alias', async () => {
  const calls = [];
  const responses = [
    response(400, {
      ok: false,
      stage: 'meta-exact-operation-continuation',
      phase: null,
      code: 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
      larkWriteEnabled: false,
      scheduleEnabled: false,
      production: false,
    }),
    response(401, unauthorizedBody(), {
      [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: ATTESTATION,
      'x-mkt-worker-version-id': VERSION,
    }),
  ];
  const result = await waitForAttestedMetaK2PreviewAlias({
    url: URL,
    delays: [0, 0],
    sleep: async () => {},
    fetchImpl: async (_url, init) => {
      calls.push(init);
      return responses.shift();
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.directUseCaseInvocationCount, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.headers.authorization.startsWith(
    'Bearer meta-k2-alias-readiness-',
  )));
});

test('fails closed when the alias never attests an Active Preview version', async () => {
  await assert.rejects(
    waitForAttestedMetaK2PreviewAlias({
      url: URL,
      delays: [0, 0],
      sleep: async () => {},
      fetchImpl: async () => response(400, {
        ok: false,
        stage: 'meta-exact-operation-continuation',
        phase: null,
        code: 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
        directUseCaseInvocationCount: 0,
        queueMessageCount: 0,
        queueOperationAttemptMutationCount: 0,
        larkWriteEnabled: false,
        scheduleEnabled: false,
        production: false,
      }),
    }),
    (error) => error.code === 'META_K2_PREVIEW_ALIAS_READINESS_TIMEOUT'
      && error.details.directUseCaseInvocationCount === 0
      && error.details.remoteMutationCount === 0,
  );
});
