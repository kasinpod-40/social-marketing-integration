import { createHash } from 'node:crypto';
import {
  WORKER_VERSION_METADATA_BINDING,
} from '../../packages/shared/src/cloudflare/worker-version.js';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV,
} from '../../apps/sync-worker/src/woocommerce-provider-diagnostics-http.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import { buildWooCommerceFinalSourceConfig } from './woocommerce-final-source-contract.js';

export const WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS',
  value: 'RUN_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS',
});
export const WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_REQUIRED_SECRETS = Object.freeze([
  'WOOCOMMERCE_CONSUMER_KEY',
  'WOOCOMMERCE_CONSUMER_SECRET',
]);
export const WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING =
  WORKER_VERSION_METADATA_BINDING;
export {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV,
};

const EXECUTION_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_HTTP_STATUSES = new Set([200, 422]);

/** Build exact Safe and diagnostic-only configs from the same source contract as Final rollout. */
export function buildWooCommerceWorkerProviderDiagnosticConfigs(sourceText, input = {}) {
  const source = buildWooCommerceFinalSourceConfig(sourceText, {
    repositoryRoot: requireText(input.repositoryRoot, 'repositoryRoot'),
    sourceConfigPath: requireText(input.sourceConfigPath, 'sourceConfigPath'),
  });
  const diagnosticTokenSha256 = requireSha256(
    input.diagnosticTokenSha256
      ?? process.env[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV],
    WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV,
  );
  const activeAttestation = requireSha256(input.activeAttestation, 'activeAttestation');
  const safeAttestation = requireSha256(input.safeAttestation, 'safeAttestation');
  if (activeAttestation === safeAttestation) {
    throw diagnosticError(
      'Active and Safe WooCommerce diagnostic attestations must differ',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_INVALID',
    );
  }

  const config = parseJsoncObject(source.text);
  const vars = requireObject(config.vars, 'vars');
  const versionMetadata = materializeVersionMetadata(config.version_metadata);
  const safeVars = closeExecutionFlags(vars);
  safeVars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG] = 'false';
  safeVars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV] = safeAttestation;
  delete safeVars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV];
  const activeVars = {
    ...safeVars,
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]: 'true',
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV]: diagnosticTokenSha256,
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV]: activeAttestation,
  };

  const safe = serialize({ ...config, version_metadata: versionMetadata, vars: safeVars });
  const active = serialize({ ...config, version_metadata: versionMetadata, vars: activeVars });
  const safeTrueFlags = readTrueFlags(safe);
  const activeTrueFlags = readTrueFlags(active);
  assertExactList(safeTrueFlags, [], 'safeTrueFlags');
  assertExactList(activeTrueFlags, [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'activeTrueFlags');
  assertVersionMetadataBinding(parseJsoncObject(safe).version_metadata);
  assertVersionMetadataBinding(parseJsoncObject(active).version_metadata);
  assertConfigAttestation(parseJsoncObject(safe).vars, safeAttestation);
  assertConfigAttestation(parseJsoncObject(active).vars, activeAttestation);

  const origin = requireHttpsOrigin(activeVars.MKT_CONNECTION_PUBLIC_ORIGIN);
  return Object.freeze({
    safe,
    active,
    safeSha256: sha256(safe),
    activeSha256: sha256(active),
    bundleSourceSha256: source.sha256,
    origin,
    pathname: WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
    safeTrueFlags: Object.freeze(safeTrueFlags),
    activeTrueFlags: Object.freeze(activeTrueFlags),
    safeAttestation,
    activeAttestation,
    runtimeVersionMetadataBinding: WORKER_VERSION_METADATA_BINDING,
    ephemeralAuthDigestConfigured: true,
    deploymentAttestationConfigured: true,
    secretValuesCopied: source.secretValuesCopied,
  });
}

export function assertWooCommerceWorkerProviderDiagnosticsConfirmation(env = {}) {
  const confirmation = WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION;
  if (env[confirmation.envName] !== confirmation.value) {
    throw diagnosticError(
      `WooCommerce Worker Provider diagnostics requires ${confirmation.envName}=${confirmation.value}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function parseWooCommerceWorkerProviderDiagnosticsArgs(args = []) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw diagnosticError(
      `Unsupported WooCommerce Worker Provider diagnostics arguments: ${unknown.join(', ')}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ARGUMENT_INVALID',
    );
  }
  return Object.freeze({ execute: args.includes('--execute') });
}

export function parseWooCommerceWorkerSecretNames(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw diagnosticError(
      'Wrangler secret list returned invalid JSON',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_SECRET_LIST_INVALID',
    );
  }
  const items = Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.secrets ?? []);
  const names = [...new Set((Array.isArray(items) ? items : [])
    .map((item) => item?.name ?? item?.secret_name)
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim()))].sort();
  const missing = WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_REQUIRED_SECRETS
    .filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw diagnosticError(
      'Required Worker Secret names are missing for WooCommerce diagnostics',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_SECRET_MISSING',
      { missing },
    );
  }
  return Object.freeze(names);
}

