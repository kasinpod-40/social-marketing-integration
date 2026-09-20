import { ChatwootApiClient } from '../../../packages/connectors/src/chatwoot/chatwoot-api.client.js';
import { installCustomerSlowestFirstResponseDashboard } from '../../../packages/application/src/use-cases/install-customer-slowest-first-response-dashboard.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const CUSTOMER_SLOWEST_FIRST_RESPONSE_PREVIEW_PATH =
  '/__codex/customer-slowest-first-response-v1';

const MAX_BODY_BYTES = 16_384;
const CUSTOMER_LARK_APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const CUSTOMER_CONVERSATION_DAILY_TABLE_ID = 'tblERVjnJ9qZIbmG';
const CUSTOMER_SERVICE_DASHBOARD_ID = 'blkvWBMMRv5q2yN8';

/** Preview-version-only read/apply endpoint for the bounded First Response dashboard helper. */
export function createCustomerSlowestFirstResponsePreviewHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const runOperator = dependencies.runOperator ?? installCustomerSlowestFirstResponseDashboard;
  const digest = dependencies.digest ?? sha256;

  return async function handle({ request, env, url }) {
    if (url.pathname !== CUSTOMER_SLOWEST_FIRST_RESPONSE_PREVIEW_PATH) return null;
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
      if (body?.mode !== 'preview' && body?.mode !== 'execute') {
        throw operatorError('Operator mode must be preview or execute',
          'CUSTOMER_FIRST_RESPONSE_MODE_INVALID');
      }
      const infrastructure = infrastructureFactory(env);
      const chatwoot = new ChatwootApiClient({
        baseUrl: env.CHATWOOT_BASE_URL,
        accountId: env.CHATWOOT_ACCOUNT_ID,
        accessToken: env.CHATWOOT_API_ACCESS_TOKEN,
      });
      const result = await runOperator({
        execute: body.mode === 'execute',
        client: infrastructure.getLarkBitableClient(),
        chatwoot,
        baseToken: env.LARK_APP_TOKEN,
        dailyTableId: env.LARK_TABLE_MKT_CONVERSATION_DAILY,
        dashboardId: CUSTOMER_SERVICE_DASHBOARD_ID,
      });
      return json({ ok: true, result }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'CUSTOMER_FIRST_RESPONSE_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'CUSTOMER_FIRST_RESPONSE_OPERATOR_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
        details: status === 401 ? {} : operational.details,
      }, { status, headers: noStoreHeaders() });
    }
  };
}

function assertExactCustomerRuntime(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'production'
    || runtime.profileKey !== 'chemistry_k'
    || runtime.customerKey !== 'chemistry_k'
    || runtime.infrastructureOwner !== 'customer'
    || env?.LARK_APP_TOKEN !== CUSTOMER_LARK_APP_TOKEN
    || env?.LARK_TABLE_MKT_CONVERSATION_DAILY !== CUSTOMER_CONVERSATION_DAILY_TABLE_ID) {
    throw operatorError('Preview operator runtime is not exact Customer PROD',
      'CUSTOMER_FIRST_RESPONSE_RUNTIME_INVALID');
  }
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireSha256(env?.MKT_FIRST_RESPONSE_OPERATOR_TOKEN_SHA256);
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw operatorError('Preview operator authorization was rejected',
      'CUSTOMER_FIRST_RESPONSE_UNAUTHORIZED');
  }
}

async function readBoundedJson(request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large',
      'CUSTOMER_FIRST_RESPONSE_BODY_TOO_LARGE');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw operatorError('Preview operator request is invalid JSON',
      'CUSTOMER_FIRST_RESPONSE_BODY_INVALID');
  }
}

function requireSha256(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError('Preview operator token digest is invalid',
      'CUSTOMER_FIRST_RESPONSE_RUNTIME_INVALID');
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

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
