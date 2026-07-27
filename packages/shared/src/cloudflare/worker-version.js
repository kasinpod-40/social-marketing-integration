import { permanentError } from '../errors/runtime-error.js';

export const WORKER_VERSION_METADATA_BINDING = 'CF_VERSION_METADATA';
export const WORKER_RUNTIME_VERSION_HEADER = 'x-mkt-worker-version-id';
export const CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER = 'Cloudflare-Workers-Version-Overrides';

const WORKER_VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export function readWorkerRuntimeVersionId(env = {}, options = {}) {
  const allowMissing = options.allowMissing === true;
  const value = env?.[WORKER_VERSION_METADATA_BINDING]?.id;
  if ((value === undefined || value === null || value === '') && allowMissing) return null;
  return requireWorkerVersionId(value, 'runtimeVersionId');
}

export function addWorkerRuntimeVersionHeader(response, runtimeVersionId) {
  if (!(response instanceof Response)) {
    throw workerVersionError(
      'Worker runtime version response is invalid',
      'WORKER_RUNTIME_VERSION_RESPONSE_INVALID',
    );
  }
  if (runtimeVersionId == null) return response;
  const versionId = requireWorkerVersionId(runtimeVersionId, 'runtimeVersionId');
  const headers = new Headers(response.headers);
  headers.set(WORKER_RUNTIME_VERSION_HEADER, versionId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildWorkerVersionOverrideHeader(workerName, deploymentVersionId) {
  const name = requireWorkerName(workerName);
  const versionId = requireWorkerVersionId(deploymentVersionId, 'deploymentVersionId');
  return `${name}="${versionId}"`;
}

export function validateWorkerResponseRuntimeVersion(response, expectedVersionId, options = {}) {
  const errorCode = options.errorCode ?? 'WORKER_RUNTIME_VERSION_MISMATCH';
  const expected = requireWorkerVersionId(expectedVersionId, 'expectedVersionId');
  const observedRaw = response instanceof Response
    ? response.headers.get(WORKER_RUNTIME_VERSION_HEADER)
    : null;
  const observed = isWorkerVersionId(observedRaw) ? observedRaw : null;
  if (observed !== expected) {
    throw workerVersionError(
      'Worker response runtime version did not match the exact deployment',
      errorCode,
      {
        expectedVersionId: expected,
        observedVersionId: observed,
        safeCloseRequired: options.safeCloseRequired === true,
      },
    );
  }
  return expected;
}

export function isWorkerVersionId(value) {
  return WORKER_VERSION_ID_PATTERN.test(value ?? '');
}

export function requireWorkerVersionId(value, fieldName = 'workerVersionId') {
  if (!isWorkerVersionId(value)) {
    throw workerVersionError(
      `${fieldName} must be a Worker version UUID`,
      'WORKER_RUNTIME_VERSION_INVALID',
      { fieldName },
    );
  }
  return value;
}

export function requireWorkerName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw workerVersionError(
      'workerName is invalid',
      'WORKER_RUNTIME_VERSION_INVALID',
      { fieldName: 'workerName' },
    );
  }
  return name;
}

function workerVersionError(message, code, details = {}) {
  return permanentError(message, {
    code,
    details: Object.freeze({ ...details }),
  });
}
