import { readWooCommerceRuntimeConfig } from '../../../packages/config/src/woocommerce-runtime-config.js';
import { WooCommerceRestClient } from '../../../packages/connectors/src/woocommerce/woocommerce-rest-client.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import {
  addWorkerRuntimeVersionHeader,
  readWorkerRuntimeVersionId,
} from '../../../packages/shared/src/cloudflare/worker-version.js';
import { createWooCommerceWorkerFetch } from './woocommerce-job-router.js';

export const WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH = '/operator/woocommerce/provider-response-diagnostics';
export const WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG = 'MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_HTTP_ENABLED';

const EXECUTION_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const RESPONSE_BODY_SHAPES = new Set([
  'empty',
  'html_or_xml',
  'json_object_like',
  'json_array_like',
  'other',
]);

/**
 * Guarded Worker-side GET-only probe. WooCommerce credentials remain inside Worker Secrets.
 * The route has no Queue, D1, Lark, Report or Schedule dependency.
 */
export function createWooCommerceProviderDiagnosticsHttpHandler(dependencies = {}) {
  const runtimeVersionReader = dependencies.readRuntimeVersionId ?? readWorkerRuntimeVersionId;
  const clientFactory = dependencies.createClient ?? ((config) => new WooCommerceRestClient({
    baseUrl: config.source.baseUrl,
    consumerKey: config.source.consumerKey,
    consumerSecret: config.source.consumerSecret,
    apiVersion: config.source.apiVersion,
    timeoutMs: config.source.timeoutMs,
    pageSize: 1,
    fetchImpl: createWooCommerceWorkerFetch(),
  }));

  return async function handleWooCommerceProviderDiagnostics(context) {
    const { request, env, url } = context;
    if (url.pathname !== WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH) return null;

    let runtimeVersionId = null;
    try {
      runtimeVersionId = runtimeVersionReader(env, { allowMissing: true });
      if (request.method !== 'GET') {
        return versioned(json({ ok: false, error: 'Method not allowed' }, {
          status: 405,
          headers: { allow: 'GET', 'cache-control': 'no-store' },
        }), runtimeVersionId);
      }
      if (!readBoolean(env?.[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], false)) {
        return versioned(json({ ok: false, error: 'Route not found' }, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        }), runtimeVersionId);
      }

      await requireOperatorAuthorization(request, env?.MKT_CONNECTION_OPERATOR_TOKEN);
      assertTarget(env);
      assertDiagnosticOnlyFlags(env);

      const config = readWooCommerceRuntimeConfig({
        ...env,
        MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
        MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'false',
        MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: 'false',
        MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'false',
        MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED: 'false',
        MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'false',
      });
      const store = await clientFactory(config, env).getStoreIdentity();
      return versioned(json({
        ok: true,
        stage: 'woocommerce-worker-provider-response-diagnostics',
        providerRequestCount: 1,
        providerMutationCount: 0,
        businessMutationCount: 0,
        queueMessageCount: 0,
        workerDeploymentCount: 0,
        larkRequestCount: 0,
        scheduleMutationCount: 0,
        store: {
          wcVersion: store.wcVersion,
          wpVersion: store.wpVersion,
          timezone: store.timezone,
          currency: store.currency,
          numberOfDecimals: store.numberOfDecimals,
        },
      }, {
        status: 200,
        headers: noStoreHeaders(),
      }), runtimeVersionId);
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const code = operational.code ?? 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FAILED';
      const status = code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_UNAUTHORIZED'
        ? 401
        : code === 'WOOCOMMERCE_INVALID_JSON'
          ? 422
          : 400;
      return versioned(json({
        ok: false,
        stage: 'woocommerce-worker-provider-response-diagnostics',
        error: status === 401 ? 'Unauthorized' : 'WooCommerce Provider diagnostics failed',
        code,
        failureDiagnostics: extractFailureDiagnostics(error),
        providerRequestCount: error?.details?.resource ? 1 : 0,
        providerMutationCount: 0,
        businessMutationCount: 0,
        queueMessageCount: 0,
        workerDeploymentCount: 0,
        larkRequestCount: 0,
        scheduleMutationCount: 0,
      }, {
        status,
        headers: noStoreHeaders(),
      }), runtimeVersionId);
    }
  };
}

