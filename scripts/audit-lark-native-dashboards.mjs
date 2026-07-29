#!/usr/bin/env node

import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkDashboardClient } from '../packages/connectors/src/lark/lark-dashboard.client.js';
import { auditLarkNativeDashboards } from '../packages/application/src/use-cases/audit-lark-native-dashboards.js';

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
  const fileEnv = await readDevVars(devVarsFile);
  const env = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const bitableClient = createLarkBitableClientFromEnv(env, {
    onRequest: process.env.MKT_DASHBOARD_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });
  const dashboardClient = new LarkDashboardClient({ client: bitableClient });
  const result = await auditLarkNativeDashboards({ client: dashboardClient });
  printJson({
    ...result,
    ok: result.conflicts.length === 0,
    note: result.complete
      ? 'Native Dashboards ทั้ง 6 ตัวมีอยู่ใน Lark Base แล้ว; Chart/Layout ยังต้องตรวจตาม manualActions ใน Lark UI'
      : 'Read-only เท่านั้น ไม่มีการสร้างหรือแก้ Dashboard; ให้ทำรายการ missing/manualActions ใน Lark UI',
  });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
