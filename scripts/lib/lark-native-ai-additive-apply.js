export const LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION = 'APPLY_LARK_NATIVE_AI_ADDITIVE_SCHEMA';
export const LARK_NATIVE_AI_SCHEMA_APPLY_TERMINAL_VERSION = 'lark_native_ai_additive_apply_reviewed_terminal_v1';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const FIELDS_COLLECTION_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields$/u;
const FIELD_ITEM_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields\/[^/]+$/u;
const VIEWS_COLLECTION_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views$/u;
const VIEW_ITEM_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views\/[^/]+$/u;

export function parseLarkNativeAiSchemaApplyArgs(args) {
  const values = Array.isArray(args) ? args : [];
  let execute = false;
  for (const value of values) {
    if (value === '--execute') execute = true;
    else if (value === '--apply') throw schemaApplyError(
      'Use --execute with the exact explicit confirmation; --apply is not accepted',
      'LARK_NATIVE_AI_SCHEMA_APPLY_ARGUMENT_INVALID',
    );
    else throw schemaApplyError(
      `Unknown argument: ${value}`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_ARGUMENT_INVALID',
    );
  }
  return Object.freeze({ execute });
}

export function assertLarkNativeAiSchemaApplyConfirmation(env) {
  if (env?.CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY !== LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION) {
    throw schemaApplyError(
      `Execution requires CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY=${LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION}`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION_REQUIRED',
    );
  }
}

export function requireExactSha(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{40}$/u.test(text)) throw schemaApplyError(
    `${fieldName} must be an exact lowercase 40-character commit SHA`,
    'LARK_NATIVE_AI_SCHEMA_APPLY_SHA_REQUIRED',
    { fieldName },
  );
  return text;
}

export function requireSha256(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{64}$/u.test(text)) throw schemaApplyError(
    `${fieldName} must be an exact lowercase SHA-256`,
    'LARK_NATIVE_AI_SCHEMA_APPLY_HASH_REQUIRED',
    { fieldName },
  );
  return text;
}

export function assertLarkNativeAiSchemaApplyRepository(repository) {
  if (repository?.branch !== 'main') throw schemaApplyError(
    'Lark Native AI Schema Apply must run from main',
    'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_BRANCH_INVALID',
    { observed: repository?.branch ?? null },
  );
  if (repository?.clean !== true) throw schemaApplyError(
    'Lark Native AI Schema Apply requires a clean repository',
    'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_DIRTY',
  );
  if (repository?.head !== repository?.reviewedHead) throw schemaApplyError(
    'Repository Head does not match the reviewed Apply Head',
    'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_HEAD_NOT_REVIEWED',
    { head: repository?.head ?? null, reviewedHead: repository?.reviewedHead ?? null },
  );
  if (repository?.evidenceHeadAncestor !== true) throw schemaApplyError(
    'Remote inventory evidence Head is not an ancestor of the reviewed Apply Head',
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_HEAD_NOT_ANCESTOR',
  );
  return Object.freeze({ ...repository });
}

/**
 * Permit only the exact Lark authentication, metadata reads and additive Field/View writes.
 * Record routes, table mutation, delete methods, Automation, AI and notification routes are blocked.
 */
export function createLarkNativeAiSchemaApplyFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counts = {
    tokenRequestCount: 0,
    metadataReadCount: 0,
    fieldCreateCount: 0,
    fieldUpdateCount: 0,
    viewCreateCount: 0,
    viewUpdateCount: 0,
    blockedRequestCount: 0,
  };

  const guardedFetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input?.url);
    const method = String(init?.method ?? (typeof input === 'object' ? input?.method : 'GET') ?? 'GET').toUpperCase();
    const path = url.pathname;
    const queryKeys = [...url.searchParams.keys()];
    const paginationOnly = queryKeys.every((key) => ['page_size', 'page_token'].includes(key));
    let allowed = false;

    if (url.origin === 'https://open.larksuite.com' && method === 'POST' && path === AUTH_PATH && queryKeys.length === 0) {
      counts.tokenRequestCount += 1;
      allowed = true;
    } else if (url.origin === 'https://open.larksuite.com' && method === 'GET' && paginationOnly
      && (TABLES_PATH.test(path) || FIELDS_COLLECTION_PATH.test(path) || VIEWS_COLLECTION_PATH.test(path))) {
      counts.metadataReadCount += 1;
      allowed = true;
    } else if (url.origin === 'https://open.larksuite.com' && method === 'GET'
      && queryKeys.length === 0 && VIEW_ITEM_PATH.test(path)) {
      counts.metadataReadCount += 1;
      allowed = true;
    } else if (url.origin === 'https://open.larksuite.com' && method === 'POST'
      && queryKeys.length === 0 && FIELDS_COLLECTION_PATH.test(path)) {
      counts.fieldCreateCount += 1;
      allowed = true;
    } else if (url.origin === 'https://open.larksuite.com' && method === 'PUT'
      && queryKeys.length === 0 && FIELD_ITEM_PATH.test(path)) {
      counts.fieldUpdateCount += 1;
      allowed = true;
    } else if (url.origin === 'https://open.larksuite.com' && method === 'POST'
      && queryKeys.length === 0 && VIEWS_COLLECTION_PATH.test(path)) {
      counts.viewCreateCount += 1;
      allowed = true;
    } else if (url.origin === 'https://open.larksuite.com' && method === 'PATCH'
      && queryKeys.length === 0 && VIEW_ITEM_PATH.test(path)) {
      counts.viewUpdateCount += 1;
      allowed = true;
    }

    if (!allowed) {
      counts.blockedRequestCount += 1;
      throw schemaApplyError(
        `Blocked non-additive Lark request: ${method} ${sanitizePath(path)}`,
        'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED',
        { method, path: sanitizePath(path) },
      );
    }
    return fetchImpl(input, init);
  };

  return Object.freeze({
    fetchImpl: guardedFetch,
    snapshot: () => Object.freeze({
      ...counts,
      schemaWriteCount: counts.fieldCreateCount + counts.fieldUpdateCount
        + counts.viewCreateCount + counts.viewUpdateCount,
      recordReadCount: 0,
      tableMutationCount: 0,
      deleteCount: 0,
    }),
  });
}

export function sanitizeLarkNativeAiSchemaApplyError(error) {
  const text = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:cli|app|tbl|fld|vew|opt)[A-Za-z0-9_-]{6,}/gu, '[REDACTED_ID]')
    .replace(/[0-9a-f]{64}/giu, '[SHA256]')
    .slice(0, 500);
}

export function schemaApplyError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiSchemaApplyTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function sanitizePath(path) {
  return String(path).replace(/\/apps\/[^/]+/u, '/apps/[APP]')
    .replace(/\/tables\/[^/]+/u, '/tables/[TABLE]')
    .replace(/\/fields\/[^/]+/u, '/fields/[FIELD]')
    .replace(/\/views\/[^/]+/u, '/views/[VIEW]');
}