function assertTarget(env) {
  requireExact(env?.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env?.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env?.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
}

function assertDiagnosticOnlyFlags(env) {
  const trueFlags = Object.entries(env ?? {})
    .filter(([name, value]) => EXECUTION_FLAG_PATTERN.test(name) && readBoolean(value, false))
    .map(([name]) => name)
    .sort();
  if (JSON.stringify(trueFlags) !== JSON.stringify([WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG])) {
    const error = new Error('WooCommerce Provider diagnostics requires a diagnostic-only Worker window');
    error.code = 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FLAGS_UNSAFE';
    error.details = { trueFlags };
    throw error;
  }
}

async function requireOperatorAuthorization(request, expectedToken) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  const supplied = match?.[1]?.trim() ?? '';
  const valid = await timingSafeEqualText(supplied, requireSecret(expectedToken, 'MKT_CONNECTION_OPERATOR_TOKEN'));
  if (!match || !valid) {
    const error = new Error('WooCommerce Provider diagnostics authorization was rejected');
    error.code = 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_UNAUTHORIZED';
    throw error;
  }
}

function extractFailureDiagnostics(error) {
  const details = objectOrNull(error?.details);
  if (!details) return null;
  const networkCause = objectOrNull(details.networkCause);
  const response = {
    responseStatus: diagnosticNumber(details.responseStatus ?? details.status),
    contentType: diagnosticText(details.contentType),
    contentEncoding: diagnosticText(details.contentEncoding),
    contentLengthHeader: diagnosticNumber(details.contentLengthHeader),
    bodyByteLength: diagnosticNumber(details.bodyByteLength),
    bodySha256: diagnosticSha256(details.bodySha256),
    bodyShape: diagnosticBodyShape(details.bodyShape),
    bomRemoved: diagnosticBoolean(details.bomRemoved),
  };
  const output = {
    resource: diagnosticText(details.resource),
    timeoutMs: diagnosticNumber(details.timeoutMs),
    elapsedMs: diagnosticNumber(details.elapsedMs),
    networkCause: networkCause ? {
      name: diagnosticText(networkCause.name),
      message: diagnosticText(networkCause.message),
      code: diagnosticText(networkCause.code),
      nestedName: diagnosticText(networkCause.nestedName),
      nestedMessage: diagnosticText(networkCause.nestedMessage),
      nestedCode: diagnosticText(networkCause.nestedCode),
    } : null,
  };
  if (Object.values(response).some((value) => value !== null)) output.responseDiagnostics = response;
  return Object.values(output).some((value) => value !== null && value !== undefined) ? output : null;
}

function noStoreHeaders() {
  return {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  };
}

function versioned(response, runtimeVersionId) {
  return addWorkerRuntimeVersionHeader(response, runtimeVersionId);
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const error = new Error('WooCommerce Provider diagnostics flag must be true or false');
  error.code = 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID';
  throw error;
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) {
    const error = new Error(`${fieldName} must equal ${expected}`);
    error.code = 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_TARGET_INVALID';
    error.details = { fieldName, expected };
    throw error;
  }
  return text;
}

function requireSecret(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.length < 16 || /^(?:replace-with-|example|changeme)/iu.test(text)) {
    const error = new Error(`${fieldName} is not configured safely`);
    error.code = 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID';
    error.details = { fieldName };
    throw error;
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID';
    error.details = { fieldName };
    throw error;
  }
  return value.trim();
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function diagnosticText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text.slice(0, 500);
}

function diagnosticNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function diagnosticSha256(value) {
  const text = diagnosticText(value);
  return text && /^[0-9a-f]{64}$/u.test(text) ? text : null;
}

function diagnosticBodyShape(value) {
  const text = diagnosticText(value);
  return text && RESPONSE_BODY_SHAPES.has(text) ? text : null;
}

function diagnosticBoolean(value) {
  return value === true || value === false ? value : null;
}
