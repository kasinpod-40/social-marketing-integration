import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION =
  'google_ads_signing_secret_provisioning_v1';
export const GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH =
  '/v1/google-ads/manager-script/signing-secret/redeem';
export const GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH =
  '/v1/google-ads/manager-script/signing-secret/confirm';
export const GOOGLE_ADS_SIGNING_PROVISIONING_PROOF_HEADER =
  'x-mkt-provisioning-proof';
export const GOOGLE_ADS_SIGNING_PROVISIONING_LIMITS = Object.freeze({
  bodyBytes: 4_096,
  ticketBytes: 32,
  challengeBytes: 32,
  clientNonceBytes: 16,
  ticketTtlMs: 5 * 60 * 1_000,
});
export const GOOGLE_ADS_SIGNING_PROVISIONING_STATUSES = Object.freeze([
  'active',
  'redeemed',
  'confirmed',
  'expired',
  'cancelled',
]);

const REDEEM_FIELDS = Object.freeze([
  'schemaVersion',
  'managerCustomerId',
  'customerId',
  'customerKey',
  'accountKey',
  'keyId',
  'clientNonce',
]);
const CONFIRM_FIELDS = Object.freeze([...REDEEM_FIELDS, 'challenge']);
const RUNTIME_FIELDS = Object.freeze([
  'environment',
  'profileKey',
  'managerCustomerId',
  'customerId',
  'customerKey',
  'accountKey',
  'keyId',
]);

/** Normalize non-secret runtime binding used by ticket identity fingerprints. */
export function normalizeGoogleAdsSigningProvisioningRuntimeIdentity(value) {
  const source = exactObject(value, RUNTIME_FIELDS, 'runtimeIdentity');
  return deepFreeze({
    environment: requirePattern(
      source.environment,
      'runtimeIdentity.environment',
      /^(?:development|production)$/u,
    ),
    profileKey: requirePattern(
      source.profileKey,
      'runtimeIdentity.profileKey',
      /^[A-Za-z0-9._-]{1,64}$/u,
    ),
    managerCustomerId: requireCustomerId(
      source.managerCustomerId,
      'runtimeIdentity.managerCustomerId',
    ),
    customerId: requireCustomerId(source.customerId, 'runtimeIdentity.customerId'),
    customerKey: requireIdentityKey(source.customerKey, 'runtimeIdentity.customerKey'),
    accountKey: requireIdentityKey(source.accountKey, 'runtimeIdentity.accountKey'),
    keyId: requireKeyId(source.keyId, 'runtimeIdentity.keyId'),
  });
}

/** Validate exact canonical redeem payload and bind it to runtime identity. */
export function validateGoogleAdsSigningProvisioningRedeem(value, runtimeIdentity) {
  return validatePayload(value, runtimeIdentity, false);
}

/** Validate exact canonical confirmation payload and bind it to runtime identity. */
export function validateGoogleAdsSigningProvisioningConfirm(value, runtimeIdentity) {
  return validatePayload(value, runtimeIdentity, true);
}

/** Exact HMAC input used by Worker and temporary Manager Script helper. */
export function createGoogleAdsSigningProvisioningConfirmationInput(input = {}) {
  return [
    'MKT-GOOGLE-ADS-PROVISIONING-CONFIRM-V1',
    requireKeyId(input.keyId, 'keyId'),
    requireClientNonce(input.clientNonce, 'clientNonce'),
    requireChallenge(input.challenge, 'challenge'),
  ].join('\n');
}

function validatePayload(value, runtimeIdentity, confirmation) {
  const identity = normalizeGoogleAdsSigningProvisioningRuntimeIdentity(runtimeIdentity);
  const payload = exactObject(
    value,
    confirmation ? CONFIRM_FIELDS : REDEEM_FIELDS,
    confirmation ? 'confirmation' : 'redeem',
  );
  requireEqual(
    payload.schemaVersion,
    GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
    'schemaVersion',
  );
  const normalized = {
    schemaVersion: GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
    managerCustomerId: requireCustomerId(payload.managerCustomerId, 'managerCustomerId'),
    customerId: requireCustomerId(payload.customerId, 'customerId'),
    customerKey: requireIdentityKey(payload.customerKey, 'customerKey'),
    accountKey: requireIdentityKey(payload.accountKey, 'accountKey'),
    keyId: requireKeyId(payload.keyId, 'keyId'),
    clientNonce: requireClientNonce(payload.clientNonce, 'clientNonce'),
    ...(confirmation ? { challenge: requireChallenge(payload.challenge, 'challenge') } : {}),
  };
  for (const fieldName of [
    'managerCustomerId',
    'customerId',
    'customerKey',
    'accountKey',
    'keyId',
  ]) requireEqual(normalized[fieldName], identity[fieldName], fieldName);
  return deepFreeze(normalized);
}

function exactObject(value, fields, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${fieldName} must be an object`, fieldName);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw invalid(`${fieldName} fields do not match the exact contract`, fieldName);
  }
  return value;
}

function requireEqual(actual, expected, fieldName) {
  if (actual !== expected) {
    throw invalid(`${fieldName} does not match the runtime contract`, fieldName);
  }
  return actual;
}

function requireCustomerId(value, fieldName) {
  const normalized = requireText(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(normalized)) throw invalid(`${fieldName} is invalid`, fieldName);
  return normalized;
}

function requireIdentityKey(value, fieldName) {
  return requirePattern(value, fieldName, /^[A-Za-z0-9._:-]{1,128}$/u);
}

function requireKeyId(value, fieldName) {
  return requirePattern(value, fieldName, /^[A-Za-z0-9._-]{1,64}$/u);
}

function requireClientNonce(value, fieldName) {
  return requirePattern(value, fieldName, /^[A-Za-z0-9_-]{22}$/u);
}

function requireChallenge(value, fieldName) {
  return requirePattern(value, fieldName, /^[A-Za-z0-9_-]{43}$/u);
}

function requirePattern(value, fieldName, pattern) {
  const text = requireText(value, fieldName);
  if (!pattern.test(text)) throw invalid(`${fieldName} is invalid`, fieldName);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`${fieldName} is required`, fieldName);
  }
  return value.trim();
}

function invalid(message, fieldName) {
  return permanentError(message, {
    code: 'GOOGLE_ADS_PROVISIONING_CONTRACT_INVALID',
    details: { fieldName },
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
