import { createHash } from 'node:crypto';
import {
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  META_TOKEN_CONNECTION_ENV,
  loadMetaTokenConnectionConfig,
} from '../../packages/config/src/meta-token-connection-config.js';
import {
  LARK_TABLE_ENV,
  readLarkTableIdsFromEnv,
} from '../../packages/config/src/lark-table-config.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
  buildMetaD1OnlyConfigWindow,
} from './meta-d1-only-rollout-operator.js';
import {
  buildMetaLarkConfigWindow,
} from './meta-lark-parity-rollout-operator.js';
import {
  parseJsoncObject,
} from './chatwoot-safe-wrangler-config.js';

export const META_FASTTRACK_SAFE_CONFIG_CONTRACT_VERSION =
  'meta_fasttrack_safe_wrangler_config_v2';

const TARGET = Object.freeze({
  workerName: 'social-mkt-sync-worker',
  environment: 'development',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
  databaseName: 'social-mkt-state-dev',
  mainQueueName: 'social-mkt-sync-jobs',
  dlqName: 'social-mkt-sync-dlq',
  connectorKey: 'facebook',
  sourceAccountKey: null,
  connectorFlag: 'MKT_CONNECTOR_FACEBOOK_ENABLED',
});
const ENABLED_FLAG = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const SECRET_VAR = /(?:^|_)(?:ACCESS_TOKEN|REFRESH_TOKEN|API_TOKEN|APP_SECRET|CLIENT_SECRET|PASSWORD|PRIVATE_KEY|CONSUMER_SECRET|WEBHOOK_SECRET)$/u;
const REQUIRED_META_AD_ACCOUNT_KEYS = Object.freeze([
  'chemistry_k2',
  'chemistry_k3',
]);

