const CHATWOOT_ACCESS_TOKEN_SECRET = 'CHATWOOT_API_ACCESS_TOKEN';
const EXISTING_REQUIRED_SECRETS = Object.freeze(['LARK_APP_ID', 'LARK_APP_SECRET']);

export const CHATWOOT_FINAL_SECRET_NAMES = Object.freeze([
  CHATWOOT_ACCESS_TOKEN_SECRET,
  ...EXISTING_REQUIRED_SECRETS,
]);

export function parseChatwootWorkerSecretNames(output) {
  let parsed;
  try {
    parsed = typeof output === 'string' ? JSON.parse(output) : output;
  } catch (cause) {
    throw secretError(
      'Worker Secret list returned invalid JSON',
      'CHATWOOT_FINAL_UAT_SECRET_LIST_INVALID',
      { cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.result;
  if (!Array.isArray(items)) {
    throw secretError(
      'Worker Secret list contract is invalid',
      'CHATWOOT_FINAL_UAT_SECRET_LIST_INVALID',
    );
  }
  const names = items.map((item) => optionalText(item?.name)).filter(Boolean);
  if (names.length !== items.length || new Set(names).size !== names.length) {
    throw secretError(
      'Worker Secret names are missing or duplicated',
      'CHATWOOT_FINAL_UAT_SECRET_LIST_INVALID',
    );
  }
  return Object.freeze([...names].sort());
}

export function resolveChatwootFinalSecretBootstrap(input = {}) {
  const remoteSecretNames = normalizeNames(input.remoteSecretNames);
  const missingExisting = EXISTING_REQUIRED_SECRETS.filter((name) => !remoteSecretNames.includes(name));
  if (missingExisting.length) {
    throw secretError(
      'Required existing Worker Secret names are missing',
      'CHATWOOT_FINAL_UAT_SECRET_MISSING',
      { missing: missingExisting },
    );
  }

  if (remoteSecretNames.includes(CHATWOOT_ACCESS_TOKEN_SECRET)) {
    return createPlan({
      provision: false,
      source: 'remote_existing',
      secretValue: null,
    });
  }

  if (typeof input.readLocalAccessToken !== 'function') {
    throw secretError(
      'Local Chatwoot access-token reader is required',
      'CHATWOOT_FINAL_UAT_LOCAL_SECRET_MISSING',
    );
  }
  const secretValue = optionalText(input.readLocalAccessToken());
  if (!secretValue || /^replace-with-/iu.test(secretValue)) {
    throw secretError(
      'CHATWOOT_API_ACCESS_TOKEN is absent from the private local environment',
      'CHATWOOT_FINAL_UAT_LOCAL_SECRET_MISSING',
      { secretName: CHATWOOT_ACCESS_TOKEN_SECRET },
    );
  }
  return createPlan({
    provision: true,
    source: 'local_dev_vars_staged',
    secretValue,
  });
}

export function serializeChatwootFinalSecretsFile(plan) {
  if (!plan?.provision || optionalText(plan.secretValue) === null) {
    throw secretError(
      'Chatwoot Secret bootstrap plan does not contain a staged value',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_INVALID',
    );
  }
  return `${JSON.stringify({ [CHATWOOT_ACCESS_TOKEN_SECRET]: plan.secretValue })}\n`;
}

export function assertChatwootFinalWorkerSecrets(remoteSecretNames) {
  const names = normalizeNames(remoteSecretNames);
  const missing = CHATWOOT_FINAL_SECRET_NAMES.filter((name) => !names.includes(name));
  if (missing.length) {
    throw secretError(
      'Required Worker Secret names are missing after bootstrap',
      'CHATWOOT_FINAL_UAT_SECRET_MISSING',
      { missing },
    );
  }
  return Object.freeze({
    verified: true,
    requiredSecretCount: CHATWOOT_FINAL_SECRET_NAMES.length,
  });
}

export function summarizeChatwootFinalSecretPlan(plan) {
  return Object.freeze({
    provisionedByLauncher: Boolean(plan?.provision),
    source: plan?.source ?? null,
    secretName: CHATWOOT_ACCESS_TOKEN_SECRET,
    requiredSecretCount: CHATWOOT_FINAL_SECRET_NAMES.length,
  });
}

function createPlan({ provision, source, secretValue }) {
  const plan = {
    provision,
    source,
    secretName: CHATWOOT_ACCESS_TOKEN_SECRET,
  };
  Object.defineProperty(plan, 'secretValue', {
    value: secretValue,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(plan);
}

function normalizeNames(value) {
  if (!Array.isArray(value)) {
    throw secretError(
      'Worker Secret names must be an array',
      'CHATWOOT_FINAL_UAT_SECRET_LIST_INVALID',
    );
  }
  const names = value.map(optionalText);
  if (names.some((name) => name === null) || new Set(names).size !== names.length) {
    throw secretError(
      'Worker Secret names are invalid or duplicated',
      'CHATWOOT_FINAL_UAT_SECRET_LIST_INVALID',
    );
  }
  return Object.freeze([...names].sort());
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function secretError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalSecretBootstrapError';
  error.code = code;
  error.details = details;
  return error;
}
