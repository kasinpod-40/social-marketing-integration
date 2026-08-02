import {
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONTRACT_VERSION,
  LARK_NATIVE_AI_SCHEMA_APPLY_MAX_REMOTE_WRITE_REQUESTS,
} from '../../packages/config/src/lark-native-ai-schema-apply-contract.js';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const FIELDS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields$/u;
const FIELD_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields\/[^/]+$/u;
const VIEWS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views$/u;
const VIEW_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views\/[^/]+$/u;
const MAX_SAFE_MESSAGE_LENGTH = 500;

export {
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONTRACT_VERSION,
  LARK_NATIVE_AI_SCHEMA_APPLY_MAX_REMOTE_WRITE_REQUESTS,
};

export function parseLarkNativeAiSchemaApplyArgs(args = []) {
  let execute = false;
  for (const raw of args) {
    const argument = String(raw ?? '').trim();
    if (argument === '--execute') {
      execute = true;
      continue;
    }
    if (argument !== '') {
      throw schemaApplyError(
        `Unsupported Lark Native AI schema Apply argument: ${argument}`,
        'LARK_NATIVE_AI_SCHEMA_APPLY_ARGUMENT_UNSUPPORTED',
      );
    }
  }
  return Object.freeze({ execute });
}

export function assertLarkNativeAiSchemaApplyConfirmation(env = {}) {
  if (env.CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY
    !== LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION) {
    throw schemaApplyError(
      `Execution requires CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY=${LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION}`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function requireLarkNativeAiSchemaApplyReviewedHead(value) {
  return requireCommitSha(value, 'MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD');
}

export function assertLarkNativeAiSchemaApplyRepository(repository) {
  const source = requireObject(repository, 'repository');
  if (source.branch !== 'main') {
    throw schemaApplyError(
      'Lark Native AI schema Apply must run from main',
      'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_BRANCH_INVALID',
      { observed: source.branch ?? null },
    );
  }
  if (source.clean !== true) {
    throw schemaApplyError(
      'Lark Native AI schema Apply requires a clean repository',
      'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_DIRTY',
    );
  }
  const head = requireCommitSha(source.head, 'repository.head');
  const reviewedHead = requireCommitSha(source.reviewedHead, 'repository.reviewedHead');
  if (head !== reviewedHead) {
    throw schemaApplyError(
      'Lark Native AI schema Apply Head does not match the reviewed Head',
      'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_HEAD_NOT_REVIEWED',
      { head, reviewedHead },
    );
  }
  return Object.freeze({ branch: 'main', head, reviewedHead, clean: true });
}

/**
 * Guard the exact additive schema HTTP surface.
 *
 * Allowed:
 * - POST tenant token;
 * - GET table/field/view metadata;
 * - POST Field create;
 * - PUT Field update;
 * - POST View create;
 * - PATCH View update.
 *
 * Table writes, Field/View delete, Record access, Automation, notification and AI are blocked.
 */
export function createLarkNativeAiSchemaApplyFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    tokenRequestCount: 0,
    metadataReadCount: 0,
    fieldCreateCount: 0,
    fieldUpdateCount: 0,
    viewCreateCount: 0,
    viewUpdateCount: 0,
    blockedRequestCount: 0,
  };

  const guardedFetch = async (input, init = {}) => {
    const url = new URL(resolveRequestUrl(input));
    const method = String(init?.method ?? requestMethod(input) ?? 'GET').toUpperCase();
    const path = url.pathname;
    let counter = null;

    if (method === 'POST' && path === AUTH_PATH) counter = 'tokenRequestCount';
    else if (method === 'GET' && (
      TABLES_PATH.test(path)
      || FIELDS_PATH.test(path)
      || VIEWS_PATH.test(path)
      || VIEW_PATH.test(path)
    )) counter = 'metadataReadCount';
    else if (method === 'POST' && FIELDS_PATH.test(path)) counter = 'fieldCreateCount';
    else if (method === 'PUT' && FIELD_PATH.test(path)) counter = 'fieldUpdateCount';
    else if (method === 'POST' && VIEWS_PATH.test(path)) counter = 'viewCreateCount';
    else if (method === 'PATCH' && VIEW_PATH.test(path)) counter = 'viewUpdateCount';

    if (!counter) {
      counters.blockedRequestCount += 1;
      throw schemaApplyError(
        'Lark Native AI schema Apply blocked a request outside the additive allowlist',
        'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_BLOCKED',
        { method, requestClass: classifyRequest(path) },
      );
    }

    if (counter.endsWith('Count') && counter !== 'metadataReadCount'
      && counter !== 'tokenRequestCount' && counter !== 'blockedRequestCount') {
      const nextWrites = totalWriteCount(counters) + 1;
      if (nextWrites > LARK_NATIVE_AI_SCHEMA_APPLY_MAX_REMOTE_WRITE_REQUESTS) {
        counters.blockedRequestCount += 1;
        throw schemaApplyError(
          'Lark Native AI schema Apply exceeded the accepted Remote write ceiling',
          'LARK_NATIVE_AI_SCHEMA_APPLY_WRITE_LIMIT_EXCEEDED',
          {
            observed: nextWrites,
            maximum: LARK_NATIVE_AI_SCHEMA_APPLY_MAX_REMOTE_WRITE_REQUESTS,
          },
        );
      }
    }

    counters[counter] += 1;
    return fetchImpl(input, init);
  };

  return Object.freeze({
    fetchImpl: guardedFetch,
    snapshot: () => {
      const snapshot = {
        ...counters,
        totalWriteCount: totalWriteCount(counters),
      };
      return Object.freeze(snapshot);
    },
  });
}

export function assertLarkNativeAiSchemaApplyRemoteCounters(value) {
  const counters = requireObject(value, 'remoteCounters');
  if (Number(counters.blockedRequestCount) !== 0) {
    throw schemaApplyError(
      'Schema Apply request guard recorded a blocked request',
      'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_GUARD_DRIFT',
      { blockedRequestCount: Number(counters.blockedRequestCount) },
    );
  }
  const writes = Number(counters.totalWriteCount);
  if (!Number.isSafeInteger(writes)
    || writes < 0
    || writes > LARK_NATIVE_AI_SCHEMA_APPLY_MAX_REMOTE_WRITE_REQUESTS) {
    throw schemaApplyError(
      'Schema Apply Remote write count is outside the accepted bound',
      'LARK_NATIVE_AI_SCHEMA_APPLY_WRITE_COUNT_INVALID',
      {
        observed: writes,
        maximum: LARK_NATIVE_AI_SCHEMA_APPLY_MAX_REMOTE_WRITE_REQUESTS,
      },
    );
  }
  for (const [field, maximum] of Object.entries({
    fieldCreateCount: 23,
    fieldUpdateCount: 2,
    viewCreateCount: 6,
    viewUpdateCount: 5,
  })) {
    const observed = Number(counters[field]);
    if (!Number.isSafeInteger(observed) || observed < 0 || observed > maximum) {
      throw schemaApplyError(
        `Schema Apply ${field} exceeds the accepted bound`,
        'LARK_NATIVE_AI_SCHEMA_APPLY_WRITE_COUNT_INVALID',
        { field, observed, maximum },
      );
    }
  }
  return true;
}

export function sanitizeLarkNativeAiSchemaApplyValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeLarkNativeAiSchemaApplyValue);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return sanitizeLarkNativeAiSchemaApplyMessage(value);
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|cookie|password|table.?id|field.?id|view.?id|app.?id|raw.?url)/iu.test(key))
    .map(([key, nested]) => [key, sanitizeLarkNativeAiSchemaApplyValue(nested)]));
}

