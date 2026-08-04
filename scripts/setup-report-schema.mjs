import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveReportSchemaInstallerMode } from './lib/report-schema-installer-mode.js';
import { resolveReportMetricValueTableEnvironment } from './lib/report-metric-value-table-environment-resolver.js';
import {
  buildLarkDashboardCompatibilityReportSchema,
  inspectLarkDashboardCompatibilityFreeze,
} from './lib/lark-dashboard-compatibility-freeze-v1.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  applyLarkReportSchema,
  planLarkReportSchema,
} from '../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../packages/config/src/lark-report-schema-v2.js';

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
  const sourceEnv = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const mode = resolveReportSchemaInstallerMode({ argv: process.argv.slice(2), env: process.env });
  const client = createLarkBitableClientFromEnv(sourceEnv, {
    onRequest: process.env.MKT_SCHEMA_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });
  const env = await resolveReportMetricValueTableEnvironment({
    client,
    env: sourceEnv,
  });
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({ client, env });
  if (compatibility.applicable && compatibility.compatible !== true) {
    const error = new Error(
      'Report schema is outside the exact Dashboard Compatibility Freeze boundary',
    );
    error.code = 'LARK_REPORT_SCHEMA_COMPATIBILITY_FREEZE_BLOCKED';
    error.details = {
      blockerCount: compatibility.blockerCount,
      blockers: compatibility.blockers,
      remoteMutationCount: 0,
    };
    throw error;
  }
  const schema = buildLarkDashboardCompatibilityReportSchema(LARK_REPORT_SCHEMA_V2, env);
  const schemaInput = {
    client,
    env,
    schema,
    schemaVersion: LARK_REPORT_SCHEMA_V2_VERSION,
    validateSchema: validateReportSchemaV2,
  };

  if (!mode.apply) {
    const preview = await planLarkReportSchema(schemaInput);
    printJson({
      ...preview,
      dashboardCompatibilityFreeze: compatibility.compatible === true,
      dashboardCompatibilityFreezeContractVersion:
        compatibility.compatible === true ? compatibility.contractVersion : null,
      nextCommand: preview.readyToApply
        ? 'CONFIRM_WRITE=YES npm run setup:report-schema:apply'
        : null,
      note: 'Preview mode เท่านั้น ยังไม่มีการสร้างหรือแก้ไข Table/Field',
      warning: mode.ignoredAmbientConfirmation
        ? 'พบ CONFIRM_WRITE=YES ใน Shell แต่ Preview command จะไม่เขียนข้อมูล ต้องใช้ setup:report-schema:apply เท่านั้น'
        : null,
    });
    return;
  }

  const result = await applyLarkReportSchema({
    ...schemaInput,
    onProgress: (event) => {
      if (process.env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event));
    },
  });
  printJson({
    ...result,
    dashboardCompatibilityFreeze: compatibility.compatible === true,
    dashboardCompatibilityFreezeContractVersion:
      compatibility.compatible === true ? compatibility.contractVersion : null,
    configNote: 'นำ environmentUpdates ไปแทน Table IDs ใน wrangler.sync.jsonc โดยไม่ Commit ไฟล์ Local config',
  });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
