import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveReportSchemaInstallerMode } from './lib/report-schema-installer-mode.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { applyLarkSchema, planLarkSchema } from '../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  YOUTUBE_LARK_SCHEMA,
  YOUTUBE_LARK_SCHEMA_VERSION,
  validateYouTubeLarkSchema,
} from '../packages/config/src/youtube-lark-schema.js';

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
  const common = {
    client,
    env,
    schema: YOUTUBE_LARK_SCHEMA,
    schemaVersion: YOUTUBE_LARK_SCHEMA_VERSION,
    validateSchema: validateYouTubeLarkSchema,
  };

  if (!mode.apply) {
    const preview = await planLarkSchema(common);
    printJson({
      ...preview,
      nextCommand: preview.readyToApply
        ? 'CONFIRM_WRITE=YES npm run setup:youtube-schema:apply'
        : null,
      note: 'Preview เท่านั้น ยังไม่สร้างหรือแก้ YouTube RAW tables',
      warning: mode.ignoredAmbientConfirmation
        ? 'พบ CONFIRM_WRITE=YES แต่ Preview command ไม่เขียนข้อมูล'
        : null,
    });
    return;
  }

  const result = await applyLarkSchema({
    ...common,
    onProgress: (event) => {
      if (process.env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event));
    },
  });
  printJson({
    ...result,
    configNote: 'นำ environmentUpdates ไปใส่ใน local wrangler.sync.jsonc เท่านั้น ห้าม Commit',
  });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
