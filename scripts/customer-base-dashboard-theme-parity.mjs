import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION,
  CUSTOMER_BASE_DASHBOARD_THEME_STYLE,
  applyCustomerBaseDashboardThemeParity,
} from './lib/customer-base-dashboard-theme-parity.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_dashboard_theme_parity_v1',
    code: error?.code ?? 'CUSTOMER_BASE_DASHBOARD_THEME_OPERATOR_FAILED',
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
  const targetAppToken = requireText(
    env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN,
    'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN',
  );
  const targetClient = createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  });
  const confirmation = mode === 'apply'
    ? requireText(env.CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION, 'CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION')
    : null;

  const result = await applyCustomerBaseDashboardThemeParity({
    targetClient,
    mode,
    confirmation,
    onProgress: (event) => console.error(JSON.stringify({ event: 'customer_base_dashboard_theme_progress', ...event })),
  });

  printJson({
    ...result,
    safety: {
      automaticApplyRerun: false,
      checkpointMutation: false,
      dashboardBlockMutationCount: result.dashboardBlockMutationCount,
      tableMutationCount: result.tableMutationCount,
      fieldMutationCount: result.fieldMutationCount,
      recordMutationCount: result.recordMutationCount,
      viewMutationCount: result.viewMutationCount,
      formulaMutationCount: result.formulaMutationCount,
      roleMutationCount: result.roleMutationCount,
      workflowMutationCount: result.workflowMutationCount,
    },
    nextApplyCommand: mode === 'preview'
      ? `CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION=${CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION} node scripts/customer-base-dashboard-theme-parity.mjs --apply`
      : null,
    expectedThemeStyle: CUSTOMER_BASE_DASHBOARD_THEME_STYLE,
  });
}

function safeDetails(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|authorization)/iu.test(key)));
}
function requireText(value, name) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new TypeError(`${name} is required`);
  return result;
}
