export const LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION = 'READ_LARK_NATIVE_AI_REMOTE_INVENTORY';
export const LARK_NATIVE_AI_REMOTE_INVENTORY_CONTRACT = 'lark_native_ai_remote_inventory_reviewed_terminal_v1';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const METADATA_PATHS = Object.freeze([
  /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u,
  /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/(?:fields|views)$/u,
]);
const MAX_SAFE_MESSAGE_LENGTH = 500;

export function parseLarkNativeAiRemoteInventoryArgs(args = []) {
  let execute = false;
  for (const raw of args) {
    const arg = String(raw ?? '').trim();
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--apply' || arg.startsWith('--apply=')) {
      throw remoteInventoryError(
        'Remote Lark schema Apply is not authorized by the inventory operator',
        'LARK_NATIVE_AI_SCHEMA_APPLY_NOT_AUTHORIZED',
      );
    }
    if (arg !== '') {
      throw remoteInventoryError(
        `Unsupported Lark Native AI Remote inventory argument: ${arg}`,
        'LARK_NATIVE_AI_REMOTE_INVENTORY_ARGUMENT_UNSUPPORTED',
      );
    }
  }
  return Object.freeze({ execute });
}

/**
 * Wrap fetch with an explicit network allowlist.
 *
 * Allowed:
 * - POST tenant_access_token authentication;
 * - GET tables, fields and views metadata.
 *
 * Every other path or method is rejected before the underlying fetch implementation is called.
 */
export function createLarkNativeAiReadOnlyFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    tokenRequestCount: 0,
    metadataReadCount: 0,
    blockedRequestCount: 0,
  };

  const guardedFetch = async (input, init = {}) => {
    const url = new URL(resolveRequestUrl(input));
    const method = String(init?.method ?? requestMethod(input) ?? 'GET').toUpperCase();
    const isAuth = method === 'POST' && url.pathname === AUTH_PATH;
    const isMetadataRead = method === 'GET'
      && METADATA_PATHS.some((pattern) => pattern.test(url.pathname));

    if (isAuth) counters.tokenRequestCount += 1;
    else if (isMetadataRead) counters.metadataReadCount += 1;
    else {
      counters.blockedRequestCount += 1;
      throw remoteInventoryError(
        'Lark Remote inventory blocked a non-read-only request',
        'LARK_NATIVE_AI_REMOTE_REQUEST_NOT_READ_ONLY',
        { method, requestClass: classifyRequest(url.pathname) },
      );
    }

    return fetchImpl(input, init);
  };

  return Object.freeze({
    fetchImpl: guardedFetch,
    snapshot: () => Object.freeze({ ...counters }),
  });
}

export function assertLarkNativeAiReviewedRepository(repository) {
  const source = requireObject(repository, 'repository');
  if (source.branch !== 'main') {
    throw remoteInventoryError(
      'Lark Native AI Remote inventory must run from main',
      'LARK_NATIVE_AI_REMOTE_REPOSITORY_BRANCH_INVALID',
      { observed: source.branch },
    );
  }
  if (source.clean !== true) {
    throw remoteInventoryError(
      'Lark Native AI Remote inventory requires a clean repository',
      'LARK_NATIVE_AI_REMOTE_REPOSITORY_DIRTY',
    );
  }
  const head = requireCommitSha(source.head, 'repository.head');
  const reviewedHead = requireCommitSha(source.reviewedHead, 'repository.reviewedHead');
  if (head !== reviewedHead) {
    throw remoteInventoryError(
      'Lark Native AI Remote inventory Head does not match the reviewed Head',
      'LARK_NATIVE_AI_REMOTE_REPOSITORY_HEAD_NOT_REVIEWED',
      { head, reviewedHead },
    );
  }
  return Object.freeze({ branch: 'main', head, reviewedHead, clean: true });
}

export function assertLarkNativeAiRemoteInventoryConfirmation(env) {
  if (env?.CONFIRM_LARK_NATIVE_AI_REMOTE_INVENTORY
    !== LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION) {
    throw remoteInventoryError(
      `Execution requires CONFIRM_LARK_NATIVE_AI_REMOTE_INVENTORY=${LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION}`,
      'LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION_REQUIRED',
    );
  }
}

export function requireLarkNativeAiReviewedHead(value) {
  return requireCommitSha(value, 'MKT_LARK_NATIVE_AI_REMOTE_REVIEWED_HEAD');
}

export function sanitizeLarkNativeAiRemoteErrorMessage(error) {
  const text = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return text
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s]+/giu, '[URL_REDACTED]')
    .replace(/\b(?:cli_|bascn|tbl|fld|vew)[A-Za-z0-9_-]{8,}\b/gu, '[ID_REDACTED]')
    .slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

export function remoteInventoryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiRemoteInventoryError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function resolveRequestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url;
  throw new TypeError('Lark read-only fetch guard requires a URL');
}
function requestMethod(input) {
  return input && typeof input.method === 'string' ? input.method : null;
}
function classifyRequest(pathname) {
  if (pathname === AUTH_PATH) return 'auth';
  if (pathname.includes('/fields')) return 'fields';
  if (pathname.includes('/views')) return 'views';
  if (pathname.includes('/tables')) return 'tables';
  return 'other';
}
function requireCommitSha(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw remoteInventoryError(
      `${fieldName} must be an exact 40-character lowercase commit SHA`,
      'LARK_NATIVE_AI_REMOTE_REVIEWED_HEAD_REQUIRED',
    );
  }
  return text;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
