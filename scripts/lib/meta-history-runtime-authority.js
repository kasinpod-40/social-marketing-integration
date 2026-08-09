import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from './meta-d1-only-rollout-operator.js';
import {
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  LARK_TABLE_ENV,
  readLarkTableIdsFromEnv,
} from '../../packages/config/src/lark-table-config.js';

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

/**
 * Hydrate the reviewed Meta/Lark table mappings from the existing safe Wrangler config when the
 * shell/.dev.vars environment does not duplicate those non-secret IDs. If both authorities provide
 * a value they must match exactly; drift is rejected instead of choosing one side implicitly.
 */
export function applyMetaHistoryLarkRuntimeEnvironment(configText, env = {}) {
  if (typeof configText !== 'string' || configText.trim() === '') {
    throw runtimeAuthorityError(
      'Meta history Lark runtime config text is required',
      'META_HISTORY_LARK_RUNTIME_CONFIG_REQUIRED',
    );
  }

  const runtime = applyMetaHistoryCustomerRuntimeEnvironment(env);
  const tableConfigEnv = {};

  for (const tableKey of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    const envName = LARK_TABLE_ENV[tableKey];
    const environmentValue = optionalText(runtime[envName]);
    const configValues = [...new Set(readStringValues(configText, envName).map((value) => value.trim()))]
      .filter(Boolean);

    if (configValues.length > 1) {
      throw runtimeAuthorityError(
        'Meta history Lark safe config contains conflicting table mappings',
        'META_HISTORY_LARK_TABLE_MAPPING_CONFLICT',
        { envName, tableKey },
      );
    }

    const configValue = configValues[0] ?? null;
    if (environmentValue && configValue && environmentValue !== configValue) {
      throw runtimeAuthorityError(
        'Meta history Lark environment mapping disagrees with the safe config',
        'META_HISTORY_LARK_TABLE_MAPPING_MISMATCH',
        { envName, tableKey },
      );
    }

    const resolved = environmentValue ?? configValue;
    if (!resolved) {
      throw runtimeAuthorityError(
        `Missing required Lark table mapping ${envName}`,
        'META_HISTORY_LARK_TABLE_MAPPING_MISSING',
        { envName, tableKey },
      );
    }
    tableConfigEnv[envName] = resolved;
  }

  const hydrated = Object.freeze({
    ...runtime,
    ...tableConfigEnv,
  });

  // Reuse the central Lark mapping validator for required-key and duplicate-ID protection.
  readLarkTableIdsFromEnv(hydrated, META_END_TO_END_REQUIRED_LARK_TABLE_KEYS);
  return hydrated;
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

export function materializeMetaHistoryLarkRuntimeConfig(configText, env = {}) {
  const tableIds = readLarkTableIdsFromEnv(
    env,
    META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
  );
  const tableConfigEnv = Object.fromEntries(
    META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((tableKey) => [
      LARK_TABLE_ENV[tableKey],
      tableIds[tableKey],
    ]),
  );

  let text = materializeMetaHistoryCustomerRuntimeConfig(configText);
  for (const [key, value] of Object.entries(tableConfigEnv)) {
    text = upsertStringVar(text, key, value);
  }
  assertExactConfigEnvironment(text, tableConfigEnv, {
    code: 'META_HISTORY_LARK_RUNTIME_CONFIG_INVALID',
    message: 'Meta history Lark runtime config does not contain the exact current table mappings',
  });
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
  assertExactConfigEnvironment(configText, META_HISTORY_RUNTIME_CONFIG_ENV, {
    code: 'META_HISTORY_RUNTIME_CONFIG_INVALID',
    message: 'Meta history runtime config does not contain the exact runtime authority',
  });
}

function assertExactConfigEnvironment(configText, expectedEnvironment, contract) {
  for (const [key, expected] of Object.entries(expectedEnvironment)) {
    const values = readConfigValues(configText, key);
    const stringValues = readStringValues(configText, key);
    if (values.length === 0
      || values.length !== stringValues.length
      || values.some((value) => value !== expected)) {
      throw runtimeAuthorityError(
        contract.message,
        contract.code,
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

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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
