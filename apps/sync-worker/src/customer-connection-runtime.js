import { CustomerConnectionOAuthService } from '../../../packages/application/src/connections/customer-connection-oauth-service.js';
import {
  CUSTOMER_CONNECTION_CONNECTORS,
} from '../../../packages/application/src/connections/customer-connection-contract.js';
import { D1CustomerConnectionStore } from '../../../packages/connectors/src/d1-customer-connection-store.js';
import {
  EncryptedCustomerCredentialRepository,
} from '../../../packages/connectors/src/encrypted-customer-credential-repository.js';

const REQUIRED_REDIRECT_ENV_KEYS = Object.freeze({
  [CUSTOMER_CONNECTION_CONNECTORS.GOOGLE_ADS]: 'MKT_GOOGLE_ADS_REDIRECT_URI',
  [CUSTOMER_CONNECTION_CONNECTORS.YOUTUBE]: 'MKT_YOUTUBE_REDIRECT_URI',
});
const OPTIONAL_REDIRECT_ENV_KEYS = Object.freeze({
  [CUSTOMER_CONNECTION_CONNECTORS.TIKTOK_ADS]: 'MKT_TIKTOK_ADS_REDIRECT_URI',
});

/** สร้าง Shared runtime เฉพาะเมื่อ HTTP connection route ถูกเรียก จึงไม่กระทบ Queue/Cron เดิม */
export function createCustomerConnectionRuntime(env, dependencies = {}) {
  const config = loadCustomerConnectionRuntimeConfig(env);
  const store = dependencies.store ?? new D1CustomerConnectionStore({ db: requireD1(env) });
  const credentials = dependencies.credentials ?? new EncryptedCustomerCredentialRepository({
    store,
    keyVersion: config.encryptionKeyVersion,
    keys: { [config.encryptionKeyVersion]: config.encryptionKey },
  });
  const service = dependencies.service ?? new CustomerConnectionOAuthService({
    store,
    credentials,
    invitationSigningKey: config.invitationSigningKey,
    stateSigningKey: config.stateSigningKey,
  });
  return Object.freeze({ config, store, credentials, service });
}

export function loadCustomerConnectionRuntimeConfig(env = {}) {
  const environment = requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  const encryptionKeyVersion = requireText(
    env.MKT_CONNECTION_ENCRYPTION_KEY_VERSION ?? 'v1',
    'MKT_CONNECTION_ENCRYPTION_KEY_VERSION',
  );
  const requiredRedirectUris = Object.fromEntries(
    Object.entries(REQUIRED_REDIRECT_ENV_KEYS).map(([connectorKey, envKey]) => [
      connectorKey,
      requireHttpsUrl(env[envKey], envKey),
    ]),
  );
  const optionalRedirectUris = Object.fromEntries(
    Object.entries(OPTIONAL_REDIRECT_ENV_KEYS)
      .filter(([, envKey]) => hasText(env[envKey]))
      .map(([connectorKey, envKey]) => [connectorKey, requireHttpsUrl(env[envKey], envKey)]),
  );
  return Object.freeze({
    environment,
    customerProfile: 'integration_workspace',
    customerKey: requireExact(
      env.MKT_CONNECTION_CUSTOMER_KEY,
      'chemistry_k',
      'MKT_CONNECTION_CUSTOMER_KEY',
    ),
    publicOrigin: requireHttpsOrigin(env.MKT_CONNECTION_PUBLIC_ORIGIN, 'MKT_CONNECTION_PUBLIC_ORIGIN'),
    operatorToken: requireSecret(env.MKT_CONNECTION_OPERATOR_TOKEN, 'MKT_CONNECTION_OPERATOR_TOKEN'),
    invitationSigningKey: requireSecret(
      env.MKT_CONNECTION_INVITATION_SIGNING_KEY,
      'MKT_CONNECTION_INVITATION_SIGNING_KEY',
    ),
    stateSigningKey: requireSecret(
      env.MKT_CONNECTION_STATE_SIGNING_KEY,
      'MKT_CONNECTION_STATE_SIGNING_KEY',
    ),
    selectionSigningKey: requireSecret(
      env.MKT_CONNECTION_SELECTION_SIGNING_KEY,
      'MKT_CONNECTION_SELECTION_SIGNING_KEY',
    ),
    encryptionKeyVersion,
    encryptionKey: requireSecret(
      env[`MKT_CONNECTION_ENCRYPTION_KEY_${encryptionKeyVersion.toUpperCase()}`],
      `MKT_CONNECTION_ENCRYPTION_KEY_${encryptionKeyVersion.toUpperCase()}`,
    ),
    redirectUris: Object.freeze({ ...requiredRedirectUris, ...optionalRedirectUris }),
  });
}