export function validateWooCommerceWorkerProviderDiagnosticResponse(status, body = {}) {
  if (!ALLOWED_HTTP_STATUSES.has(Number(status))) {
    throw diagnosticError(
      `WooCommerce diagnostics route returned unexpected HTTP ${status}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_HTTP_INVALID',
      { status: Number(status) },
    );
  }
  if (body?.stage !== 'woocommerce-worker-provider-response-diagnostics') {
    throw diagnosticError(
      'WooCommerce diagnostics response stage is invalid',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID',
    );
  }
  if (Number(body.providerRequestCount) !== 1
    || Number(body.providerMutationCount) !== 0
    || Number(body.businessMutationCount) !== 0
    || Number(body.queueMessageCount) !== 0
    || Number(body.larkRequestCount) !== 0
    || Number(body.scheduleMutationCount) !== 0) {
    throw diagnosticError(
      'WooCommerce diagnostics response counters are unsafe or incomplete',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID',
    );
  }
  if (Number(status) === 200 && body.ok !== true) {
    throw diagnosticError('WooCommerce diagnostics success response is invalid', 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID');
  }
  if (Number(status) === 422 && (body.ok !== false || body.code !== 'WOOCOMMERCE_INVALID_JSON')) {
    throw diagnosticError('WooCommerce invalid-JSON response is invalid', 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID');
  }
  return Object.freeze(body);
}

export function validateWooCommerceDiagnosticsAttestation(response, expectedInput) {
  const expected = requireSha256(expectedInput, 'expectedAttestation');
  const observedRaw = response instanceof Response
    ? response.headers.get(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER)
    : null;
  const observed = SHA256_PATTERN.test(observedRaw ?? '') ? observedRaw.toLowerCase() : null;
  if (observed !== expected) {
    throw diagnosticError(
      'Worker response did not match the generated diagnostic deployment attestation',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_MISMATCH',
      {
        expectedAttestationFingerprint: sha256(expected),
        observedAttestationFingerprint: observed ? sha256(observed) : null,
        observedAttestationPresent: observed !== null,
        responseStatus: response instanceof Response ? response.status : null,
        responseContentType: response instanceof Response
          ? response.headers.get('content-type')
          : null,
        responseServer: response instanceof Response ? response.headers.get('server') : null,
        responseCfRayPresent: response instanceof Response
          ? Boolean(response.headers.get('cf-ray'))
          : false,
        safeCloseRequired: true,
      },
    );
  }
  return expected;
}

function closeExecutionFlags(vars) {
  const output = { ...vars };
  for (const name of Object.keys(output)) {
    if (EXECUTION_FLAG_PATTERN.test(name)) output[name] = 'false';
  }
  return output;
}

function materializeVersionMetadata(value) {
  if (value === undefined || value === null) {
    return Object.freeze({ binding: WORKER_VERSION_METADATA_BINDING });
  }
  const metadata = requireObject(value, 'version_metadata');
  const configuredBinding = metadata.binding;
  if (configuredBinding !== undefined
    && requireText(configuredBinding, 'version_metadata.binding') !== WORKER_VERSION_METADATA_BINDING) {
    throw diagnosticError(
      `version_metadata.binding must equal ${WORKER_VERSION_METADATA_BINDING}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_INVALID',
      { expectedBinding: WORKER_VERSION_METADATA_BINDING },
    );
  }
  return Object.freeze({ binding: WORKER_VERSION_METADATA_BINDING });
}

function assertVersionMetadataBinding(value) {
  const metadata = requireObject(value, 'version_metadata');
  if (metadata.binding !== WORKER_VERSION_METADATA_BINDING) {
    throw diagnosticError(
      'WooCommerce diagnostics generated config is missing exact Worker version metadata binding',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_INVALID',
      { expectedBinding: WORKER_VERSION_METADATA_BINDING },
    );
  }
  return true;
}

function assertConfigAttestation(varsInput, expected) {
  const vars = requireObject(varsInput, 'vars');
  if (vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV] !== expected) {
    throw diagnosticError(
      'WooCommerce diagnostics generated config has an invalid deployment attestation',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_INVALID',
    );
  }
  return true;
}

function readTrueFlags(configText) {
  const vars = requireObject(parseJsoncObject(configText).vars, 'vars');
  return Object.entries(vars)
    .filter(([name, value]) => EXECUTION_FLAG_PATTERN.test(name) && booleanLike(value))
    .map(([name]) => name)
    .sort();
}

function booleanLike(value) {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requireHttpsOrigin(value) {
  let url;
  try {
    url = new URL(requireText(value, 'MKT_CONNECTION_PUBLIC_ORIGIN'));
  } catch {
    throw diagnosticError(
      'MKT_CONNECTION_PUBLIC_ORIGIN must be an HTTPS origin',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ORIGIN_INVALID',
    );
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw diagnosticError(
      'MKT_CONNECTION_PUBLIC_ORIGIN must be an HTTPS origin',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ORIGIN_INVALID',
    );
  }
  return url.origin;
}

function assertExactList(actual, expected, fieldName) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw diagnosticError(
      `${fieldName} differs from the approved WooCommerce diagnostics window`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FLAGS_INVALID',
      { fieldName, actual: left, expected: right },
    );
  }
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw diagnosticError(`${fieldName} must be an object`, 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID', { fieldName });
  }
  return value;
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA256_PATTERN.test(text)) {
    throw diagnosticError(`${fieldName} must be a SHA-256 digest`, 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID', { fieldName });
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw diagnosticError(`${fieldName} is required`, 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID', { fieldName });
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function diagnosticError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceWorkerProviderDiagnosticsError';
  error.code = code;
  error.details = details;
  return error;
}
