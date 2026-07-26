import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const SCRIPT_AUTHORIZED_ACCESS_STATUSES = Object.freeze(new Set([
  'validated',
  'google_ads_api_access_pending',
]));

/**
 * Fail closed unless Customer Connection consent, encrypted credential and the
 * approved Manager Script identities match the signed source exactly.
 *
 * Google Ads API developer-token approval is intentionally not a prerequisite
 * for Manager Script signed delivery. The Script payload remains protected by
 * the existing signature, replay, runtime-identity and manifest validation.
 */
export async function assertGoogleAdsLiveAuthorization(input = {}) {
  const store = requireMethod(input.connectionStore, 'findScriptAuthorizedConnection');
  const expected = normalizeExpectedIdentity(input);
  const connection = await store.findScriptAuthorizedConnection({
    customerKey: expected.customerKey,
  });
  if (!connection) {
    throw permanentError('Script-authorized Google Ads customer connection is required', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_REQUIRED',
    });
  }

  if (connection.customerKey !== expected.customerKey
    || connection.connectorKey !== 'google_ads'
    || connection.connectionStatus !== 'connected'
    || !SCRIPT_AUTHORIZED_ACCESS_STATUSES.has(connection.accessStatus)) {
    throw permanentError('Google Ads customer connection state is inconsistent', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_IDENTITY_MISMATCH',
    });
  }

  if (!connection.grantedScopes.includes(ADWORDS_SCOPE)) {
    throw permanentError('Google Ads customer connection scope is insufficient', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_SCOPE_INSUFFICIENT',
    });
  }
  if (!connection.credentialReference
    || connection.credentialReference !== connection.activeCredentialReference) {
    throw permanentError('Google Ads active encrypted credential is unavailable', {
      code: 'GOOGLE_ADS_CUSTOMER_CREDENTIAL_UNAVAILABLE',
    });
  }

  const metadata = connection.providerMetadata ?? {};
  const approvedAdvertiserCustomerId = optionalCustomerId(metadata.approvedAdvertiserCustomerId);
  const validatedAdvertiserCustomerId = optionalCustomerId(
    connection.advertiserCustomerId ?? metadata.advertiserCustomerId,
  );
  const advertiserMatches = connection.accessStatus === 'google_ads_api_access_pending'
    ? approvedAdvertiserCustomerId === expected.customerId
    : approvedAdvertiserCustomerId === expected.customerId
      || validatedAdvertiserCustomerId === expected.customerId;
  if (!advertiserMatches
    || (validatedAdvertiserCustomerId && validatedAdvertiserCustomerId !== expected.customerId)) {
    throw permanentError('Google Ads approved advertiser identity is inconsistent', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_IDENTITY_MISMATCH',
    });
  }

  const managerCustomerId = optionalCustomerId(metadata.managerCustomerId);
  if (managerCustomerId !== expected.managerCustomerId) {
    throw permanentError('Google Ads customer connection manager identity is inconsistent', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_MANAGER_MISMATCH',
    });
  }

  const currencyCode = optionalUpper(metadata.currencyCode);
  const timeZone = optionalText(metadata.timeZone);
  if ((currencyCode && currencyCode !== expected.currencyCode)
    || (timeZone && timeZone !== expected.sourceTimezone)) {
    throw permanentError('Google Ads customer connection account metadata is inconsistent', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_METADATA_MISMATCH',
      details: {
        currencyMatches: !currencyCode || currencyCode === expected.currencyCode,
        timezoneMatches: !timeZone || timeZone === expected.sourceTimezone,
      },
    });
  }

  return Object.freeze({
    connectionId: connection.connectionId,
    credentialReference: connection.credentialReference,
    credentialKeyVersion: connection.credentialKeyVersion,
    customerKey: expected.customerKey,
    managerCustomerId: expected.managerCustomerId,
    advertiserCustomerId: expected.customerId,
    currencyCode: expected.currencyCode,
    sourceTimezone: expected.sourceTimezone,
    accessStatus: connection.accessStatus,
    apiAccessValidated: connection.accessStatus === 'validated',
    authorizationSource: 'manager_script_signed_delivery',
    lastValidatedAt: connection.lastValidatedAt,
  });
}

function normalizeExpectedIdentity(input) {
  return Object.freeze({
    customerKey: requireText(input.customerKey, 'customerKey'),
    managerCustomerId: requireCustomerId(input.managerCustomerId, 'managerCustomerId'),
    customerId: requireCustomerId(input.customerId, 'customerId'),
    currencyCode: requireCurrency(input.currencyCode),
    sourceTimezone: requireText(input.sourceTimezone, 'sourceTimezone'),
  });
}

function requireMethod(value, method) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`connectionStore.${method} is required`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireCustomerId(value, fieldName) {
  const id = requireText(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(id)) throw new TypeError(`${fieldName} must be a 10-digit customer ID`);
  return id;
}

function optionalCustomerId(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireCustomerId(String(value), 'customerId');
}

function requireCurrency(value) {
  const currency = requireText(value, 'currencyCode').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new TypeError('currencyCode must be ISO-4217');
  return currency;
}

function optionalUpper(value) {
  const text = optionalText(value);
  return text ? text.toUpperCase() : null;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}