export function buildMetaFastTrackSafeWranglerConfig(sourceText, env = {}) {
  let source;
  try {
    source = parseJsoncObject(sourceText);
  } catch (cause) {
    throw configError(
      'Meta fast-track source Wrangler config is not valid JSONC',
      'META_FASTTRACK_SAFE_CONFIG_SOURCE_INVALID',
      { cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }

  requireExact(source.name, TARGET.workerName, 'name');
  requireExact(source.vars?.MKT_ENV, TARGET.environment, 'MKT_ENV');
  requireExact(
    source.vars?.MKT_CUSTOMER_PROFILE,
    TARGET.customerProfile,
    'MKT_CUSTOMER_PROFILE',
  );
  requireExact(
    source.vars?.MKT_CONNECTION_CUSTOMER_KEY,
    TARGET.customerKey,
    'MKT_CONNECTION_CUSTOMER_KEY',
  );
  if (source.workers_dev !== undefined && source.workers_dev !== false) {
    throw configError(
      'Meta fast-track source Wrangler config permits workers_dev only when omitted or false',
      'META_FASTTRACK_SAFE_CONFIG_TARGET_INVALID',
      { fieldName: 'workers_dev' },
    );
  }

  const sourceVars = requireObject(source.vars, 'vars');
  const secretKeys = Object.keys(sourceVars).filter((key) => (
    SECRET_VAR.test(key) && String(sourceVars[key] ?? '').trim() !== ''
  ));
  if (secretKeys.length > 0) {
    throw configError(
      'Meta fast-track source Wrangler vars contain secret-shaped values',
      'META_FASTTRACK_SAFE_CONFIG_SECRET_VALUE_BLOCKED',
      { secretVarNames: secretKeys.sort() },
    );
  }

  const tableIds = readLarkTableIdsFromEnv(
    env,
    META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
  );
  const sourceMappings = readMetaSourceMappings(env);
  const vars = structuredClone(sourceVars);
  const sourceEnabledFlags = [];

  for (const [name, value] of Object.entries(vars)) {
    if (!ENABLED_FLAG.test(name)) continue;
    if (String(value).trim().toLowerCase() === 'true') sourceEnabledFlags.push(name);
    vars[name] = 'false';
  }
  for (const name of META_D1_ONLY_REQUIRED_FALSE_FLAGS) vars[name] = 'false';

  vars.MKT_ENV = TARGET.environment;
  vars.MKT_CUSTOMER_PROFILE = TARGET.customerProfile;
  vars.MKT_CONNECTION_CUSTOMER_KEY = TARGET.customerKey;
  vars.MKT_MAIN_QUEUE_NAME = TARGET.mainQueueName;
  vars.MKT_DLQ_QUEUE_NAME = TARGET.dlqName;

  const changedSourceMappingNames = [];
  for (const [name, value] of Object.entries(sourceMappings)) {
    if (vars[name] !== value) changedSourceMappingNames.push(name);
    vars[name] = value;
  }
  delete vars[META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_ID];

  const changedTableMappingNames = [];
  for (const key of META_END_TO_END_REQUIRED_LARK_TABLE_KEYS) {
    const envName = LARK_TABLE_ENV[key];
    if (vars[envName] !== tableIds[key]) changedTableMappingNames.push(envName);
    vars[envName] = tableIds[key];
  }

  const safe = structuredClone(source);
  safe.workers_dev = false;
  safe.vars = vars;
  const text = `${JSON.stringify(safe, null, 2)}\n`;

  const d1Window = buildMetaD1OnlyConfigWindow(text, TARGET);
  const larkWindow = buildMetaLarkConfigWindow(text, TARGET);
  const tableMappingFingerprint = sha256(stableJson(
    Object.fromEntries(META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.map((key) => [
      LARK_TABLE_ENV[key],
      tableIds[key],
    ])),
  ));
  const sourceMappingFingerprint = sha256(stableJson(sourceMappings));

  return Object.freeze({
    contractVersion: META_FASTTRACK_SAFE_CONFIG_CONTRACT_VERSION,
    text,
    sha256: sha256(text),
    workerName: TARGET.workerName,
    databaseName: TARGET.databaseName,
    mainQueueName: TARGET.mainQueueName,
    dlqName: TARGET.dlqName,
    falseFlagCount: META_D1_ONLY_REQUIRED_FALSE_FLAGS.length,
    sourceEnabledFlagNames: Object.freeze(sourceEnabledFlags.sort()),
    tableMappingCount: META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.length,
    changedTableMappingNames: Object.freeze(changedTableMappingNames.sort()),
    tableMappingFingerprint,
    sourceMappingCount: Object.keys(sourceMappings).length,
    changedSourceMappingNames: Object.freeze(changedSourceMappingNames.sort()),
    sourceMappingFingerprint,
    d1SafeSha256: d1Window.safeSha256,
    d1ActiveSha256: d1Window.activeSha256,
    larkActiveSha256: larkWindow.activeSha256,
    secretValuesCopied: 0,
  });
}

export function buildMetaFastTrackWranglerDryRunArgs(configPath, outputFile) {
  const config = requireText(configPath, 'configPath');
  const output = requireText(outputFile, 'outputFile');
  return Object.freeze([
    'wrangler',
    'deploy',
    '--dry-run',
    '--outfile', output,
    '--config', config,
  ]);
}

function readMetaSourceMappings(env) {
  let config;
  try {
    config = loadMetaTokenConnectionConfig(env);
  } catch (cause) {
    throw configError(
      'Meta fast-track source identity environment is invalid',
      'META_FASTTRACK_SOURCE_MAPPING_INVALID',
      { fieldName: cause?.details?.fieldName ?? 'META_SOURCE_MAPPING' },
    );
  }

  const missing = [];
  if (!config.apiVersion) missing.push(META_TOKEN_CONNECTION_ENV.API_VERSION);
  if (!config.mappings.facebookPageId) {
    missing.push(META_TOKEN_CONNECTION_ENV.FACEBOOK_PAGE_ID);
  }
  if (!config.mappings.instagramAccountId) {
    missing.push(META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCOUNT_ID);
  }
  const accountKeys = config.mappings.metaAdAccounts.map((entry) => entry.key).sort();
  if (JSON.stringify(accountKeys) !== JSON.stringify(REQUIRED_META_AD_ACCOUNT_KEYS)) {
    missing.push(META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS);
  }
  if (missing.length > 0) {
    throw configError(
      'Meta fast-track source identity environment is incomplete',
      'META_FASTTRACK_SOURCE_MAPPING_MISSING',
      { fieldNames: missing.sort() },
    );
  }

  return Object.freeze({
    [META_TOKEN_CONNECTION_ENV.API_VERSION]: config.apiVersion,
    [META_TOKEN_CONNECTION_ENV.FACEBOOK_PAGE_ID]: config.mappings.facebookPageId,
    [META_TOKEN_CONNECTION_ENV.INSTAGRAM_ACCOUNT_ID]:
      config.mappings.instagramAccountId,
    [META_TOKEN_CONNECTION_ENV.META_AD_ACCOUNT_MAPPINGS]:
      config.mappings.metaAdAccounts
        .map((entry) => `${entry.key}=${entry.accountId}`)
        .join(','),
  });
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configError(
      `Meta fast-track source Wrangler config requires object ${fieldName}`,
      'META_FASTTRACK_SAFE_CONFIG_SOURCE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw configError(
      `Meta fast-track source Wrangler config requires ${fieldName}=${expected}`,
      'META_FASTTRACK_SAFE_CONFIG_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(
      `Meta fast-track ${fieldName} is required`,
      'META_FASTTRACK_SAFE_CONFIG_DRY_RUN_ARGUMENT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function configError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaFastTrackSafeWranglerConfigError';
  error.code = code;
  error.details = details;
  return error;
}
