import { createHash } from 'node:crypto';

export const CHATWOOT_PROVIDER_PREFLIGHT_CONTRACT_VERSION = 'chatwoot_provider_get_only_preflight_v1';
export const CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION = 'RUN_CHATWOOT_PROVIDER_GET_ONLY';

const EXPECTED_ENVIRONMENT = 'development';
const EXPECTED_CUSTOMER_PROFILE = 'integration_workspace';
const EXPECTED_CUSTOMER_KEY = 'chemistry_k';

export function parseChatwootProviderPreflightArgs(args = []) {
  const values = [...args];
  if (values.length === 0) return Object.freeze({ execute: false });
  if (values.length === 1 && values[0] === '--execute') return Object.freeze({ execute: true });
  throw operatorError(
    'Chatwoot Provider preflight accepts only --execute',
    'CHATWOOT_PROVIDER_PREFLIGHT_ARGUMENT_INVALID',
    { args: values },
  );
}

export function assertChatwootProviderPreflightConfirmation(env = {}) {
  if (env.CONFIRM_CHATWOOT_PROVIDER_GET_ONLY !== CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION) {
    throw operatorError(
      'Exact Chatwoot Provider GET-only confirmation is required',
      'CHATWOOT_PROVIDER_PREFLIGHT_CONFIRMATION_REQUIRED',
    );
  }
}

export function loadChatwootProviderPreflightTarget(env = {}) {
  requireExact(env.MKT_ENV, EXPECTED_ENVIRONMENT, 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, EXPECTED_CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, EXPECTED_CUSTOMER_KEY, 'MKT_CONNECTION_CUSTOMER_KEY');

  const baseUrl = normalizeHttpsOrigin(env.CHATWOOT_BASE_URL);
  const accountId = positiveInteger(env.CHATWOOT_ACCOUNT_ID, 'CHATWOOT_ACCOUNT_ID');
  const accessToken = requireText(env.CHATWOOT_API_ACCESS_TOKEN, 'CHATWOOT_API_ACCESS_TOKEN');
  const deploymentType = optionalText(env.CHATWOOT_DEPLOYMENT_TYPE) ?? 'self_hosted';
  if (deploymentType !== 'self_hosted') {
    throw operatorError(
      'Chatwoot Provider preflight requires the reviewed self-hosted deployment type',
      'CHATWOOT_PROVIDER_DEPLOYMENT_TYPE_INVALID',
      { deploymentType },
    );
  }

  return Object.freeze({
    contractVersion: CHATWOOT_PROVIDER_PREFLIGHT_CONTRACT_VERSION,
    environment: EXPECTED_ENVIRONMENT,
    customerProfile: EXPECTED_CUSTOMER_PROFILE,
    customerKey: EXPECTED_CUSTOMER_KEY,
    baseUrl,
    accountId,
    accessToken,
    deploymentType,
  });
}

export function classifyChatwootReportingPermissionError(error) {
  const status = Number(error?.details?.status ?? 0);
  const operation = optionalText(error?.details?.operation);
  if (operation !== 'list_reporting_events' || ![401, 403].includes(status)) return null;

  return Object.freeze({
    code: 'CHATWOOT_REPORTING_ADMIN_REQUIRED',
    status,
    operation,
    requiredRole: 'administrator',
    action: 'promote_integration_user_to_administrator_then_rerun',
  });
}

