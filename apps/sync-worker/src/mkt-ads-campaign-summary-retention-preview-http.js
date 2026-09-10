import { runMktAdsCampaignSummaryRetentionOperator } from '../../../packages/application/src/use-cases/run-mkt-ads-campaign-summary-retention-operator.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH =
  '/__codex/mkt-ads-campaign-summary-retention-v1';

const MAX_BODY_BYTES = 262_144;
const CUSTOMER_LARK_APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const CUSTOMER_ADS_DAILY_TABLE_ID = 'tblTjWaxgSCwSj1P';

/**
 * Preview-version-only operator. The uploaded Worker has no routes, schedules, or Queues;
 * this handler is the sole authenticated ingress and is restricted to the reviewed Paid tables.
 */
export function createMktAdsCampaignSummaryRetentionPreviewHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const runOperator = dependencies.runOperator ?? runMktAdsCampaignSummaryRetentionOperator;
  const digest = dependencies.digest ?? sha256;

  return async function handle({ request, env, url }) {
    if (url.pathname !== MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH) return null;
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
      const execute = body?.mode === 'execute';
      if (!execute && body?.mode !== 'preview') {
        throw operatorError('Operator mode must be preview or execute', 'MKT_ADS_PREVIEW_MODE_INVALID');
      }
      const infrastructure = infrastructureFactory(env);
      const result = await runOperator({
        execute,
        client: infrastructure.getLarkBitableClient(),
        db: infrastructure.getStateDb(),
        env,
        contract: requireContract(body?.contract),
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        customerKey: 'chemistry_k',
        timezone: 'Asia/Bangkok',
        retentionDays: 90,
        softLimit: 17_000,
        targetLimit: 15_000,
        maxDeleteRows: 500,
      });
      return json({ ok: true, result }, { status: 200, headers: noStoreHeaders() });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'MKT_ADS_PREVIEW_UNAUTHORIZED' ? 401 : 400;
      return json({
        ok: false,
        code: operational.code ?? 'MKT_ADS_PREVIEW_OPERATOR_FAILED',
        error: status === 401 ? 'Unauthorized' : operational.message,
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
    || env?.LARK_TABLE_MKT_ADS_DAILY !== CUSTOMER_ADS_DAILY_TABLE_ID
    || !env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw operatorError('Preview operator runtime is not exact Customer PROD', 'MKT_ADS_PREVIEW_RUNTIME_INVALID');
  }
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireSha256(env?.MKT_ADS_PROD_OPERATOR_TOKEN_SHA256);
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw operatorError('Preview operator authorization was rejected', 'MKT_ADS_PREVIEW_UNAUTHORIZED');
  }
}

async function readBoundedJson(request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large', 'MKT_ADS_PREVIEW_BODY_TOO_LARGE');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw operatorError('Preview operator request is too large', 'MKT_ADS_PREVIEW_BODY_TOO_LARGE');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw operatorError('Preview operator request is invalid JSON', 'MKT_ADS_PREVIEW_BODY_INVALID');
  }
}

function requireContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.schema) || !Array.isArray(value.views)) {
    throw operatorError('Reviewed schema contract is required', 'MKT_ADS_PREVIEW_CONTRACT_INVALID');
  }
  return value;
}

function requireSha256(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw operatorError('Preview operator token digest is invalid', 'MKT_ADS_PREVIEW_RUNTIME_INVALID');
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
