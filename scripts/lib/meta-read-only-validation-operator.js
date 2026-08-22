import { loadMetaTokenConnectionConfig, META_TOKEN_CONNECTION_STATUSES } from '../../packages/config/src/meta-token-connection-config.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_READ_ONLY_VALIDATION_CONTRACT_VERSION = 'meta_read_only_validation_v1';

export const META_READ_ONLY_VALIDATION_PHASES = Object.freeze([
  'plan',
  'preflight',
  'facebook',
  'instagram',
  'meta-ads-chemistry-k2',
  'meta-ads-chemistry-k3',
  'summary',
]);

export const META_READ_ONLY_VALIDATION_CONFIRMATIONS = Object.freeze({
  preflight: Object.freeze({
    envName: 'CONFIRM_META_READ_ONLY_PREFLIGHT',
    value: 'READ_ONLY_META_CONFIGURATION_PREFLIGHT',
  }),
  facebook: Object.freeze({
    envName: 'CONFIRM_META_READ_ONLY_FACEBOOK',
    value: 'READ_ONLY_META_FACEBOOK_ONCE',
  }),
  instagram: Object.freeze({
    envName: 'CONFIRM_META_READ_ONLY_INSTAGRAM',
    value: 'READ_ONLY_META_INSTAGRAM_ONCE',
  }),
  'meta-ads-chemistry-k2': Object.freeze({
    envName: 'CONFIRM_META_READ_ONLY_CHEMISTRY_K2',
    value: 'READ_ONLY_META_ADS_CHEMISTRY_K2_ONCE',
  }),
  'meta-ads-chemistry-k3': Object.freeze({
    envName: 'CONFIRM_META_READ_ONLY_CHEMISTRY_K3',
    value: 'READ_ONLY_META_ADS_CHEMISTRY_K3_ONCE',
  }),
  summary: Object.freeze({
    envName: 'CONFIRM_META_READ_ONLY_SUMMARY',
    value: 'REVIEW_META_READ_ONLY_EVIDENCE',
  }),
});

const EXPECTED_IDENTITIES = deepFreeze({
  customerKey: 'chemistry_k',
  facebookPageId: '982406442148381',
  instagramAccountId: '17841413521012797',
  metaAdAccounts: [
    { key: 'chemistry_k2', accountId: '505898710119851' },
    { key: 'chemistry_k3', accountId: '851206695716861' },
  ],
});

const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_CONNECTOR_INSTAGRAM_ENABLED',
  'MKT_CONNECTOR_META_ADS_ENABLED',
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_CONNECTOR_YOUTUBE_ENABLED',
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
  'MKT_CONNECTOR_CHATWOOT_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED',
  'MKT_META_REPORT_READ_ENABLED',
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
  'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_SCHEDULE_FACEBOOK_ENABLED',
  'MKT_SCHEDULE_INSTAGRAM_ENABLED',
  'MKT_SCHEDULE_YOUTUBE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
]);

const PHASE_SCOPES = Object.freeze({
  facebook: Object.freeze({ connectorKey: 'facebook', sourceAccountKey: null }),
  instagram: Object.freeze({ connectorKey: 'instagram', sourceAccountKey: null }),
  'meta-ads-chemistry-k2': Object.freeze({ connectorKey: 'meta_ads', sourceAccountKey: 'chemistry_k2' }),
  'meta-ads-chemistry-k3': Object.freeze({ connectorKey: 'meta_ads', sourceAccountKey: 'chemistry_k3' }),
});

const REQUIRED_EVIDENCE = Object.freeze({
  preflight: Object.freeze([]),
  facebook: Object.freeze(['preflight']),
  instagram: Object.freeze(['preflight', 'facebook']),
  'meta-ads-chemistry-k2': Object.freeze(['preflight', 'facebook', 'instagram']),
  'meta-ads-chemistry-k3': Object.freeze([
    'preflight',
    'facebook',
    'instagram',
    'meta-ads-chemistry-k2',
  ]),
  summary: Object.freeze([
    'preflight',
    'facebook',
    'instagram',
    'meta-ads-chemistry-k2',
    'meta-ads-chemistry-k3',
  ]),
});

const EXECUTABLE_PHASES = new Set(META_READ_ONLY_VALIDATION_PHASES.filter((phase) => phase !== 'plan'));

export function parseMetaReadOnlyValidationArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg.startsWith('--phase=')) {
      phase = arg.slice('--phase='.length);
      continue;
    }
    throw operatorError(
      `Unknown Meta read-only validation argument: ${arg}`,
      'META_READ_ONLY_VALIDATION_ARGUMENT_INVALID',
    );
  }
  if (!META_READ_ONLY_VALIDATION_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported Meta read-only validation phase: ${phase}`,
      'META_READ_ONLY_VALIDATION_PHASE_INVALID',
      { phase },
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertMetaReadOnlyValidationConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const confirmation = META_READ_ONLY_VALIDATION_CONFIRMATIONS[phase];
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw operatorError(
      `Meta read-only validation requires ${confirmation.envName}=${confirmation.value}`,
      'META_READ_ONLY_VALIDATION_CONFIRMATION_REQUIRED',
      { phase, envName: confirmation.envName },
    );
  }
  return true;
}

export function loadMetaReadOnlyValidationTarget(env = {}) {
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, EXPECTED_IDENTITIES.customerKey, 'MKT_CONNECTION_CUSTOMER_KEY');
  for (const flag of REQUIRED_FALSE_FLAGS) requireExactFalse(env[flag], flag);

  const config = loadMetaTokenConnectionConfig(env);
  if (!config.apiVersion) {
    throw operatorError(
      'Meta Graph API version is required for customer validation',
      'META_READ_ONLY_VALIDATION_TARGET_INVALID',
      { fieldName: 'META_GRAPH_API_VERSION' },
    );
  }
  if (!config.credentials.facebookAccessToken || !config.credentials.instagramAccessToken) {
    throw operatorError(
      'Both Meta customer credentials are required for the ordered read-only validation',
      'META_READ_ONLY_VALIDATION_CREDENTIALS_MISSING',
    );
  }
  assertExactIdentities(config.mappings);

  return deepFreeze({
    contractVersion: META_READ_ONLY_VALIDATION_CONTRACT_VERSION,
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: EXPECTED_IDENTITIES.customerKey,
    apiVersion: config.apiVersion,
    facebookMappingConfigured: true,
    instagramMappingConfigured: true,
    metaAdAccountKeys: EXPECTED_IDENTITIES.metaAdAccounts.map((entry) => entry.key),
    executionFlagsEnabled: false,
    schedulesEnabled: false,
  });
}

export function resolveMetaReadOnlyValidationScope(phase) {
  const scope = PHASE_SCOPES[phase] ?? null;
  if (!scope) {
    throw operatorError(
      `Phase ${phase} does not execute a Provider validation`,
      'META_READ_ONLY_VALIDATION_SCOPE_INVALID',
      { phase },
    );
  }
  return scope;
}

export function requiredMetaReadOnlyEvidencePhases(phase) {
  const required = REQUIRED_EVIDENCE[phase];
  if (!required) {
    throw operatorError(
      `Phase ${phase} has no evidence contract`,
      'META_READ_ONLY_VALIDATION_PHASE_INVALID',
      { phase },
    );
  }
  return required;
}

export function validateMetaReadOnlyConnectionResult(result = {}, expectedConnectorKey) {
  const connectorKey = requireText(expectedConnectorKey, 'expectedConnectorKey');
  const safe = sanitizeMetaReadOnlyConnectionResult(result);
  const accepted = safe.connectorKey === connectorKey
    && safe.configured === true
    && safe.status === META_TOKEN_CONNECTION_STATUSES.IDENTITY_VALIDATED
    && safe.mappingConfigured === true
    && safe.identityMatched === true
    && safe.permissions.missing.length === 0
    && safe.providerError === null;
  if (!accepted) {
    throw operatorError(
      'Meta read-only customer validation did not pass the exact identity and permission gates',
      'META_READ_ONLY_VALIDATION_FAILED',
      { connectorKey, result: safe },
    );
  }
  return safe;
}

export function sanitizeMetaReadOnlyConnectionResult(result = {}) {
  const permissions = result?.permissions && typeof result.permissions === 'object'
    ? result.permissions
    : {};
  return deepFreeze({
    connectorKey: optionalText(result.connectorKey),
    configured: result.configured === true,
    status: optionalText(result.status),
    candidateCount: safeCount(result.candidateCount),
    mappingConfigured: result.mappingConfigured === true,
    identityMatched: result.identityMatched === true,
    permissions: {
      validation: optionalText(permissions.validation),
      required: safeTextList(permissions.required),
      missing: safeTextList(permissions.missing),
    },
    metadata: sanitizeMetadata(result.metadata),
    providerError: sanitizeProviderError(result.providerError),
  });
}

export function summarizeMetaReadOnlyRequestEvents(events = []) {
  const safeEvents = Array.isArray(events) ? events : [];
  const operations = new Set();
  let started = 0;
  let succeeded = 0;
  let retried = 0;
  let failed = 0;
  for (const event of safeEvents) {
    const stage = optionalText(event?.stage);
    const operation = optionalText(event?.operation);
    if (operation) operations.add(operation);
    if (stage === 'meta_request_start') started += 1;
    else if (stage === 'meta_request_success') succeeded += 1;
    else if (stage === 'meta_request_retry') retried += 1;
    else if (stage === 'meta_request_failed') failed += 1;
  }
  return deepFreeze({
    requestAttempts: started,
    successfulRequests: succeeded,
    retries: retried,
    failedRequests: failed,
    operations: [...operations].sort(),
    transportMethod: 'GET',
    tokenInQuery: false,
  });
}

export function expectedMetaReadOnlyIdentitySummary() {
  return deepFreeze({
    customerKey: EXPECTED_IDENTITIES.customerKey,
    facebookPageCount: 1,
    instagramAccountCount: 1,
    metaAdAccountKeys: EXPECTED_IDENTITIES.metaAdAccounts.map((entry) => entry.key),
    metaAdAccountCount: EXPECTED_IDENTITIES.metaAdAccounts.length,
  });
}

function assertExactIdentities(mappings = {}) {
  if (mappings.facebookPageId !== EXPECTED_IDENTITIES.facebookPageId) {
    throw identityMismatch('META_FACEBOOK_PAGE_ID');
  }
  if (mappings.instagramAccountId !== EXPECTED_IDENTITIES.instagramAccountId) {
    throw identityMismatch('META_INSTAGRAM_ACCOUNT_ID');
  }
  const observed = Array.isArray(mappings.metaAdAccounts)
    ? mappings.metaAdAccounts.map((entry) => ({ key: entry?.key, accountId: entry?.accountId }))
    : [];
  if (JSON.stringify(observed) !== JSON.stringify(EXPECTED_IDENTITIES.metaAdAccounts)) {
    throw identityMismatch('META_AD_ACCOUNT_MAPPINGS');
  }
}

function identityMismatch(fieldName) {
  return operatorError(
    'Meta read-only validation target does not match the approved Chemistry K identity mapping',
    'META_READ_ONLY_VALIDATION_IDENTITY_MISMATCH',
    { fieldName },
  );
}

function sanitizeMetadata(value) {
  const source = value && typeof value === 'object' ? value : {};
  const allowed = [
    'linkedInstagramCount',
    'accountType',
    'activeCandidateCount',
    'expectedAccountCount',
    'matchedAccountCount',
    'missingAccountCount',
  ];
  return Object.freeze(Object.fromEntries(allowed.map((key) => [
    key,
    key === 'accountType' ? optionalText(source[key]) : safeCount(source[key]),
  ]).filter(([, value]) => value !== null)));
}

function sanitizeProviderError(value) {
  if (!value || typeof value !== 'object') return null;
  return deepFreeze({
    code: optionalText(value.code),
    graphCode: Number.isFinite(Number(value.graphCode)) ? Number(value.graphCode) : null,
    retryable: value.retryable === true,
  });
}

function safeTextList(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.map(optionalText).filter(Boolean))].sort());
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw operatorError(
      `Meta read-only validation requires ${fieldName}=${expected}`,
      'META_READ_ONLY_VALIDATION_TARGET_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireExactFalse(value, fieldName) {
  if (value === undefined || value === null || value === '') return false;
  if (value !== false && value !== 'false') {
    throw operatorError(
      `Meta read-only validation requires ${fieldName}=false`,
      'META_READ_ONLY_VALIDATION_UNSAFE_FLAGS',
      { fieldName },
    );
  }
  return false;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `Meta read-only validation requires ${fieldName}`,
      'META_READ_ONLY_VALIDATION_ARGUMENT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim() || null
    : null;
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