export function buildChatwootProviderPreflightEvidence(input = {}) {
  const target = requireObject(input.target, 'target');
  const profile = requireObject(input.profile, 'profile');
  const account = requireObject(input.account, 'account');
  const endpointChecks = requireObject(input.endpointChecks, 'endpointChecks');
  const requestSummary = requireObject(input.requestSummary, 'requestSummary');
  const blocker = input.reportingPermissionBlocker ?? null;
  const accepted = blocker === null;

  return Object.freeze({
    contractVersion: CHATWOOT_PROVIDER_PREFLIGHT_CONTRACT_VERSION,
    phase: 'provider-get-only-preflight',
    status: accepted ? 'passed' : 'blocked',
    capturedAt: requireText(input.capturedAt, 'capturedAt'),
    targetFingerprint: createTargetFingerprint(target),
    target: createSafeTarget(target),
    identity: Object.freeze({
      profileValidated: true,
      exactAccountMatch: true,
      visibleAccountCount: nonNegativeInteger(input.visibleAccountCount, 'visibleAccountCount'),
      profileUserFingerprint: sha256(profile.id ?? 'unknown'),
      accountNameFingerprint: sha256(account.name ?? String(target.accountId)),
      role: optionalText(profile.role) ?? 'unknown',
      accountPermissionCount: Array.isArray(account.permissions) ? account.permissions.length : 0,
    }),
    endpointChecks,
    requestSummary,
    accepted,
    decision: accepted ? 'PASS_CHATWOOT_PROVIDER_GET_ONLY' : blocker.code,
    blocker,
    nextGate: accepted
      ? 'chatwoot_lark_metadata_and_mapping_preflight'
      : 'chatwoot_integration_user_role_update',
    boundaries: Object.freeze({
      transport: 'GET_only',
      providerMutationCount: 0,
      d1MutationCount: 0,
      queueActionCount: 0,
      larkMutationCount: 0,
      workerDeploymentCount: 0,
      scheduleWebhookActionCount: 0,
      tokenPersisted: false,
      rawProviderPayloadPersisted: false,
    }),
  });
}

export function summarizeChatwootProviderRequestEvents(events = []) {
  const summary = {
    requestAttempts: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retries: 0,
  };
  for (const event of events) {
    if (event?.stage === 'chatwoot_request_start') summary.requestAttempts += 1;
    if (event?.stage === 'chatwoot_request_success') summary.successfulRequests += 1;
    if (event?.stage === 'chatwoot_request_failed') summary.failedRequests += 1;
    if (event?.stage === 'chatwoot_request_retry') summary.retries += 1;
  }
  return Object.freeze(summary);
}

function createTargetFingerprint(target) {
  return sha256(JSON.stringify(createSafeTarget(target)));
}

function createSafeTarget(target) {
  return Object.freeze({
    contractVersion: target.contractVersion,
    environment: target.environment,
    customerProfile: target.customerProfile,
    customerKey: target.customerKey,
    deploymentType: target.deploymentType,
    baseUrlFingerprint: sha256(target.baseUrl),
    accountFingerprint: sha256(`${target.baseUrl}|${target.accountId}`),
  });
}

function normalizeHttpsOrigin(value) {
  const text = requireText(value, 'CHATWOOT_BASE_URL');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw operatorError(
      'CHATWOOT_BASE_URL must be a valid URL',
      'CHATWOOT_PROVIDER_BASE_URL_INVALID',
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw operatorError(
      'CHATWOOT_BASE_URL must be an HTTPS origin without credentials, query or fragment',
      'CHATWOOT_PROVIDER_BASE_URL_INVALID',
    );
  }
  return url.origin;
}

function requireExact(value, expected, fieldName) {
  const actual = requireText(value, fieldName);
  if (actual !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'CHATWOOT_PROVIDER_TARGET_INVALID',
      { fieldName, expected, actual },
    );
  }
  return actual;
}

function positiveInteger(value, fieldName) {
  const number = Number(requireText(value, fieldName));
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw operatorError(
      `${fieldName} must be a positive integer`,
      'CHATWOOT_PROVIDER_ACCOUNT_ID_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError(
      `${fieldName} must be a non-negative integer`,
      'CHATWOOT_PROVIDER_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw operatorError(
      `${fieldName} must be an object`,
      'CHATWOOT_PROVIDER_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'CHATWOOT_PROVIDER_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootProviderPreflightError';
  error.code = code;
  error.details = details;
  return error;
}
