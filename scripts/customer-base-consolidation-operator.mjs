import { createHash } from 'node:crypto';
import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  applyLarkBaseConsolidation,
  previewLarkBaseConsolidation,
  verifyLarkBaseConsolidation,
} from '../packages/application/src/use-cases/consolidate-lark-base.js';

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

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_consolidation_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_CONSOLIDATION_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: redactDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveMode(process.argv.slice(2));
  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const fileEnv = await readDevVars(devVarsFile);
  const env = { ...fileEnv, ...process.env };

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

  const sourceClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: sourceAppToken,
  }, { onRequest: traceIfVerbose });
  const targetClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  }, { onRequest: traceIfVerbose });

  const common = {
    sourceClient,
    targetClient,
    expectedTableNames: EXPECTED_SOURCE_TABLE_NAMES,
    expectedSourceTableCount: EXPECTED_SOURCE_TABLE_NAMES.length,
  };

  if (mode === 'verify') {
    const verification = await verifyLarkBaseConsolidation(common);
    printJson({
      ...verification,
      contractVersion: 'customer_base_consolidation_operator_v1',
      action: 'verify',
      source: safeBaseIdentity(SOURCE_LABEL, sourceAppToken),
      target: safeBaseIdentity(TARGET_LABEL, targetAppToken),
      targetFolder: TARGET_FOLDER_LABEL,
      remoteMutationCount: 0,
    });
    if (!verification.ok) process.exitCode = 1;
    return;
  }

  if (mode === 'preview') {
    const preview = await previewLarkBaseConsolidation(common);
    printJson({
      ...preview,
      contractVersion: 'customer_base_consolidation_operator_v1',
      action: 'preview',
      source: safeBaseIdentity(SOURCE_LABEL, sourceAppToken),
      target: safeBaseIdentity(TARGET_LABEL, targetAppToken),
      targetFolder: TARGET_FOLDER_LABEL,
      remoteMutationCount: 0,
      nextCommand: preview.readyToApply
        ? 'CONFIRM_WRITE=YES CONFIRM_CUSTOMER_BASE_CONSOLIDATION=YES CONFIRM_SOURCE_BASE=SOCIAL_MKT_DATA_HUB CONFIRM_TARGET_BASE=MARKETING_CONTENT_CALENDAR node scripts/customer-base-consolidation-operator.mjs --apply'
        : null,
    });
    if (!preview.readyToApply) process.exitCode = 1;
    return;
  }

  assertApplyConfirmations(env);
  const result = await applyLarkBaseConsolidation({
    ...common,
    onProgress: (event) => {
      if (env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event));
    },
  });
  printJson({
    ...result,
    contractVersion: 'customer_base_consolidation_operator_v1',
    action: 'apply',
    source: safeBaseIdentity(SOURCE_LABEL, sourceAppToken),
    target: safeBaseIdentity(TARGET_LABEL, targetAppToken),
    targetFolder: TARGET_FOLDER_LABEL,
    safety: {
      deleteTables: 0,
      deleteFields: 0,
      deleteRecords: 0,
      sourceMutations: 0,
      scheduleChanges: 0,
      automationChanges: 0,
    },
  });
}

function resolveMode(args) {
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const preview = args.includes('--preview');
  const selected = [apply, verify, preview].filter(Boolean).length;
  if (selected > 1) {
    throw operatorError(
      'CUSTOMER_BASE_CONSOLIDATION_MODE_INVALID',
      'Choose only one mode: --preview, --apply, or --verify',
    );
  }
  if (apply) return 'apply';
  if (verify) return 'verify';
  return 'preview';
}

function assertApplyConfirmations(env) {
  const required = {
    CONFIRM_WRITE: 'YES',
    CONFIRM_CUSTOMER_BASE_CONSOLIDATION: 'YES',
    CONFIRM_SOURCE_BASE: 'SOCIAL_MKT_DATA_HUB',
    CONFIRM_TARGET_BASE: 'MARKETING_CONTENT_CALENDAR',
  };
  const missing = Object.entries(required)
    .filter(([name, value]) => env[name] !== value)
    .map(([name, value]) => `${name}=${value}`);
  if (missing.length > 0) {
    throw operatorError(
      'CUSTOMER_BASE_CONSOLIDATION_CONFIRMATION_REQUIRED',
      `Apply requires explicit confirmation: ${missing.join(', ')}`,
      { missing },
    );
  }
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
