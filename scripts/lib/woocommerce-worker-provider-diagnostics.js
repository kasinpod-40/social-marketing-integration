import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
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
export const WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ENTRYPOINT =
  'apps/sync-worker/src/woocommerce-provider-diagnostics-entry.js';
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
const PREVIEW_DIAGNOSTIC_VAR_NAMES = Object.freeze([
  'MKT_ENV',
  'MKT_CUSTOMER_PROFILE',
  'MKT_CONNECTION_CUSTOMER_KEY',
  'WOOCOMMERCE_BASE_URL',
  'WOOCOMMERCE_API_VERSION',
  'WOOCOMMERCE_API_TIMEOUT_MS',
  'WOOCOMMERCE_DEFAULT_CURRENCY',
]);
const PREVIEW_FORBIDDEN_KEYS = Object.freeze([
  'routes',
  'route',
  'triggers',
  'queues',
  'd1_databases',
  'durable_objects',
  'kv_namespaces',
  'r2_buckets',
  'services',
  'workflows',
  'analytics_engine_datasets',
  'assets',
]);

/** Build isolated Safe and diagnostic-only Preview Version configs without Production deployment. */
export function buildWooCommerceWorkerProviderDiagnosticConfigs(sourceText, input = {}) {
  const repositoryRoot = requireText(input.repositoryRoot, 'repositoryRoot');
  const sourceConfigPath = requireText(input.sourceConfigPath, 'sourceConfigPath');
  const source = buildWooCommerceFinalSourceConfig(sourceText, {
    repositoryRoot,
    sourceConfigPath,
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

  const sourceConfig = parseJsoncObject(source.text);
  const vars = requireObject(sourceConfig.vars, 'vars');
  const versionMetadata = materializeVersionMetadata(sourceConfig.version_metadata);
  const previewEntrypoint = resolve(
    repositoryRoot,
    input.previewEntrypointPath ?? WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ENTRYPOINT,
  );
  const previewBase = materializeIsolatedPreviewConfig(sourceConfig, {
    previewEntrypoint,
    versionMetadata,
  });

  const safeVars = materializePreviewDiagnosticVars(vars);
  safeVars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG] = 'false';
  safeVars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV] = safeAttestation;
  delete safeVars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV];
  const activeVars = {
    ...safeVars,
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]: 'true',
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV]: diagnosticTokenSha256,
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV]: activeAttestation,
  };

  const safe = serialize({ ...previewBase, vars: safeVars });
  const active = serialize({ ...previewBase, vars: activeVars });
  const safeParsed = parseJsoncObject(safe);
  const activeParsed = parseJsoncObject(active);
  const safeTrueFlags = readTrueFlags(safe);
  const activeTrueFlags = readTrueFlags(active);
  assertExactList(safeTrueFlags, [], 'safeTrueFlags');
  assertExactList(activeTrueFlags, [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'activeTrueFlags');
  assertVersionMetadataBinding(safeParsed.version_metadata);
  assertVersionMetadataBinding(activeParsed.version_metadata);
  assertConfigAttestation(safeParsed.vars, safeAttestation);
  assertConfigAttestation(activeParsed.vars, activeAttestation);
  assertPreviewIsolation(safeParsed, previewEntrypoint);
  assertPreviewIsolation(activeParsed, previewEntrypoint);

  return Object.freeze({
    safe,
    active,
    safeSha256: sha256(safe),
    activeSha256: sha256(active),
    bundleSourceSha256: source.sha256,
    pathname: WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
    workerName: previewBase.name,
    previewEntrypoint,
    safeTrueFlags: Object.freeze(safeTrueFlags),
    activeTrueFlags: Object.freeze(activeTrueFlags),
    safeAttestation,
    activeAttestation,
    runtimeVersionMetadataBinding: WORKER_VERSION_METADATA_BINDING,
    ephemeralAuthDigestConfigured: true,
    deploymentAttestationConfigured: true,
    previewUrlsEnabled: true,
    productionRoutesCopied: 0,
    productionBindingsCopied: 0,
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
    throw diagnosticError(
      'WooCommerce diagnostics success response is invalid',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID',
    );
  }
  if (Number(status) === 422 && (body.ok !== false || body.code !== 'WOOCOMMERCE_INVALID_JSON')) {
    throw diagnosticError(
      'WooCommerce invalid-JSON response is invalid',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID',
    );
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
      'Worker response did not match the generated diagnostic Preview Version attestation',
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
        previewSafeCloseRequired: true,
      },
    );
  }
  return expected;
}

function materializeIsolatedPreviewConfig(sourceConfig, input) {
  const name = requireText(sourceConfig.name, 'name');
  const compatibilityDate = requireText(sourceConfig.compatibility_date, 'compatibility_date');
  const compatibilityFlags = Array.isArray(sourceConfig.compatibility_flags)
    ? [...sourceConfig.compatibility_flags]
    : [];
  const output = {
    name,
    main: requireText(input.previewEntrypoint, 'previewEntrypoint'),
    compatibility_date: compatibilityDate,
    compatibility_flags: compatibilityFlags,
    workers_dev: false,
    preview_urls: true,
    version_metadata: input.versionMetadata,
    secrets: {
      required: [...WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_REQUIRED_SECRETS],
    },
  };
  if (sourceConfig.account_id !== undefined) {
    output.account_id = requireText(sourceConfig.account_id, 'account_id');
  }
  return output;
}

function assertPreviewIsolation(config, expectedEntrypoint) {
  requireObject(config, 'config');
  if (config.main !== expectedEntrypoint
    || config.workers_dev !== false
    || config.preview_urls !== true) {
    throw diagnosticError(
      'WooCommerce diagnostics Preview Version isolation is invalid',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_CONFIG_INVALID',
    );
  }
  const forbidden = PREVIEW_FORBIDDEN_KEYS.filter((key) => config[key] !== undefined);
  if (forbidden.length > 0) {
    throw diagnosticError(
      'WooCommerce diagnostics Preview Version contains forbidden Production bindings or routes',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_CONFIG_INVALID',
      { forbidden },
    );
  }
  const requiredSecrets = config.secrets?.required;
  assertExactList(
    Array.isArray(requiredSecrets) ? requiredSecrets : [],
    WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_REQUIRED_SECRETS,
    'requiredSecrets',
  );
  return true;
}

function materializePreviewDiagnosticVars(vars) {
  const output = {};
  for (const name of PREVIEW_DIAGNOSTIC_VAR_NAMES) {
    output[name] = requireText(vars[name], name);
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
      'WooCommerce diagnostics generated config has an invalid Preview Version attestation',
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
    throw diagnosticError(
      `${fieldName} must be an object`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA256_PATTERN.test(text)) {
    throw diagnosticError(
      `${fieldName} must be a SHA-256 digest`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw diagnosticError(
      `${fieldName} is required`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID',
      { fieldName },
    );
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
