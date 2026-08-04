import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_K3_PREVIEW_WINDOW_CONFIRMATION,
  assertMetaK3PreviewWindowConfirmation,
  validateMetaK3SafeRouteProbe,
} from '../../scripts/lib/meta-k3-preview-window.js';

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
    body: {
      ok: false,
      stage: 'meta-exact-operation-continuation',
      code: 'META_K3_RECOVERY_CONFIG_INVALID',
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
      scheduleEnabled: false,
      production: false,
    },
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
