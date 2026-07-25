import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords';

/** Fail closed unless encrypted Customer Connection state matches the signed source identity exactly. */
export async function assertGoogleAdsLiveAuthorization(input = {}) {
  const store = requireMethod(input.connectionStore, 'findValidatedConnection');
  const expected = normalizeExpectedIdentity(input);
  const connection = await store.findValidatedConnection({
    customerKey: expected.customerKey,
    advertiserCustomerId: expected.customerId,
  });
  if (!connection) {
    throw permanentError('Validated Google Ads customer connection is required', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_REQUIRED',
    });
  }
  if (connection.customerKey !== expected.customerKey
    || connection.connectorKey !== 'google_ads'
    || connection.connectionStatus !== 'connected'
    || connection.accessStatus !== 'validated'
    || connection.advertiserCustomerId !== expected.customerId) {
    throw permanentError('Google Ads customer connection identity is inconsistent', {
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

  const currencyCode = optionalUpper(connection.providerMetadata?.currencyCode);
  const timeZone = optionalText(connection.providerMetadata?.timeZone);
  const managerCustomerId = optionalCustomerId(connection.providerMetadata?.managerCustomerId);
  if (currencyCode !== expected.currencyCode || timeZone !== expected.sourceTimezone) {
    throw permanentError('Google Ads customer connection account metadata is inconsistent', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_METADATA_MISMATCH',
      details: {
        currencyMatches: currencyCode === expected.currencyCode,
        timezoneMatches: timeZone === expected.sourceTimezone,
      },
    });
  }
  if (managerCustomerId && managerCustomerId !== expected.managerCustomerId) {
    throw permanentError('Google Ads customer connection manager identity is inconsistent', {
      code: 'GOOGLE_ADS_CUSTOMER_CONNECTION_MANAGER_MISMATCH',
    });
  }

  return Object.freeze({
    connectionId: connection.connectionId,
    credentialReference: connection.credentialReference,
    credentialKeyVersion: connection.credentialKeyVersion,
    customerKey: expected.customerKey,
    managerCustomerId: expected.managerCustomerId,
    advertiserCustomerId: expected.customerId,
    currencyCode,
    sourceTimezone: timeZone,
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
  return requireCustomerId(String(value), 'managerCustomerId');
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
