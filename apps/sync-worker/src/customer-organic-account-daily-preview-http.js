import { runCustomerOrganicAccountDailyBackfill } from '../../../packages/application/src/use-cases/run-customer-organic-account-daily-backfill.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { isPlaceholderConfigValue } from '../../../packages/shared/src/config/placeholder-value.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH =
  '/__codex/customer-organic-account-daily-v1';

const CUSTOMER_LARK_APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const MAX_BODY_BYTES = 1_024;

/** Preview-only authenticated repair for the one shared Organic Account Daily table. */
export function createCustomerOrganicAccountDailyPreviewHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const runOperator = dependencies.runOperator ?? runCustomerOrganicAccountDailyBackfill;
  const digest = dependencies.digest ?? sha256;

  return async function handle({ request, env, url }) {
    if (url.pathname !== CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH) return null;
    try {
      if (request.method !== 'POST') {
        return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, {
          status: 405,
          headers: { allow: 'POST', ...noStoreHeaders() },
        });
      }
      assertExactCustomerRuntime(env);
      await requireAuthorization(request, env, digest);
      const body = await readBoundedJson(request);
      if (!body || !['preview', 'execute'].includes(body.mode)) {
        throw operatorError('Operator mode must be preview or execute', 'ORGANIC_ACCOUNT_DAILY_MODE_INVALID');
      }
      const infrastructure = infrastructureFactory(env);
      const result = await runOperator({
        execute: body.mode === 'execute',
        observedAt: Date.now(),
        db: infrastructure.getStateDb(),
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        tableId: env.LARK_TABLE_MKT_ACCOUNT_DAILY,
      });
      return json({ ok: true, result }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'ORGANIC_ACCOUNT_DAILY_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'ORGANIC_ACCOUNT_DAILY_OPERATOR_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
        details: status === 401 ? {} : operational.details,
      }, { status, headers: noStoreHeaders() });
    }
  };
}

async function readBoundedJson(request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large', 'ORGANIC_ACCOUNT_DAILY_BODY_INVALID');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large', 'ORGANIC_ACCOUNT_DAILY_BODY_INVALID');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw operatorError('Preview operator request is invalid JSON', 'ORGANIC_ACCOUNT_DAILY_BODY_INVALID');
  }
}

function assertExactCustomerRuntime(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  const tableId = String(env?.LARK_TABLE_MKT_ACCOUNT_DAILY ?? '').trim();
  if (runtime.environment !== 'production'
    || runtime.profileKey !== 'chemistry_k'
    || runtime.customerKey !== 'chemistry_k'
    || runtime.infrastructureOwner !== 'customer'
    || env?.LARK_APP_TOKEN !== CUSTOMER_LARK_APP_TOKEN
    || !tableId
    || isPlaceholderConfigValue(tableId)
    || !env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw operatorError('Preview operator runtime is not exact Customer PROD',
      'ORGANIC_ACCOUNT_DAILY_RUNTIME_INVALID');
  }
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireSha256(env?.MKT_ADS_PROD_OPERATOR_TOKEN_SHA256);
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw operatorError('Preview operator authorization was rejected',
      'ORGANIC_ACCOUNT_DAILY_UNAUTHORIZED');
  }
}

function requireSha256(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError('Preview operator token digest is invalid',
      'ORGANIC_ACCOUNT_DAILY_RUNTIME_INVALID');
  }
  return text;
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function noStoreHeaders() {
  return { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
}

function operatorError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
