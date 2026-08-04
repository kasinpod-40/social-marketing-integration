import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  META_K2_PREVIEW_ALIAS_READINESS,
  classifyMetaK2PreviewAliasReadiness,
  resolveMetaK2PreviewAliasExpectation,
  shouldGuardMetaK2ContinuationFetch,
  waitForAttestedMetaK2PreviewAlias,
} from '../../scripts/lib/meta-k2-preview-alias-readiness.js';
import {
  META_K2_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_PHASE_ENV,
  META_K2_EXACT_RECOVERY_TOKEN_SHA256_ENV,
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
const STALE_VERSION = '22222222-2222-4222-8222-222222222222';
const ATTESTATION = 'a'.repeat(64);
const STALE_ATTESTATION = 'b'.repeat(64);
const REAL_TOKEN = `real-meta-k2-${'r'.repeat(48)}`;

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
    headers: { authorization: `Bearer ${REAL_TOKEN}` },
  }, ENV), true);
  assert.equal(shouldGuardMetaK2ContinuationFetch(URL, {
    method: 'POST',
    headers: { authorization: 'Bearer meta-k2-safe-preview-probe-only' },
  }, ENV), false);
  assert.equal(shouldGuardMetaK2ContinuationFetch(
    URL.replace('/operator/meta/', '/operator/other/'),
    { method: 'POST', headers: { authorization: `Bearer ${REAL_TOKEN}` } },
    ENV,
  ), false);
});

test('resolves the exact phase attestation and version from the active config and evidence', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'meta-k2-readiness-'));
  try {
    const recoveryRoot = join(
      repositoryRoot,
      'outputs',
      'meta-d1-only-rollout',
      META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
      META_K2_EXACT_RECOVERY_IDENTITY.operationId,
      'exact-partial-staging-recovery-v1',
    );
    await mkdir(recoveryRoot, { recursive: true });
    await writeFile(join(recoveryRoot, 'wrangler.meta-k2-d1.preview.jsonc'), JSON.stringify({
      vars: {
        [META_K2_EXACT_RECOVERY_TOKEN_SHA256_ENV]: sha256(REAL_TOKEN),
        [META_K2_EXACT_RECOVERY_ATTESTATION_ENV]: ATTESTATION,
        [META_K2_EXACT_RECOVERY_PHASE_ENV]: 'd1',
      },
    }));
    await writeFile(join(recoveryRoot, 'verify-d1-continuation.json'), JSON.stringify({
      phase: 'verify-d1-continuation',
      data: {
        activeVersion: VERSION,
        routeAttestation: ATTESTATION,
      },
    }));
    const expectation = await resolveMetaK2PreviewAliasExpectation({
      requestInput: URL,
      requestInit: {
        method: 'POST',
        headers: { authorization: `Bearer ${REAL_TOKEN}` },
      },
      repositoryRoot,
    });
    assert.equal(expectation.phase, 'd1');
    assert.equal(expectation.expectedAttestation, ATTESTATION);
    assert.equal(expectation.expectedVersionId, VERSION);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('accepts only the exact phase version and attestation with zero invocation', () => {
  const accepted = classifyMetaK2PreviewAliasReadiness({
    status: 401,
    body: unauthorizedBody(),
    headers: new Headers({
      [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: ATTESTATION,
      'x-mkt-worker-version-id': VERSION,
    }),
    expectedAttestation: ATTESTATION,
    expectedVersionId: VERSION,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.directUseCaseInvocationCount, 0);
  assert.match(accepted.attestationFingerprint, /^[0-9a-f]{64}$/u);
  assert.match(accepted.workerVersionFingerprint, /^[0-9a-f]{64}$/u);

  for (const input of [
    {
      status: 400,
      body: { ...unauthorizedBody(), code: 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID' },
      headers: {},
    },
    {
      status: 401,
      body: unauthorizedBody({ directUseCaseInvocationCount: 1 }),
      headers: {
        [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: ATTESTATION,
        'x-mkt-worker-version-id': VERSION,
      },
    },
    {
      status: 401,
      body: unauthorizedBody(),
      headers: {
        [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: STALE_ATTESTATION,
        'x-mkt-worker-version-id': STALE_VERSION,
      },
    },
  ]) {
    assert.equal(classifyMetaK2PreviewAliasReadiness({
      ...input,
      expectedAttestation: ATTESTATION,
      expectedVersionId: VERSION,
    }).accepted, false);
  }
});

test('waits through Safe and stale Active aliases until the exact phase version is attested', async () => {
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
      [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: STALE_ATTESTATION,
      'x-mkt-worker-version-id': STALE_VERSION,
    }),
    response(401, unauthorizedBody(), {
      [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: ATTESTATION,
      'x-mkt-worker-version-id': VERSION,
    }),
  ];
  const result = await waitForAttestedMetaK2PreviewAlias({
    url: URL,
    expectedAttestation: ATTESTATION,
    expectedVersionId: VERSION,
    delays: [0, 0, 0],
    sleep: async () => {},
    fetchImpl: async (_url, init) => {
      calls.push(init);
      return responses.shift();
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.attemptCount, 3);
  assert.equal(result.directUseCaseInvocationCount, 0);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.headers.authorization.startsWith(
    'Bearer meta-k2-alias-readiness-',
  )));
});

test('fails closed when the exact phase version never reaches the alias', async () => {
  await assert.rejects(
    waitForAttestedMetaK2PreviewAlias({
      url: URL,
      expectedAttestation: ATTESTATION,
      expectedVersionId: VERSION,
      delays: [0, 0],
      sleep: async () => {},
      fetchImpl: async () => response(401, unauthorizedBody(), {
        [META_K2_EXACT_RECOVERY_ATTESTATION_HEADER]: STALE_ATTESTATION,
        'x-mkt-worker-version-id': STALE_VERSION,
      }),
    }),
    (error) => error.code === 'META_K2_PREVIEW_ALIAS_READINESS_TIMEOUT'
      && error.details.directUseCaseInvocationCount === 0
      && error.details.remoteMutationCount === 0
      && error.details.attestationMatches === false
      && error.details.workerVersionMatches === false,
  );
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
