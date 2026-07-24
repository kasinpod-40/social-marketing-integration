import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { isPlaceholderConfigValue } from '../../shared/src/config/placeholder-value.js';

export const META_TOKEN_CONNECTION_KEYS = Object.freeze({
  FACEBOOK_ORGANIC: 'facebook',
  INSTAGRAM_ORGANIC: 'instagram',
  META_ADS: 'meta_ads',
});

export const META_TOKEN_CONNECTION_STATUSES = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  PROVIDER_BLOCKED: 'provider_blocked',
  TOKEN_INVALID: 'token_invalid',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  PROVIDER_ERROR: 'provider_error',
  SCOPE_INSUFFICIENT: 'scope_insufficient',
  IDENTITY_UNAVAILABLE: 'identity_unavailable',
  IDENTITY_MAPPING_REQUIRED: 'identity_mapping_required',
  IDENTITY_MISMATCH: 'identity_mismatch',
  IDENTITY_VALIDATED: 'identity_validated',
});

export const META_TOKEN_CONNECTION_ENV = Object.freeze({
  API_VERSION: 'META_GRAPH_API_VERSION',
  FACEBOOK_ACCESS_TOKEN: 'META_ACCESS_TOKEN',
  INSTAGRAM_ACCESS_TOKEN: 'META_INSTAGRAM_ACCESS_TOKEN',
  FACEBOOK_PAGE_ID: 'META_FACEBOOK_PAGE_ID',
  INSTAGRAM_ACCOUNT_ID: 'META_INSTAGRAM_ACCOUNT_ID',
  META_AD_ACCOUNT_ID: 'META_AD_ACCOUNT_ID',
  TIMEOUT_MS: 'META_API_TIMEOUT_MS',
  MAX_PAGES: 'META_MAX_PAGES',
  PAGE_SIZE: 'META_PAGE_SIZE',
  MAX_ATTEMPTS: 'META_MAX_ATTEMPTS',
  MAX_RESPONSE_BYTES: 'META_MAX_RESPONSE_BYTES',
});

export const META_REQUIRED_PERMISSIONS = deepFreeze({
  [META_TOKEN_CONNECTION_KEYS.FACEBOOK_ORGANIC]: [
    'pages_read_engagement',
    'pages_show_list',
  ],
  [META_TOKEN_CONNECTION_KEYS.INSTAGRAM_ORGANIC]: [
    'instagram_business_basic',
  ],
  [META_TOKEN_CONNECTION_KEYS.META_ADS]: [
    'ads_read',
    'business_management',
  ],
});

/**
 * โหลดเฉพาะ Runtime config สำหรับ Meta token preflight.
 *
 * Token อาจยังไม่มีระหว่างเตรียม Foundation แต่หากมี Token อย่างน้อยหนึ่งชนิด
 * ต้อง Pin API version ที่ชัดเจนก่อนเรียก Provider.
 */
export function loadMetaTokenConnectionConfig(env = {}) {
  const facebookAccessToken = readOptionalCredential(
    env[META_TOKEN_CONNECTION_ENV.FACEBOOK_ACCESS_TOKEN],
    META_TOKEN_CONNECTION_ENV.FACEBOOK_ACCESS_TOKEN,
  );
  const instagramAccessToken = readOptionalCredential(
    env[META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCESS_TOKEN],
    META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCESS_TOKEN,
  );
  const anyCredentialConfigured = Boolean(facebookAccessToken || instagramAccessToken);
  const apiVersion = readApiVersion(
    env[META_TOKEN_CONNECTION_ENV.API_VERSION],
    anyCredentialConfigured,
  );

  return deepFreeze({
    apiVersion,
    credentials: {
      facebookAccessToken,
      instagramAccessToken,
    },
    mappings: {
      facebookPageId: readOptionalIdentity(
        env[META_TOKEN_CONNECTION_ENV.FACEBOOK_PAGE_ID],
        META_TOKEN_CONNECTION_ENV.FACEBOOK_PAGE_ID,
      ),
      instagramAccountId: readOptionalIdentity(
        env[META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCOUNT_ID],
        META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCOUNT_ID,
      ),
      metaAdAccountId: readOptionalIdentity(
        env[META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_ID],
        META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_ID,
      ),
    },
    transport: {
      timeoutMs: readPositiveInteger(
        env[META_TOKEN_CONNECTION_ENV.TIMEOUT_MS],
        META_TOKEN_CONNECTION_ENV.TIMEOUT_MS,
        30_000,
      ),
      maxPages: readPositiveInteger(
        env[META_TOKEN_CONNECTION_ENV.MAX_PAGES],
        META_TOKEN_CONNECTION_ENV.MAX_PAGES,
        100,
      ),
      pageSize: readPositiveInteger(
        env[META_TOKEN_CONNECTION_ENV.PAGE_SIZE],
        META_TOKEN_CONNECTION_ENV.PAGE_SIZE,
        100,
      ),
      maxAttempts: readPositiveInteger(
        env[META_TOKEN_CONNECTION_ENV.MAX_ATTEMPTS],
        META_TOKEN_CONNECTION_ENV.MAX_ATTEMPTS,
        5,
      ),
      maxResponseBytes: readPositiveInteger(
        env[META_TOKEN_CONNECTION_ENV.MAX_RESPONSE_BYTES],
        META_TOKEN_CONNECTION_ENV.MAX_RESPONSE_BYTES,
        8 * 1024 * 1024,
      ),
    },
  });
}

function readApiVersion(value, required) {
  const text = readOptionalText(value, META_TOKEN_CONNECTION_ENV.API_VERSION);
  if (!text) {
    if (!required) return null;
    throw permanentError('Meta Graph API version is required when a credential is configured', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { fieldName: META_TOKEN_CONNECTION_ENV.API_VERSION },
    });
  }
  if (isPlaceholderConfigValue(text) || !/^v\d+\.\d+$/u.test(text.toLowerCase())) {
    throw permanentError('Meta Graph API version must use a configured vNN.N value', {
      code: isPlaceholderConfigValue(text)
        ? 'META_CONNECTION_CONFIG_PLACEHOLDER'
        : 'META_CONNECTION_CONFIG_INVALID',
      details: { fieldName: META_TOKEN_CONNECTION_ENV.API_VERSION },
    });
  }
  return text.toLowerCase();
}

function readOptionalCredential(value, fieldName) {
  const text = readOptionalText(value, fieldName);
  if (!text) return null;
  if (isPlaceholderConfigValue(text)) {
    throw permanentError('Meta credential is still a placeholder', {
      code: 'META_CREDENTIAL_PLACEHOLDER',
      details: { fieldName },
    });
  }
  return text;
}

function readOptionalIdentity(value, fieldName) {
  const text = readOptionalText(value, fieldName);
  if (!text) return null;
  if (isPlaceholderConfigValue(text)) {
    throw permanentError('Meta identity mapping is still a placeholder', {
      code: 'META_CONNECTION_CONFIG_PLACEHOLDER',
      details: { fieldName },
    });
  }
  return text;
}

function readOptionalText(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw permanentError('Meta connection environment values must be strings', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { fieldName, valueType: typeof value },
    });
  }
  return value.trim() || null;
}

function readPositiveInteger(value, fieldName, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw permanentError('Meta connection numeric config must be a positive integer', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
