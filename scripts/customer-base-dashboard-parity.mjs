import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION,
  applyCustomerBaseDashboardParity,
  buildCustomerBaseDashboardParityPlan,
} from './lib/customer-base-dashboard-parity.js';

const CURRENT_SOURCE_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';
const TARGET_LABEL = '✨Marketing Content Calendar';
const TARGET_FOLDER_NAME = 'Setup Phase | Social MKT Data Hub';
const REQUIRED_TARGET_ANCHORS = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
]);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_dashboard_documented_api_parity_v1',
    code: error?.code ?? 'CUSTOMER_BASE_DASHBOARD_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: safeDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : 'preview';
  const customerProdVarsFile = process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars';
  const fileEnv = await readDevVars(customerProdVarsFile);
  const env = { ...fileEnv, ...process.env };
  const sourceFile = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Desktop', 'Social MKT Data Hub.base');
  const sourceSha256 = await sha256File(sourceFile);
  if (sourceSha256 !== CURRENT_SOURCE_SHA256) {
    throw codedError('CUSTOMER_BASE_DASHBOARD_SOURCE_SHA_MISMATCH', 'Dashboard operator requires the exact current Source export', {
      expected: CURRENT_SOURCE_SHA256,
      actual: sourceSha256,
      sourceFile,
    });
  }

  const sourceClient = await createLarkBaseExportSourceClient(sourceFile);
  const plan = await buildCustomerBaseDashboardParityPlan({ sourceClient });
  const targetAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
  );
  const targetClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  });
  const confirmation = mode === 'apply'
    ? requireText(env.CUSTOMER_BASE_DASHBOARD_APPLY_CONFIRMATION, 'CUSTOMER_BASE_DASHBOARD_APPLY_CONFIRMATION')
    : null;

  const result = await applyCustomerBaseDashboardParity({
    plan,
    targetClient,
    mode,
    confirmation,
    folderName: TARGET_FOLDER_NAME,
    requiredTargetAnchorTableNames: REQUIRED_TARGET_ANCHORS,
    onProgress: (event) => console.error(JSON.stringify({ event: 'customer_base_dashboard_progress', ...event })),
  });

  printJson({
    ...result,
    sourceAuthority: {
      file: sourceFile,
      sha256: sourceSha256,
      dashboardCount: plan.summary.dashboardCount,
      dashboardBlockCount: plan.summary.dashboardBlockCount,
      documentedApiBlockCount: plan.summary.documentedApiBlockCount,
      unsupportedBlockCount: plan.summary.unsupportedBlockCount,
      unsupportedByKind: plan.summary.unsupportedByKind,
    },
    target: {
      label: TARGET_LABEL,
      folderName: TARGET_FOLDER_NAME,
    },
    safety: {
      automaticApplyRerun: false,
      checkpointMutation: false,
      tableMutationCount: result.tableMutationCount,
      fieldMutationCount: result.fieldMutationCount,
      recordMutationCount: result.recordMutationCount,
      viewMutationCount: result.viewMutationCount,
      formulaMutationCount: result.formulaMutationCount,
      roleMutationCount: result.roleMutationCount,
      workflowMutationCount: result.workflowMutationCount,
    },
    nextApplyCommand: mode === 'preview'
      ? `CUSTOMER_BASE_DASHBOARD_APPLY_CONFIRMATION=${CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION} node scripts/customer-base-dashboard-parity.mjs --apply`
      : null,
  });
}

async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}
function safeDetails(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|authorization)/iu.test(key)));
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function requireText(value, name) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}
function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
