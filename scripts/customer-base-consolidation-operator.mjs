import { createHash } from 'node:crypto';
import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { auditLarkBaseFullParity } from '../packages/application/src/use-cases/audit-lark-base-full-parity.js';

const EXPECTED_SOURCE_TABLE_NAMES = Object.freeze([
  '🪪 MKT_Accounts',
  '📆 MKT_Account_Daily',
  '📐 MKT_Metric_Definitions',
  '📚 MKT_Classification_Dictionary',
  '🎬 MKT_Content',
  '📅 MKT_Content_Daily',
  '🏦 MKT_Ads_Accounts',
  '📣 MKT_Ads_Campaigns',
  '🧱 MKT_Ads_AdGroups',
  '📰 MKT_Ads_Ads',
  '🎨 MKT_Ads_Creatives',
  '🗂️ MKT_Ads_AssetGroups',
  '📈 MKT_Ads_Daily',
  '💬 MKT_Conversations',
  '📅 MKT_Conversation_Daily',
  '🧑‍💼 MKT_Agent_Daily',
  '📥 MKT_Inbox_Daily',
  '🏢 MKT_Conversation_Account_Daily',
  '🧾 MKT_Commerce_Orders',
  '🛍️ MKT_Commerce_Products',
  '👥 MKT_Commerce_Customers',
  '📅 MKT_Commerce_Daily',
  '📦 MKT_Commerce_Product_Daily',
  '🧠 MKT_AI_Report_Runs',
  '⚙️ MKT_Report_Settings',
  '🔔 MKT_Notification_Log',
  '🔄 MKT_Sync_Log',
  '🚨 MKT_System_Alerts',
  '🎵 RAW_TikTok_Creator_Videos',
  '🧾 MKT_Report_Snapshots',
  '📊 MKT_Report_Metric_Values',
  '🏆 MKT_Report_Top_Content',
  '📣 MKT_Report_Top_Ads',
]);

const SOURCE_LABEL = 'Social MKT Data Hub';
const TARGET_LABEL = '✨Marketing Content Calendar';
const TARGET_FOLDER_LABEL = 'Setup Phase | Social MKT Data Hub';
const DEFAULT_CUSTOMER_PROD_VARS_FILE = '.customer.prod.vars';
const CUSTOMER_PROD_VARS_TEMPLATE_FILE = '.customer.prod.vars.example';
const REQUIRED_CUSTOMER_PROD_KEYS = Object.freeze([
  'LARK_APP_ID',
  'LARK_APP_SECRET',
  'LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN',
  'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
]);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_full_parity_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_FULL_PARITY_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: redactDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveMode(process.argv.slice(2));
  if (mode !== 'full-parity-audit') {
    throw operatorError(
      'CUSTOMER_BASE_PARTIAL_PARITY_PATH_BLOCKED',
      'Customer requires 100% source parity. Legacy provision/preview/apply/verify paths are blocked until full-parity clone and verifier coverage are complete.',
      { requestedMode: mode, allowedMode: 'full-parity-audit' },
    );
  }

  const customerProdVarsFile = process.env.CUSTOMER_PROD_VARS_FILE ?? DEFAULT_CUSTOMER_PROD_VARS_FILE;
  const fileEnv = await readDevVars(customerProdVarsFile);
  const env = { ...fileEnv, ...process.env };
  assertCustomerProdConfig(env, customerProdVarsFile);

  const sourceAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN',
  );
  const targetAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
  );
  if (sourceAppToken === targetAppToken) {
    throw operatorError(
      'CUSTOMER_BASE_CONSOLIDATION_SAME_BASE_BLOCKED',
      'Source and target Base app tokens must be different',
    );
  }

  const sourceInstrumentation = instrumentStrictReads(createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: sourceAppToken,
  }, { onRequest: traceIfVerbose }), 'source');
  const targetInstrumentation = instrumentStrictReads(createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  }, { onRequest: traceIfVerbose }), 'target');

  const audit = await auditLarkBaseFullParity({
    sourceClient: sourceInstrumentation.client,
    targetClient: targetInstrumentation.client,
    expectedTableNames: EXPECTED_SOURCE_TABLE_NAMES,
    expectedTableCount: EXPECTED_SOURCE_TABLE_NAMES.length,
  });

  const strictReadFailures = [
    ...sourceInstrumentation.failures,
    ...targetInstrumentation.failures,
  ];
  const strictBlockers = strictReadFailures.map((failure) => ({
    code: 'FULL_PARITY_STRICT_READ_FAILED',
    message: `${failure.side} OpenAPI read failed during full-parity audit`,
    details: failure,
  }));
  const blockers = [...audit.blockers, ...strictBlockers];
  const ok = audit.ok && strictReadFailures.length === 0;

  printJson({
    ...audit,
    ok,
    blockers,
    strictReadFailureCount: strictReadFailures.length,
    strictReadFailures,
    contractVersion: 'customer_base_full_parity_operator_v1',
    action: 'full-parity-audit',
    configSource: {
      mode: 'customer-prod-file',
      file: customerProdVarsFile,
      template: CUSTOMER_PROD_VARS_TEMPLATE_FILE,
    },
    sourceIdentity: safeBaseIdentity(SOURCE_LABEL, sourceAppToken),
    targetIdentity: safeBaseIdentity(TARGET_LABEL, targetAppToken),
    targetFolder: TARGET_FOLDER_LABEL,
    remoteMutationCount: 0,
    nextCommand: null,
  });
  if (!ok) process.exitCode = 1;
}

