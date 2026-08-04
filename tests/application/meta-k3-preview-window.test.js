import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_K3_PREVIEW_ALIAS_READINESS,
  META_K3_SAFE_PREVIEW_PROBE_TOKEN,
  classifyMetaK3PreviewAliasReadiness,
  shouldGuardMetaK3PreviewFetch,
  waitForAttestedMetaK3PreviewAlias,
  waitForMetaK3SafePreviewRoute,
} from '../../scripts/lib/meta-k3-preview-alias-readiness.js';
import {
  META_K3_PREVIEW_WINDOW_CONFIRMATION,
  assertMetaK3PreviewWindowConfirmation,
  validateMetaK3SafeRouteProbe,
} from '../../scripts/lib/meta-k3-preview-window.js';

const recoveryUrl =
  'https://meta-k3-recovery-social-mkt-sync-worker.example.workers.dev/operator/meta/k3-exact-partial-staging-continuation';
const expectedAttestation = 'a'.repeat(64);
const expectedVersionId = '123e4567-e89b-42d3-a456-426614174000';

test('K3 Preview window requires its exact one-shot confirmation', () => {
  assert.throws(
    () => assertMetaK3PreviewWindowConfirmation({}),
    (error) => error.code === 'META_K3_PREVIEW_WINDOW_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertMetaK3PreviewWindowConfirmation({
    [META_K3_PREVIEW_WINDOW_CONFIRMATION.envName]:
      META_K3_PREVIEW_WINDOW_CONFIRMATION.value,
  }), true);
});

test('K3 safe probe proves the dedicated handler without Business invocation', () => {
  assert.deepEqual(validateMetaK3SafeRouteProbe({
    status: 400,
    redirected: false,
    body: safeProbeBody(),
  }), {
    accepted: true,
    status: 400,
    responseStage: 'meta-exact-operation-continuation',
    responseCode: 'META_K3_RECOVERY_CONFIG_INVALID',
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
    scheduleEnabled: false,
    production: false,
  });
});

test('K3 safe probe blocks the exact retained HTTP 404 failure before finalizer', () => {
  assert.throws(
    () => validateMetaK3SafeRouteProbe({
      status: 404,
      redirected: false,
      body: {
        ok: false,
        code: 'META_K3_PREVIEW_ROUTE_NOT_FOUND',
        queueMessageCount: 0,
        scheduleEnabled: false,
        production: false,
      },
    }),
    (error) => error.code === 'META_K3_PREVIEW_SAFE_ROUTE_PROBE_FAILED'
      && error.details?.status === 404,
  );
});

test('K3 readiness hook guards only the exact Preview continuation requests', () => {
  const env = {
    [META_K3_PREVIEW_ALIAS_READINESS.envName]:
      META_K3_PREVIEW_ALIAS_READINESS.value,
  };
  assert.equal(shouldGuardMetaK3PreviewFetch(recoveryUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${META_K3_SAFE_PREVIEW_PROBE_TOKEN}` },
  }, env), true);
  assert.equal(shouldGuardMetaK3PreviewFetch(recoveryUrl, {
    method: 'GET',
    headers: { authorization: `Bearer ${META_K3_SAFE_PREVIEW_PROBE_TOKEN}` },
  }, env), false);
  assert.equal(shouldGuardMetaK3PreviewFetch(
    'https://example.com/operator/meta/k3-exact-partial-staging-continuation',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${META_K3_SAFE_PREVIEW_PROBE_TOKEN}` },
    },
    env,
  ), true);
});

test('K3 Safe Preview readiness absorbs transient 404 before returning the exact handler response', async () => {
  let callCount = 0;
  const ready = await waitForMetaK3SafePreviewRoute({
    fetchImpl: async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse(404, {
          ok: false,
          code: 'META_K3_PREVIEW_ROUTE_NOT_FOUND',
          queueMessageCount: 0,
          scheduleEnabled: false,
          production: false,
        });
      }
      return jsonResponse(400, safeProbeBody());
    },
    requestInput: recoveryUrl,
    requestInit: {
      method: 'POST',
      headers: { authorization: `Bearer ${META_K3_SAFE_PREVIEW_PROBE_TOKEN}` },
      body: '{}',
    },
    delays: [0, 0],
    sleep: async () => {},
  });

  assert.equal(callCount, 2);
  assert.equal(ready.response.status, 400);
  assert.equal(ready.result.accepted, true);
  assert.equal(ready.result.attemptCount, 2);
  assert.equal(ready.result.directUseCaseInvocationCount, 0);
  assert.equal(ready.result.remoteMutationCount, 0);
});

test('K3 Active Preview readiness requires exact attestation and Worker version before POST', async () => {
  assert.deepEqual(classifyMetaK3PreviewAliasReadiness({
    status: 204,
    headers: new Headers({
      'x-mkt-meta-partial-staging-attestation': expectedAttestation,
      'x-mkt-worker-version-id': expectedVersionId,
    }),
    expectedAttestation,
    expectedVersionId,
  }), {
    accepted: true,
    status: 204,
    attestationMatches: true,
    workerVersionMatches: true,
    attestationFingerprint:
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    workerVersionFingerprint:
      '986c0dc956dc822b5d8f698661b9eb1ef59bd0eb676c9ce9bd3f333a19cf8c81',
  });

  let callCount = 0;
  const ready = await waitForAttestedMetaK3PreviewAlias({
    fetchImpl: async (_url, init) => {
      callCount += 1;
      assert.equal(init.method, 'HEAD');
      if (callCount === 1) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 204,
        headers: {
          'x-mkt-meta-partial-staging-attestation': expectedAttestation,
          'x-mkt-worker-version-id': expectedVersionId,
        },
      });
    },
    url: recoveryUrl,
    token: 'real-ephemeral-token',
    expectedAttestation,
    expectedVersionId,
    delays: [0, 0],
    sleep: async () => {},
  });

  assert.equal(callCount, 2);
  assert.equal(ready.accepted, true);
  assert.equal(ready.attemptCount, 2);
  assert.equal(ready.directUseCaseInvocationCount, 0);
  assert.equal(ready.remoteMutationCount, 0);
});

function safeProbeBody() {
  return {
    ok: false,
    stage: 'meta-exact-operation-continuation',
    code: 'META_K3_RECOVERY_CONFIG_INVALID',
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
    scheduleEnabled: false,
    production: false,
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
