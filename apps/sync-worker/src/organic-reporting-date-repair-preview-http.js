import { repairOrganicReportingDateSemantics } from '../../../packages/application/src/use-cases/repair-organic-reporting-date-semantics.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH =
  '/__codex/organic-reporting-date-repair-v1';

const CUSTOMER_LARK_APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const CUSTOMER_ACCOUNTS_TABLE_ID = 'tblVB102JoqSfgHa';
const CUSTOMER_CONTENT_DAILY_TABLE_ID = 'tblODz9RcmCIFtfQ';
const MAX_BODY_BYTES = 16_384;

export function createOrganicReportingDateRepairPreviewHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const runOperator = dependencies.runOperator ?? repairOrganicReportingDateSemantics;
  const digest = dependencies.digest ?? sha256;

  return async function handle({ request, env, url }) {
    if (url.pathname !== ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH) return null;
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
        throw operatorError('Operator mode must be preview or execute', 'ORGANIC_DATE_REPAIR_MODE_INVALID');
      }
      const infrastructure = infrastructureFactory(env);
      const result = await runOperator({
        execute: body.mode === 'execute',
        client: infrastructure.getLarkBitableClient(),
        db: infrastructure.getStateDb(),
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        tables: {
          mktAccounts: env.LARK_TABLE_MKT_ACCOUNTS,
          mktContentDaily: env.LARK_TABLE_MKT_CONTENT_DAILY,
        },
      });
      return json({ ok: true, result }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'ORGANIC_DATE_REPAIR_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'ORGANIC_DATE_REPAIR_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
        details: status === 401 ? {} : operational.details,
      }, { status, headers: noStoreHeaders() });
    }
  };
}

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large', 'ORGANIC_DATE_REPAIR_BODY_TOO_LARGE');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large', 'ORGANIC_DATE_REPAIR_BODY_TOO_LARGE');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw operatorError('Preview operator request is invalid JSON', 'ORGANIC_DATE_REPAIR_BODY_INVALID');
  }
}

function assertExactCustomerRuntime(env) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'production'
    || runtime.profileKey !== 'chemistry_k'
    || runtime.customerKey !== 'chemistry_k'
    || runtime.infrastructureOwner !== 'customer'
    || env?.LARK_APP_TOKEN !== CUSTOMER_LARK_APP_TOKEN
    || env?.LARK_TABLE_MKT_ACCOUNTS !== CUSTOMER_ACCOUNTS_TABLE_ID
    || env?.LARK_TABLE_MKT_CONTENT_DAILY !== CUSTOMER_CONTENT_DAILY_TABLE_ID
    || !env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw operatorError('Preview operator runtime is not exact Customer PROD',
      'ORGANIC_DATE_REPAIR_RUNTIME_INVALID');
  }
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireSha256(env?.MKT_ORGANIC_DATE_REPAIR_TOKEN_SHA256);
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw operatorError('Preview operator authorization was rejected',
      'ORGANIC_DATE_REPAIR_UNAUTHORIZED');
  }
}

function requireSha256(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError('Preview operator token digest is invalid',
      'ORGANIC_DATE_REPAIR_RUNTIME_INVALID');
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
