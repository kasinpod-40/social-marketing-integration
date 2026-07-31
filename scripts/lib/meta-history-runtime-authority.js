import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from './meta-d1-only-rollout-operator.js';

const CUSTOMER_RUNTIME_ENV = {
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  META_GRAPH_API_VERSION: 'v25.0',
  META_FACEBOOK_PAGE_ID: '982406442148381',
  META_INSTAGRAM_ACCOUNT_ID: '17841413521012797',
  META_AD_ACCOUNT_ID: '',
  META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=505898710119851,chemistry_k3=851206695716861',
};

const REQUIRED_FALSE_CONFIG_ENV = Object.fromEntries(
  META_D1_ONLY_REQUIRED_FALSE_FLAGS.map((key) => [key, 'false']),
);

export const META_HISTORY_CUSTOMER_RUNTIME_ENV = Object.freeze({
  ...CUSTOMER_RUNTIME_ENV,
});

export const META_HISTORY_REQUIRED_FALSE_CONFIG_ENV = Object.freeze({
  ...REQUIRED_FALSE_CONFIG_ENV,
});

export const META_HISTORY_RUNTIME_CONFIG_ENV = Object.freeze({
  ...META_HISTORY_CUSTOMER_RUNTIME_ENV,
  ...META_HISTORY_REQUIRED_FALSE_CONFIG_ENV,
});

export function applyMetaHistoryCustomerRuntimeEnvironment(env = {}) {
  return Object.freeze({
    ...env,
    ...META_HISTORY_RUNTIME_CONFIG_ENV,
  });
}

export function materializeMetaHistoryCustomerRuntimeConfig(configText) {
  if (typeof configText !== 'string' || configText.trim() === '') {
    throw runtimeAuthorityError(
      'Meta history runtime config text is required',
      'META_HISTORY_RUNTIME_CONFIG_REQUIRED',
    );
  }

  let text = configText;
  for (const [key, value] of Object.entries(META_HISTORY_RUNTIME_CONFIG_ENV)) {
    text = upsertStringVar(text, key, value);
  }
  assertRuntimeConfig(text);
  return text;
}

function upsertStringVar(configText, key, value) {
  const escaped = escapeRegex(key);
  const existing = new RegExp(
    `((?:["']${escaped}["']|${escaped})\\s*:\\s*)(?:(['"])[^"']*\\2|true|false)`,
    'gu',
  );
  existing.lastIndex = 0;
  if (existing.test(configText)) {
    existing.lastIndex = 0;
    return configText.replace(existing, `$1${JSON.stringify(value)}`);
  }

  const varsObject = /((?:["']?vars["']?)\s*:\s*\{)/u;
  if (!varsObject.test(configText)) {
    throw runtimeAuthorityError(
      'Meta history runtime config has no vars object',
      'META_HISTORY_RUNTIME_CONFIG_VARS_MISSING',
      { key },
    );
  }
  return configText.replace(
    varsObject,
    `$1\n    ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  );
}

function assertRuntimeConfig(configText) {
  for (const [key, expected] of Object.entries(META_HISTORY_RUNTIME_CONFIG_ENV)) {
    const values = readConfigValues(configText, key);
    const stringValues = readStringValues(configText, key);
    if (values.length === 0
      || values.length !== stringValues.length
      || values.some((value) => value !== expected)) {
      throw runtimeAuthorityError(
        'Meta history runtime config does not contain the exact runtime authority',
        'META_HISTORY_RUNTIME_CONFIG_INVALID',
        { key },
      );
    }
  }
}

function readConfigValues(configText, key) {
  const escaped = escapeRegex(key);
  return [...configText.matchAll(new RegExp(
    `(?:["']${escaped}["']|${escaped})\\s*:\\s*(?:(['"])([^"']*)\\1|(true|false|null|-?\\d+(?:\\.\\d+)?))`,
    'gu',
  ))].map((match) => match[2] ?? match[3]);
}

function readStringValues(configText, key) {
  const escaped = escapeRegex(key);
  return [...configText.matchAll(new RegExp(
    `(?:["']${escaped}["']|${escaped})\\s*:\\s*["']([^"']*)["']`,
    'gu',
  ))].map((match) => match[1]);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function runtimeAuthorityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaHistoryRuntimeAuthorityError';
  error.code = code;
  error.details = details;
  return error;
}
