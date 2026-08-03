import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS,
} from '../../packages/config/src/lark-native-ai-controlled-preview-live-pilot-contract.js';
import { pilotError } from '../../packages/application/src/reports/apply-lark-native-ai-controlled-preview-live-pilot.js';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const RECORD_SEARCH_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/search$/u;
const BATCH_CREATE_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/batch_create$/u;
const BATCH_UPDATE_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/batch_update$/u;

export function parseLarkNativeAiControlledPreviewLivePilotArgs(args = []) {
  let execute = false;
  for (const raw of args) {
    const argument = String(raw ?? '').trim();
    if (argument === '--execute') execute = true;
    else if (argument !== '') {
      throw pilotError(
        `Unsupported Controlled Preview Live Pilot argument: ${argument}`,
        'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_ARGUMENT_UNSUPPORTED',
      );
    }
  }
  return Object.freeze({ execute });
}

export function assertLarkNativeAiControlledPreviewLivePilotConfirmation(env = {}) {
  if (env.CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW
    !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION) {
    throw pilotError(
      `Execution requires CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW=${LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertLarkNativeAiControlledPreviewLivePilotRepository(value = {}) {
  const branch = text(value.branch);
  const head = sha(value.head);
  const reviewedHead = sha(value.reviewedHead);
  if (branch !== 'main') {
    throw pilotError(
      'Controlled Preview Live Pilot must run from main',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_MAIN_REQUIRED',
      { branch },
    );
  }
  if (value.clean !== true) {
    throw pilotError(
      'Controlled Preview Live Pilot requires a clean repository',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CLEAN_REQUIRED',
    );
  }
  if (!head || !reviewedHead || head !== reviewedHead) {
    throw pilotError(
      'Controlled Preview Live Pilot Head must equal the exact reviewed Head',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_HEAD_INVALID',
      { head, reviewedHead },
    );
  }
  return Object.freeze({ branch, clean: true, exactHeadSha: head });
}

export function createLarkNativeAiControlledPreviewLivePilotFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    tokenRequestCount: 0,
    tableReadRequestCount: 0,
    recordSearchRequestCount: 0,
    batchCreateRequestCount: 0,
    batchUpdateRequestCount: 0,
    recordCreateCount: 0,
    recordUpdateCount: 0,
    blockedRequestCount: 0,
  };

  const guardedFetch = async (input, init = {}) => {
    const url = new URL(resolveUrl(input));
    const path = url.pathname;
    const method = String(init?.method ?? requestMethod(input) ?? 'GET').toUpperCase();
    let kind = null;
    let recordRows = 0;

    if (method === 'POST' && path === AUTH_PATH) kind = 'token';
    else if (method === 'GET' && TABLES_PATH.test(path)) kind = 'table_read';
    else if (method === 'POST' && RECORD_SEARCH_PATH.test(path)) kind = 'record_search';
    else if (method === 'POST' && BATCH_CREATE_PATH.test(path)) {
      kind = 'batch_create';
      recordRows = readRecordRows(init.body);
    } else if (method === 'POST' && BATCH_UPDATE_PATH.test(path)) {
      kind = 'batch_update';
      recordRows = readRecordRows(init.body);
    }

    if (!kind) return block(method, path, 'request_outside_preview_record_allowlist');
    increment(kind, recordRows);
    assertBounds();
    return fetchImpl(input, init);
  };

  function increment(kind, recordRows) {
    if (kind === 'token') counters.tokenRequestCount += 1;
    if (kind === 'table_read') counters.tableReadRequestCount += 1;
    if (kind === 'record_search') counters.recordSearchRequestCount += 1;
    if (kind === 'batch_create') {
      counters.batchCreateRequestCount += 1;
      counters.recordCreateCount += recordRows;
    }
    if (kind === 'batch_update') {
      counters.batchUpdateRequestCount += 1;
      counters.recordUpdateCount += recordRows;
    }
  }

  function assertBounds() {
    const totalBatchRequests = counters.batchCreateRequestCount + counters.batchUpdateRequestCount;
    const totalRecordWrites = counters.recordCreateCount + counters.recordUpdateCount;
    const limits = LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS;
    if (counters.tokenRequestCount > limits.maximumTokenRequests
      || counters.tableReadRequestCount > limits.maximumTableReadRequests
      || counters.recordSearchRequestCount > limits.maximumRecordSearchRequests
      || totalBatchRequests > limits.maximumBatchWriteRequests
      || totalRecordWrites > limits.maximumRecordWrites) {
      counters.blockedRequestCount += 1;
      throw pilotError(
        'Controlled Preview Live Pilot exceeded its Remote request boundary',
        'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REMOTE_LIMIT_EXCEEDED',
        snapshot(),
      );
    }
  }

  function block(method, path, requestClass) {
    counters.blockedRequestCount += 1;
    throw pilotError(
      'Controlled Preview Live Pilot blocked a Remote request before fetch',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REQUEST_BLOCKED',
      { method, requestClass: classifyPath(path) ?? requestClass },
    );
  }

  function snapshot() {
    return Object.freeze({
      ...counters,
      totalBatchWriteRequests: counters.batchCreateRequestCount + counters.batchUpdateRequestCount,
      totalRecordWrites: counters.recordCreateCount + counters.recordUpdateCount,
    });
  }

  return Object.freeze({ fetchImpl: guardedFetch, snapshot });
}

export function assertLarkNativeAiControlledPreviewLivePilotRemoteCounters(value = {}) {
  const limits = LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS;
  if (Number(value.blockedRequestCount) !== 0
    || Number(value.tableReadRequestCount) !== 1
    || Number(value.recordSearchRequestCount) < 2
    || Number(value.recordSearchRequestCount) > limits.maximumRecordSearchRequests
    || Number(value.totalBatchWriteRequests) > limits.maximumBatchWriteRequests
    || Number(value.totalRecordWrites) > limits.maximumRecordWrites) {
    throw pilotError(
      'Controlled Preview Live Pilot Remote counters are outside the reviewed boundary',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REMOTE_COUNTERS_INVALID',
      value,
    );
  }
  return true;
}

export function sanitizeLarkNativeAiControlledPreviewLivePilotValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeLarkNativeAiControlledPreviewLivePilotValue);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
      .replace(/https?:\/\/[^\s]+/giu, '[URL_REDACTED]')
      .replace(/\b(?:cli_|bascn|tbl|rec|fld|vew)[A-Za-z0-9_-]{6,}\b/gu, '[ID_REDACTED]')
      .slice(0, 500);
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|cookie|password|table.?id|record.?id|app.?id|raw.?url|prompt|reference.?output)/iu.test(key))
    .map(([key, nested]) => [key, sanitizeLarkNativeAiControlledPreviewLivePilotValue(nested)]));
}

function readRecordRows(body) {
  let parsed;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    throw pilotError(
      'Controlled Preview Live Pilot write body is not valid JSON',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_WRITE_BODY_INVALID',
    );
  }
  if (!Array.isArray(parsed?.records) || parsed.records.length < 1) {
    throw pilotError(
      'Controlled Preview Live Pilot write body must contain Records',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_WRITE_BODY_INVALID',
    );
  }
  return parsed.records.length;
}
function resolveUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input?.url === 'string') return input.url;
  throw new TypeError('Controlled Preview Live Pilot requires a request URL');
}
function requestMethod(input) { return typeof input?.method === 'string' ? input.method : null; }
function classifyPath(path) {
  if (path.includes('/records')) return 'records';
  if (path.includes('/fields')) return 'fields';
  if (path.includes('/views')) return 'views';
  if (path.includes('/automations')) return 'automation';
  if (path.includes('/tables')) return 'tables';
  return 'other';
}
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function sha(value) { const item = text(value); return item && /^[0-9a-f]{40}$/u.test(item) ? item : null; }
