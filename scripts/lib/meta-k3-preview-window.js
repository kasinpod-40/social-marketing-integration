import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_K3_PREVIEW_WINDOW_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_K3_PREVIEW_RECOVERY',
  value: 'RUN_EXACT_META_K3_PREVIEW_RECOVERY',
});

export function assertMetaK3PreviewWindowConfirmation(env = {}) {
  const expected = META_K3_PREVIEW_WINDOW_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw previewWindowError(
      `K3 Preview recovery requires ${expected.envName}=${expected.value}`,
      'META_K3_PREVIEW_WINDOW_CONFIRMATION_REQUIRED',
      { fieldName: expected.envName },
    );
  }
  return true;
}

/**
 * The all-false Preview bootstrap deliberately omits ephemeral continuation credentials.
 * Reaching the dedicated K3 handler must therefore return its exact configuration error.
 * A generic 404 proves that Preview ingress or the dedicated entrypoint is unavailable and
 * blocks the Active D1/Lark finalizer before any Business mutation.
 */
export function validateMetaK3SafeRouteProbe(input = {}) {
  const body = input.body;
  const accepted = input.status === 400
    && input.redirected === false
    && body?.ok === false
    && body?.stage === 'meta-exact-operation-continuation'
    && body?.code === 'META_K3_RECOVERY_CONFIG_INVALID'
    && Number(body?.directUseCaseInvocationCount) === 0
    && Number(body?.queueMessageCount) === 0
    && Number(body?.queueOperationAttemptMutationCount) === 0
    && body?.scheduleEnabled === false
    && body?.production === false;
  if (!accepted) {
    throw previewWindowError(
      'K3 all-false Preview route probe did not reach the dedicated handler',
      'META_K3_PREVIEW_SAFE_ROUTE_PROBE_FAILED',
      {
        status: Number.isInteger(input.status) ? input.status : null,
        redirected: input.redirected === true,
        responseStage: typeof body?.stage === 'string' ? body.stage : null,
        responseCode: typeof body?.code === 'string' ? body.code : null,
      },
    );
  }
  return Object.freeze({
    accepted: true,
    status: 400,
    responseStage: body.stage,
    responseCode: body.code,
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
    scheduleEnabled: false,
    production: false,
  });
}

function previewWindowError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