export function loadGoogleOAuthRuntimeConfig(env = {}) {
  return Object.freeze({
    clientId: requireText(env.GOOGLE_OAUTH_CLIENT_ID, 'GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: requireSecret(env.GOOGLE_OAUTH_CLIENT_SECRET, 'GOOGLE_OAUTH_CLIENT_SECRET'),
  });
}

export function loadGoogleAdsRuntimeConfig(env = {}) {
  return Object.freeze({
    developerToken: requireSecret(env.GOOGLE_ADS_DEVELOPER_TOKEN, 'GOOGLE_ADS_DEVELOPER_TOKEN'),
    managerCustomerId: requireCustomerId(
      env.MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID,
      'MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID',
    ),
    advertiserCustomerId: requireCustomerId(
      env.MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID,
      'MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID',
    ),
    apiVersion: requireApiVersion(env.MKT_GOOGLE_ADS_API_VERSION ?? 'v24'),
  });
}

/** TikTok Ads app secrets and exact advertiser mapping are isolated from other providers. */
export function loadTikTokAdsRuntimeConfig(env = {}) {
  return Object.freeze({
    appId: requireText(env.TIKTOK_ADS_APP_ID, 'TIKTOK_ADS_APP_ID'),
    appSecret: requireSecret(env.TIKTOK_ADS_APP_SECRET, 'TIKTOK_ADS_APP_SECRET'),
    advertiserId: requireDigits(env.MKT_TIKTOK_ADS_ADVERTISER_ID, 'MKT_TIKTOK_ADS_ADVERTISER_ID'),
    redirectUri: requireHttpsUrl(env.MKT_TIKTOK_ADS_REDIRECT_URI, 'MKT_TIKTOK_ADS_REDIRECT_URI'),
  });
}

function requireD1(env) {
  const db = env?.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function' || typeof db?.batch !== 'function') {
    throw new TypeError('MKT_STATE_DB binding is required');
  }
  return db;
}
function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) throw new TypeError(`${fieldName} must be ${expected}`);
  return text;
}
function requireSecret(value, fieldName) {
  const text = requireText(value, fieldName);
  if (/^(?:replace-with-|example|changeme)/iu.test(text)) {
    throw new TypeError(`${fieldName} must be configured through Worker Secrets`);
  }
  return text;
}
function requireHttpsOrigin(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if ((url.protocol !== 'https:' && url.hostname !== 'localhost') || url.pathname !== '/') {
    throw new TypeError(`${fieldName} must be an HTTPS origin`);
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}
function requireHttpsUrl(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError(`${fieldName} must use HTTPS`);
  }
  url.hash = '';
  return url.toString();
}
function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireDigits(value, fieldName) {
  const text = requireText(String(value ?? ''), fieldName);
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must contain digits only`);
  return text;
}
function requireCustomerId(value, fieldName) {
  const id = requireText(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(id)) throw new TypeError(`${fieldName} must be a 10-digit customer ID`);
  return id;
}
function requireApiVersion(value) {
  const version = requireText(value, 'MKT_GOOGLE_ADS_API_VERSION');
  if (!/^v\d+$/u.test(version)) throw new TypeError('MKT_GOOGLE_ADS_API_VERSION is invalid');
  return version;
}
