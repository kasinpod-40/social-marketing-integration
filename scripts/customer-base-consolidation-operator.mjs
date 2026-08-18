import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';

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

const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub(20260818-030125).base';
const SOURCE_EXPORT_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const EXPECTED_EXPORT_BASELINE = Object.freeze({
  tables: 33,
  fields: 723,
  records: 35_528,
  views: 111,
  relationFields: 12,
  formulaFields: 4,
  dashboards: 6,
  workflows: 2,
  advancedPermissionRoles: 4,
});

const SOURCE_LABEL = 'Social MKT Data Hub';
const TARGET_LABEL = '✨Marketing Content Calendar';
const TARGET_FOLDER_LABEL = 'Setup Phase | Social MKT Data Hub';
const DEFAULT_CUSTOMER_PROD_VARS_FILE = '.customer.prod.vars';
const CUSTOMER_PROD_VARS_TEMPLATE_FILE = '.customer.prod.vars.example';
const TARGET_REQUIRED_KEYS = Object.freeze([
  'LARK_APP_ID',
  'LARK_APP_SECRET',
  'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
]);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_full_parity_operator_v4',
    code: error?.code ?? 'CUSTOMER_BASE_FULL_PARITY_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: redactDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveMode(process.argv.slice(2));
  if (!new Set(['full-parity-audit', 'source-export-audit']).has(mode)) {
    throw operatorError(
      'CUSTOMER_BASE_PARTIAL_PARITY_PATH_BLOCKED',
      'Customer requires 100% source parity. Write/apply paths remain blocked until every exported dimension has clone/remap/verify coverage.',
      { requestedMode: mode, allowedModes: ['full-parity-audit', 'source-export-audit'] },
    );
  }

  const customerProdVarsFile = process.env.CUSTOMER_PROD_VARS_FILE ?? DEFAULT_CUSTOMER_PROD_VARS_FILE;
  const fileEnv = await readDevVars(customerProdVarsFile);
  const env = { ...fileEnv, ...process.env };
  const sourceExportFile = resolveSourceExportFile(env);
  const exportInspection = await inspectLarkBaseExport(sourceExportFile);
  const exportAuthority = compareExportAuthority(exportInspection);

  if (mode === 'source-export-audit') {
    printJson({
      ok: exportAuthority.ok,
      contractVersion: 'customer_base_full_parity_operator_v4',
      action: 'source-export-audit',
      stage: 'local-export-authority-preflight',
      mode: 'local-read-only',
      sourceAuthority: safeExportIdentity(exportInspection),
      exportInspection,
      exportAuthority,
      configSource: configSource(customerProdVarsFile, sourceExportFile),
      targetFolder: TARGET_FOLDER_LABEL,
      remoteMutationCount: 0,
      remoteRequestCount: 0,
      targetReadExecuted: false,
      nextCommand: null,
    });
    if (!exportAuthority.ok) process.exitCode = 1;
    return;
  }

  assertTargetConfig(env, customerProdVarsFile);
  const targetAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
  );
  const targetClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  }, { onRequest: traceIfVerbose });
  const targetInspection = await inspectTarget(targetClient);
  const blockers = [...exportAuthority.blockers];
  if (targetInspection.metadata.name !== TARGET_LABEL) {
    blockers.push(problem(
      'CUSTOMER_BASE_TARGET_IDENTITY_NAME_MISMATCH',
      'Configured Target Base name does not match the customer destination',
      { expected: TARGET_LABEL, actual: targetInspection.metadata.name },
    ));
  }

  const ok = blockers.length === 0;
  printJson({
    ok,
    contractVersion: 'customer_base_full_parity_operator_v4',
    action: 'full-parity-audit',
    stage: 'local-export-authority-and-target-preflight',
    mode: 'read-only',
    sourceAuthority: safeExportIdentity(exportInspection),
    exportInspection,
    exportAuthority,
    target: targetInspection,
    blockers,
    configSource: configSource(customerProdVarsFile, sourceExportFile),
    targetIdentity: safeBaseIdentity(TARGET_LABEL, targetAppToken),
    targetFolder: TARGET_FOLDER_LABEL,
    remoteMutationCount: 0,
    sourceLiveReadExecuted: false,
    sourceLiveAuthorityRequired: false,
    cloneApplyEnabled: false,
    nextCommand: null,
  });
  if (!ok) process.exitCode = 1;
}

function resolveSourceExportFile(env) {
  const configured = optionalText(env?.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE);
  if (configured) return configured;
  return join(homedir(), 'Downloads', SOURCE_EXPORT_FILENAME);
}

