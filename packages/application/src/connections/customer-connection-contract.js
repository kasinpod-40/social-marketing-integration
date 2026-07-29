import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const CUSTOMER_CONNECTION_CONNECTORS = Object.freeze({
  GOOGLE_ADS: 'google_ads',
  YOUTUBE: 'youtube',
  TIKTOK_ADS: 'tiktok_ads',
});

export const CUSTOMER_CONNECTION_STATUSES = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  AUTHORIZATION_PENDING: 'authorization_pending',
  CONNECTED: 'connected',
  CONNECTED_ACCESS_PENDING: 'connected_access_pending',
  IDENTITY_SELECTION_REQUIRED: 'identity_selection_required',
  IDENTITY_MISMATCH: 'identity_mismatch',
  SCOPE_INSUFFICIENT: 'scope_insufficient',
  TOKEN_REFRESH_FAILED: 'token_refresh_failed',
  REVOKED: 'revoked',
  DISCONNECTED: 'disconnected',
});

export const CUSTOMER_CONNECTION_ACCESS_STATUSES = Object.freeze({
  NOT_VALIDATED: 'not_validated',
  VALIDATED: 'validated',
  GOOGLE_ADS_API_ACCESS_PENDING: 'google_ads_api_access_pending',
  IDENTITY_SELECTION_REQUIRED: 'identity_selection_required',
  IDENTITY_MISMATCH: 'identity_mismatch',
  SCOPE_INSUFFICIENT: 'scope_insufficient',
  REVOKED: 'revoked',
});

export const GOOGLE_OAUTH_SCOPES = Object.freeze({
  [CUSTOMER_CONNECTION_CONNECTORS.GOOGLE_ADS]: Object.freeze([
    'https://www.googleapis.com/auth/adwords',
  ]),
  [CUSTOMER_CONNECTION_CONNECTORS.YOUTUBE]: Object.freeze([
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ]),
});

export const CONNECTOR_ROUTE_SLUGS = Object.freeze({
  [CUSTOMER_CONNECTION_CONNECTORS.GOOGLE_ADS]: 'google-ads',
  [CUSTOMER_CONNECTION_CONNECTORS.YOUTUBE]: 'youtube',
  [CUSTOMER_CONNECTION_CONNECTORS.TIKTOK_ADS]: 'tiktok-ads',
});

export const DEFAULT_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_INVITATION_MAX_ATTEMPTS = 3;

const CONNECTOR_VALUES = new Set(Object.values(CUSTOMER_CONNECTION_CONNECTORS));
const CONNECTION_STATUS_VALUES = new Set(Object.values(CUSTOMER_CONNECTION_STATUSES));
const ACCESS_STATUS_VALUES = new Set(Object.values(CUSTOMER_CONNECTION_ACCESS_STATUSES));

export function requireCustomerConnectionConnector(value) {
  const connectorKey = requireText(value, 'connectorKey');
  if (!CONNECTOR_VALUES.has(connectorKey)) {
    throw permanentError('Customer connection connector is unsupported', {
      code: 'CONNECTION_CONNECTOR_UNSUPPORTED',
    });
  }
  return connectorKey;
}

export function requireConnectionStatus(value) {
  const status = requireText(value, 'connectionStatus');
  if (!CONNECTION_STATUS_VALUES.has(status)) {
    throw permanentError('Customer connection status is unsupported', {
      code: 'CONNECTION_STATUS_INVALID',
    });
  }
  return status;
}

export function requireConnectionAccessStatus(value) {
  const status = requireText(value, 'accessStatus');
  if (!ACCESS_STATUS_VALUES.has(status)) {
    throw permanentError('Customer connection access status is unsupported', {
      code: 'CONNECTION_ACCESS_STATUS_INVALID',
    });
  }
  return status;
}

export function requireExactGrantedScopes(connectorKey, grantedScopes) {
  const connector = requireCustomerConnectionConnector(connectorKey);
  if (!Array.isArray(grantedScopes)) {
    throw permanentError('Google OAuth granted scopes are invalid', {
      code: 'CONNECTION_GRANTED_SCOPES_INVALID',
    });
  }
  if (connector === CUSTOMER_CONNECTION_CONNECTORS.TIKTOK_ADS) {
    return Object.freeze([...new Set(grantedScopes.map((scope) => requireText(scope, 'grantedScope')))].sort());
  }
  const normalized = [...new Set(grantedScopes.map((scope) => requireText(scope, 'grantedScope')))].sort();
  const required = [...GOOGLE_OAUTH_SCOPES[connector]].sort();
  const missing = required.filter((scope) => !normalized.includes(scope));
  if (missing.length > 0) {
    throw permanentError('Google OAuth granted scopes are insufficient', {
      code: 'CONNECTION_SCOPE_INSUFFICIENT',
      details: { connectorKey: connector, missingScopeCount: missing.length },
    });
  }
  return Object.freeze(normalized);
}

export function readInvitationTtlMs(value) {
  return readBoundedTtl(value, DEFAULT_INVITATION_TTL_MS, 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, 'invitationTtlMs');
}

export function readOAuthStateTtlMs(value) {
  return readBoundedTtl(value, DEFAULT_OAUTH_STATE_TTL_MS, 60 * 1000, 30 * 60 * 1000, 'oauthStateTtlMs');
}

export function readInvitationMaxAttempts(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_INVITATION_MAX_ATTEMPTS;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 5) {
    throw permanentError('invitationMaxAttempts is outside the approved range', {
      code: 'CONNECTION_INVITATION_MAX_ATTEMPTS_INVALID',
      details: { fieldName: 'invitationMaxAttempts', minimum: 1, maximum: 5 },
    });
  }
  return number;
}

function readBoundedTtl(value, fallback, minimum, maximum, fieldName) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw permanentError(`${fieldName} is outside the approved range`, {
      code: 'CONNECTION_TTL_INVALID',
      details: { fieldName, minimum, maximum },
    });
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Customer connection requires ${fieldName}`, {
      code: 'CONNECTION_CONTRACT_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}
