import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveReportSchemaInstallerMode } from './lib/report-schema-installer-mode.js';
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
  const env = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const mode = resolveReportSchemaInstallerMode({ argv: process.argv.slice(2), env: process.env });
  const client = createLarkBitableClientFromEnv(env, {
    onRequest: process.env.MKT_SCHEMA_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });
  const schemaInput = {
    client,
    env,
    schema: LARK_REPORT_SCHEMA_V2,
    schemaVersion: LARK_REPORT_SCHEMA_V2_VERSION,
    validateSchema: validateReportSchemaV2,
  };

  if (!mode.apply) {
    const preview = await planLarkReportSchema(schemaInput);
    printJson({
      ...preview,
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