async function inspectTarget(client) {
  const [metadataResponse, tables] = await Promise.all([
    client.requestBitableJson(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}`,
      { method: 'GET' },
    ),
    client.listTables(),
  ]);
  const app = metadataResponse?.data?.app ?? metadataResponse?.data ?? {};
  const names = tables.map((table) => optionalText(table?.name)).filter(Boolean);
  const expectedPresent = EXPECTED_SOURCE_TABLE_NAMES.filter((name) => names.includes(name));
  return {
    metadata: {
      name: requireText(app?.name, 'target base.name'),
      revision: finiteNumberOrNull(app?.revision),
      isAdvanced: typeof app?.is_advanced === 'boolean' ? app.is_advanced : null,
      timeZone: optionalText(app?.time_zone),
      formulaType: finiteNumberOrNull(app?.formula_type),
      advanceVersion: optionalText(app?.advance_version),
    },
    tableCount: tables.length,
    uniqueTableNameCount: new Set(names).size,
    expectedMigrationTablesPresent: expectedPresent,
    expectedMigrationTableCount: expectedPresent.length,
    missingExpectedMigrationTables: EXPECTED_SOURCE_TABLE_NAMES.filter((name) => !names.includes(name)),
    unrelatedTables: names.filter((name) => !EXPECTED_SOURCE_TABLE_NAMES.includes(name)),
  };
}

function compareExportAuthority(inspection) {
  const blockers = [];
  if (inspection?.file?.sha256 !== SOURCE_EXPORT_SHA256) {
    blockers.push(problem(
      'CUSTOMER_BASE_SOURCE_EXPORT_SHA256_MISMATCH',
      'Source .base file is not the exact approved export uploaded for this migration',
      { expectedSha256: SOURCE_EXPORT_SHA256, actualSha256: inspection?.file?.sha256 ?? null },
    ));
  }

  for (const [key, expected] of Object.entries(EXPECTED_EXPORT_BASELINE)) {
    const actual = inspection?.counts?.[key];
    if (actual !== expected) {
      blockers.push(problem(
        'CUSTOMER_BASE_SOURCE_EXPORT_COUNT_MISMATCH',
        `Source .base export ${key} count does not match the approved authority baseline`,
        { dimension: key, expected, actual: actual ?? null },
      ));
    }
  }

  const tableNames = inspection?.names?.tables ?? [];
  const missing = EXPECTED_SOURCE_TABLE_NAMES.filter((name) => !tableNames.includes(name));
  const unexpected = tableNames.filter((name) => !EXPECTED_SOURCE_TABLE_NAMES.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    blockers.push(problem(
      'CUSTOMER_BASE_SOURCE_EXPORT_TABLE_SET_MISMATCH',
      'Source .base export table names do not match the approved 33-table migration set',
      { missingExpectedTables: missing, unexpectedTables: unexpected },
    ));
  }

  return Object.freeze({
    ok: blockers.length === 0,
    approvedFile: {
      fileName: SOURCE_EXPORT_FILENAME,
      sha256: SOURCE_EXPORT_SHA256,
    },
    expected: EXPECTED_EXPORT_BASELINE,
    actual: inspection.counts,
    blockers: Object.freeze(blockers),
  });
}

function configSource(customerProdVarsFile, sourceExportFile) {
  return {
    mode: 'customer-prod-file-with-export-default',
    file: customerProdVarsFile,
    template: CUSTOMER_PROD_VARS_TEMPLATE_FILE,
    sourceAuthority: 'local-lark-base-export',
    sourceExportFile,
    sourceExportDefaultUsed: !process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE,
  };
}

function assertTargetConfig(env, customerProdVarsFile) {
  const missing = TARGET_REQUIRED_KEYS.filter((key) => (
    typeof env?.[key] !== 'string' || env[key].trim() === ''
  ));
  if (missing.length === 0) return;

  throw operatorError(
    'CUSTOMER_BASE_CONSOLIDATION_CONFIG_MISSING',
    `Customer PROD Target Lark config is incomplete: ${missing.join(', ')}`,
    {
      missing,
      configFile: customerProdVarsFile,
      templateFile: CUSTOMER_PROD_VARS_TEMPLATE_FILE,
      hint: 'Local --source-export-audit needs no Lark credentials. Target credentials are required only for Target read/apply modes.',
    },
  );
}

function resolveMode(args) {
  const known = [
    ['--full-parity-audit', 'full-parity-audit'],
    ['--source-export-audit', 'source-export-audit'],
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

function safeExportIdentity(inspection) {
  return Object.freeze({
    label: SOURCE_LABEL,
    fileName: basename(inspection.file.path),
    fileSha256: inspection.file.sha256,
    fileSizeBytes: inspection.file.sizeBytes,
  });
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

function problem(code, message, details = {}) {
  return Object.freeze({ code, message, details: Object.freeze(structuredClone(details)) });
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
