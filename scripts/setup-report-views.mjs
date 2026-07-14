import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveConfirmedApplyMode } from './lib/confirmed-apply-mode.js';
import { readWranglerStringVars } from './lib/wrangler-sync-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LARK_REPORT_VIEWS } from '../packages/config/src/lark-report-views.js';
import {
  applyLarkReportViews,
  planLarkReportViews,
} from '../packages/application/src/use-cases/install-lark-report-views.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'UNEXPECTED_ERROR',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const wranglerConfigFile = process.env.WRANGLER_SYNC_CONFIG ?? 'wrangler.sync.jsonc';
  const fileEnv = await readDevVars(devVarsFile);
  const tableKeys = [...new Set(LARK_REPORT_VIEWS.map((table) => table.envName))];
  const wrangler = await readWranglerStringVars(wranglerConfigFile, tableKeys);
  const env = normalizeEnvAliases({ ...wrangler.values, ...fileEnv, ...process.env });
  const mode = resolveConfirmedApplyMode({
    argv: process.argv.slice(2),
    env: process.env,
    operationName: 'Report client view apply',
    confirmationErrorCode: 'REPORT_VIEW_WRITE_CONFIRMATION_REQUIRED',
    applyCommand: 'CONFIRM_WRITE=YES npm run setup:report-views:apply',
  });
  const client = createLarkBitableClientFromEnv(env, {
    onRequest: process.env.MKT_VIEW_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });

  if (!mode.apply) {
    const preview = await planLarkReportViews({ client, env });
    printJson({
      ...preview,
      nextCommand: preview.readyToApply && preview.actions.length > 0
        ? 'CONFIRM_WRITE=YES npm run setup:report-views:apply'
        : null,
      note: preview.actions.length === 0
        ? 'Client Views ตรง Contract แล้ว ไม่มีการเขียนข้อมูล'
        : 'Preview mode เท่านั้น ยังไม่มีการสร้างหรือแก้ไข View',
      warning: mode.ignoredAmbientConfirmation
        ? 'พบ CONFIRM_WRITE=YES ใน Shell แต่ Preview command จะไม่เขียนข้อมูล ต้องใช้ setup:report-views:apply เท่านั้น'
        : null,
    });
    return;
  }

  const result = await applyLarkReportViews({ client, env });
  printJson({
    ...result,
    note: 'View API ติดตั้ง Filter และ Hidden fields แล้ว; Sort rank และ Advanced Permission ให้ทำตาม manualActions ใน Lark UI',
  });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
