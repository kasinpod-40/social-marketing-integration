import { CustomerConnectionOAuthService } from '../../../packages/application/src/connections/customer-connection-oauth-service.js';
import {
  CUSTOMER_CONNECTION_CONNECTORS,
} from '../../../packages/application/src/connections/customer-connection-contract.js';
import { D1CustomerConnectionStore } from '../../../packages/connectors/src/d1-customer-connection-store.js';
import {
  EncryptedCustomerCredentialRepository,
} from '../../../packages/connectors/src/encrypted-customer-credential-repository.js';
import {
  isReviewedConnectorRuntime,
  loadCustomerRuntimeConfig,
} from '../../../packages/config/src/customer-profiles.js';

const REDIRECT_ENV_KEYS = Object.freeze({
  [CUSTOMER_CONNECTION_CONNECTORS.GOOGLE_ADS]: 'MKT_GOOGLE_ADS_REDIRECT_URI',
  [CUSTOMER_CONNECTION_CONNECTORS.YOUTUBE]: 'MKT_YOUTUBE_REDIRECT_URI',
});

/** สร้าง Shared runtime เฉพาะเมื่อ HTTP connection route ถูกเรียก จึงไม่กระทบ Queue/Cron เดิม */
export function createCustomerConnectionRuntime(env, dependencies = {}) {
  const config = loadCustomerConnectionRuntimeConfig(env);
  const store = dependencies.store ?? new D1CustomerConnectionStore({ db: requireD1(env) });
  const credentials = dependencies.credentials ?? new EncryptedCustomerCredentialRepository({
    store,
    keyVersion: config.encryptionKeyVersion,
    keys: config.encryptionKeys,
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
  const credential = loadCustomerCredentialRuntimeConfig(env);
  return Object.freeze({
    ...credential,
    publicOrigin: requireHttpsOrigin(
      env.MKT_CONNECTION_PUBLIC_ORIGIN,
      'MKT_CONNECTION_PUBLIC_ORIGIN',
    ),
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
    redirectUris: Object.freeze(Object.fromEntries(
      Object.entries(REDIRECT_ENV_KEYS).map(([connectorKey, envKey]) => [
        connectorKey,
        requireHttpsUrl(env[envKey], envKey),
      ]),
    )),
  });
}

/** โหลดเฉพาะขอบเขตที่ Queue/Cron ต้องใช้เพื่ออ่าน Dynamic Customer credential จาก D1 */
export function loadCustomerCredentialRuntimeConfig(env = {}) {
  const runtime = loadCustomerRuntimeConfig(env);
  if (
    !isReviewedConnectorRuntime(runtime)
    || runtime.requestedProfileKey !== runtime.profileKey
  ) {
    throw new TypeError('Customer credential runtime must use a reviewed environment/profile tuple');
  }
  const encryptionKeyVersion = requireText(
    env.MKT_CONNECTION_ENCRYPTION_KEY_VERSION ?? 'v1',
    'MKT_CONNECTION_ENCRYPTION_KEY_VERSION',
  );
  if (!/^v[1-9]\d*$/u.test(encryptionKeyVersion)) {
    throw new TypeError('MKT_CONNECTION_ENCRYPTION_KEY_VERSION is invalid');
  }
  const previousKeyVersions = readKeyVersions(
    env.MKT_CONNECTION_ENCRYPTION_KEY_PREVIOUS_VERSIONS,
  ).filter((version) => version !== encryptionKeyVersion);
  const encryptionKeyVersions = Object.freeze([
    encryptionKeyVersion,
    ...previousKeyVersions,
  ]);
  const encryptionKeys = Object.freeze(Object.fromEntries(encryptionKeyVersions.map((version) => [
    version,
    requireSecret(
      env[`MKT_CONNECTION_ENCRYPTION_KEY_${version.toUpperCase()}`],
      `MKT_CONNECTION_ENCRYPTION_KEY_${version.toUpperCase()}`,
    ),
  ])));
  return Object.freeze({
    environment: runtime.environment,
    customerProfile: runtime.profileKey,
    infrastructureOwner: runtime.infrastructureOwner,
    customerKey: requireExact(
      env.MKT_CONNECTION_CUSTOMER_KEY,
      'chemistry_k',
      'MKT_CONNECTION_CUSTOMER_KEY',
    ),
    encryptionKeyVersion,
    encryptionKey: encryptionKeys[encryptionKeyVersion],
    encryptionKeyVersions,
    encryptionKeys,
  });
}

/** Google OAuth transport config ใช้ร่วมกันได้ แต่โหลดเฉพาะใน Google provider routes */
export function loadGoogleOAuthRuntimeConfig(env = {}) {
  return Object.freeze({
    clientId: requireText(env.GOOGLE_OAUTH_CLIENT_ID, 'GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: requireSecret(
      env.GOOGLE_OAUTH_CLIENT_SECRET,
      'GOOGLE_OAUTH_CLIENT_SECRET',
    ),
  });
}

/** Google Ads-only config แยกจาก YouTube เพื่อไม่ให้ Developer Token failure กระทบอีก Connector */
export function loadGoogleAdsRuntimeConfig(env = {}) {
  return Object.freeze({
    developerToken: requireSecret(
      env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'GOOGLE_ADS_DEVELOPER_TOKEN',
    ),
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

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
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

function readKeyVersions(value) {
  if (value === undefined || value === null || value === '') return [];
  const versions = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  if (versions.length > 4 || versions.some((version) => !/^v[1-9]\d*$/u.test(version))) {
    throw new TypeError('MKT_CONNECTION_ENCRYPTION_KEY_PREVIOUS_VERSIONS is invalid');
  }
  return [...new Set(versions)];
}