function assertCustomerProdConfig(env, customerProdVarsFile) {
  const missing = REQUIRED_CUSTOMER_PROD_KEYS.filter((key) => (
    typeof env?.[key] !== 'string' || env[key].trim() === ''
  ));
  if (missing.length === 0) return;

  throw operatorError(
    'CUSTOMER_BASE_CONSOLIDATION_CONFIG_MISSING',
    `Customer PROD Lark config is incomplete: ${missing.join(', ')}`,
    {
      missing,
      configFile: customerProdVarsFile,
      templateFile: CUSTOMER_PROD_VARS_TEMPLATE_FILE,
      hint: `Copy ${CUSTOMER_PROD_VARS_TEMPLATE_FILE} to ${customerProdVarsFile} and fill the required values locally.`,
    },
  );
}

function instrumentStrictReads(client, side) {
  const failures = [];
  const original = client.requestBitableJson.bind(client);
  client.requestBitableJson = async (path, options = {}) => {
    try {
      return await original(path, options);
    } catch (error) {
      failures.push(Object.freeze({
        side,
        resource: sanitizePath(path, client.appToken),
        code: error?.code ?? error?.details?.code ?? 'UNKNOWN_READ_ERROR',
        status: error?.details?.status ?? null,
        larkCode: error?.details?.larkCode ?? null,
      }));
      throw error;
    }
  };
  return Object.freeze({ client, failures });
}

function sanitizePath(path, appToken) {
  const raw = typeof path === 'string' ? path : String(path ?? '');
  return raw.split(appToken).join('[BASE]');
}

function resolveMode(args) {
  const known = [
    ['--full-parity-audit', 'full-parity-audit'],
    ['--provision-missing', 'provision-missing'],
    ['--preview', 'preview'],
    ['--apply', 'apply'],
    ['--verify', 'verify'],
  ];
  const selected = known.filter(([flag]) => args.includes(flag));
  if (selected.length > 1) {
    throw operatorError(
      'CUSTOMER_BASE_CONSOLIDATION_MODE_INVALID',
      'Choose only one operator mode',
      { selected: selected.map(([flag]) => flag) },
    );
  }
  return selected[0]?.[1] ?? 'full-parity-audit';
}

function safeBaseIdentity(label, appToken) {
  return Object.freeze({
    label,
    appTokenSha256: createHash('sha256').update(appToken).digest('hex'),
  });
}

function traceIfVerbose(event) {
  if (process.env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event));
}

function redactDetails(value) {
  if (Array.isArray(value)) return value.map(redactDetails);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|password/iu.test(key)) result[key] = '[REDACTED]';
    else result[key] = redactDetails(nested);
  }
  return result;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError('CUSTOMER_BASE_CONSOLIDATION_CONFIG_MISSING', `${name} is required`);
  }
  return value.trim();
}

function operatorError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