export function sanitizeLarkNativeAiSchemaApplyMessage(error) {
  const value = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return value
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s]+/giu, '[URL_REDACTED]')
    .replace(/\b(?:cli_|bascn|tbl|fld|vew)[A-Za-z0-9_-]{8,}\b/gu, '[ID_REDACTED]')
    .slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

export function schemaApplyError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiSchemaApplyError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function totalWriteCount(counters) {
  return Number(counters.fieldCreateCount)
    + Number(counters.fieldUpdateCount)
    + Number(counters.viewCreateCount)
    + Number(counters.viewUpdateCount);
}

function resolveRequestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url;
  throw new TypeError('Lark schema Apply fetch guard requires a URL');
}

function requestMethod(input) {
  return input && typeof input.method === 'string' ? input.method : null;
}

function classifyRequest(path) {
  if (path === AUTH_PATH) return 'auth';
  if (path.includes('/records')) return 'records';
  if (path.includes('/fields')) return 'fields';
  if (path.includes('/views')) return 'views';
  if (path.includes('/tables')) return 'tables';
  if (path.includes('/automations')) return 'automation';
  return 'other';
}

function requireCommitSha(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw schemaApplyError(
      `${fieldName} must be an exact 40-character lowercase commit SHA`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD_REQUIRED',
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
