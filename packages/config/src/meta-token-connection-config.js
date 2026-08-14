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
  FACEBOOK_PAGE_ACCESS_TOKEN: 'META_FACEBOOK_PAGE_ACCESS_TOKEN',
  INSTAGRAM_ACCESS_TOKEN: 'META_INSTAGRAM_ACCESS_TOKEN',
  FACEBOOK_PAGE_ID: 'META_FACEBOOK_PAGE_ID',
  INSTAGRAM_ACCOUNT_ID: 'META_INSTAGRAM_ACCOUNT_ID',
  META_AD_ACCOUNT_ID: 'META_AD_ACCOUNT_ID',
  META_AD_ACCOUNT_MAPPINGS: 'META_AD_ACCOUNT_MAPPINGS',
  TIMEOUT_MS: 'META_API_TIMEOUT_MS',
  MAX_PAGES: 'META_MAX_PAGES',
  PAGE_SIZE: 'META_PAGE_SIZE',
  MAX_ATTEMPTS: 'META_MAX_ATTEMPTS',
  MAX_RESPONSE_BYTES: 'META_MAX_RESPONSE_BYTES',
});

export const META_REQUIRED_PERMISSIONS = deepFreeze({
  [META_TOKEN_CONNECTION_KEYS.FACEBOOK_ORGANIC]: [
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_show_list',
    'read_insights',
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
  const facebookPageAccessToken = readOptionalCredential(
    env[META_TOKEN_CONNECTION_ENV.FACEBOOK_PAGE_ACCESS_TOKEN],
    META_TOKEN_CONNECTION_ENV.FACEBOOK_PAGE_ACCESS_TOKEN,
  );
  const instagramAccessToken = readOptionalCredential(
    env[META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCESS_TOKEN],
    META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCESS_TOKEN,
  );
  const anyCredentialConfigured = Boolean(
    facebookAccessToken || facebookPageAccessToken || instagramAccessToken,
  );
  const apiVersion = readApiVersion(
    env[META_TOKEN_CONNECTION_ENV.API_VERSION],
    anyCredentialConfigured,
  );
  const metaAdAccounts = readMetaAdAccounts(
    env[META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS],
    env[META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_ID],
  );

  return deepFreeze({
    apiVersion,
    credentials: {
      facebookAccessToken,
      facebookPageAccessToken,
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
      metaAdAccounts,
      metaAdAccountIds: metaAdAccounts.map((entry) => entry.accountId),
      // Compatibility alias: only safe when exactly one account is configured.
      metaAdAccountId: metaAdAccounts.length === 1 ? metaAdAccounts[0].accountId : null,
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

export function readMetaAdAccounts(value, legacyValue) {
  const mappingText = readOptionalText(
    value,
    META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS,
  );
  const legacyText = readOptionalText(
    legacyValue,
    META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_ID,
  );

  for (const [fieldName, text] of [
    [META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS, mappingText],
    [META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_ID, legacyText],
  ]) {
    if (text && isPlaceholderConfigValue(text)) {
      throw permanentError('Meta identity mapping is still a placeholder', {
        code: 'META_CONNECTION_CONFIG_PLACEHOLDER',
        details: { fieldName },
      });
    }
  }
  if (mappingText && legacyText) {
    throw permanentError('Use either META_AD_ACCOUNT_MAPPINGS or legacy META_AD_ACCOUNT_ID, not both', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { fieldName: META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS },
    });
  }
  if (!mappingText) {
    return legacyText
      ? deepFreeze([{ key: 'default', accountId: normalizeMetaAdAccountId(legacyText) }])
      : Object.freeze([]);
  }

  const segments = mappingText.split(',');
  if (segments.length > 20) {
    throw permanentError('Meta Ad Account mapping count exceeds the supported limit', {
      code: 'META_CONNECTION_CONFIG_INVALID',
      details: { fieldName: META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS },
    });
  }
  const keys = new Set();
  const accountIds = new Set();
  const entries = segments.map((segment) => {
    const text = segment.trim();
    const separator = text.indexOf('=');
    if (!text || separator <= 0 || separator !== text.lastIndexOf('=')) {
      throw invalidMetaAdAccountMapping();
    }
    const key = text.slice(0, separator).trim().toLowerCase();
    const accountId = normalizeMetaAdAccountId(text.slice(separator + 1));
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(key) || keys.has(key) || accountIds.has(accountId)) {
      throw invalidMetaAdAccountMapping();
    }
    keys.add(key);
    accountIds.add(accountId);
    return { key, accountId };
  });
  return deepFreeze(entries);
}

function normalizeMetaAdAccountId(value) {
  const normalized = String(value ?? '').trim().replace(/^act_/iu, '');
  if (!/^\d+$/u.test(normalized)) throw invalidMetaAdAccountMapping();
  return normalized;
}

function invalidMetaAdAccountMapping() {
  return permanentError('META_AD_ACCOUNT_MAPPINGS must be comma-separated key=account_id pairs', {
    code: 'META_CONNECTION_CONFIG_INVALID',
    details: { fieldName: META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS },
  });
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
