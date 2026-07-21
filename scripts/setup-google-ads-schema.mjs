import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveGoogleAdsSchemaInstallerMode } from './lib/google-ads-schema-installer-mode.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { assertGoogleAdsSchemaDevTarget } from '../packages/config/src/google-ads-schema-runtime-config.js';
import {
  GOOGLE_ADS_LARK_SCHEMA,
  GOOGLE_ADS_LARK_SCHEMA_VERSION,
  GOOGLE_ADS_RELATIONS,
  GOOGLE_ADS_VIEW_CONTRACT,
  validateGoogleAdsLarkSchema,
} from '../packages/config/src/google-ads-lark-schema.js';
import { previewGoogleAdsLarkSchema } from '../packages/application/src/use-cases/preview-google-ads-lark-schema.js';
import { applyGoogleAdsLarkSchema } from '../packages/application/src/use-cases/apply-google-ads-lark-schema.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'GOOGLE_ADS_SCHEMA_SETUP_FAILED',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveGoogleAdsSchemaInstallerMode({
    argv: process.argv.slice(2),
    env: process.env,
  });
  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const fileEnv = await readDevVars(devVarsFile);
  const env = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const runtime = assertGoogleAdsSchemaDevTarget(env, {
    operation: mode.apply ? 'apply' : 'preview',
    errorCode: mode.apply
      ? 'GOOGLE_ADS_SCHEMA_APPLY_DEV_TARGET_REQUIRED'
      : 'GOOGLE_ADS_SCHEMA_PREVIEW_DEV_TARGET_REQUIRED',
  });
  const client = createLarkBitableClientFromEnv(env, {
    onRequest: process.env.MKT_SCHEMA_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });

  const common = {
    client,
    env,
    schema: GOOGLE_ADS_LARK_SCHEMA,
    relations: GOOGLE_ADS_RELATIONS,
    viewContract: GOOGLE_ADS_VIEW_CONTRACT,
    schemaVersion: GOOGLE_ADS_LARK_SCHEMA_VERSION,
    validateSchema: validateGoogleAdsLarkSchema,
  };

  if (!mode.apply) {
    const preview = await previewGoogleAdsLarkSchema(common);
    printJson({
      ok: true,
      ...preview,
      target: {
        mode: 'live_lark_dev_read_only',
        environment: runtime.environment,
        profileKey: runtime.profileKey,
      },
      nextCommand: preview.readyForApplyAuthorization
        ? 'CONFIRM_WRITE=YES CONFIRM_GOOGLE_ADS_SCHEMA=YES npm run setup:google-ads-schema:apply'
        : null,
      note: 'Preview เท่านั้น ไม่มีการสร้าง/แก้ Table, Field, Relation, View หรือ Record',
      warning: mode.ignoredAmbientConfirmation || mode.ignoredAmbientSchemaConfirmation
        ? 'พบ Confirmation ใน Shell แต่ Preview command จะไม่เขียน ต้องใช้ setup:google-ads-schema:apply เท่านั้น'
        : null,
    });
    return;
  }

  const result = await applyGoogleAdsLarkSchema({
    ...common,
    onProgress: (event) => {
      if (process.env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event));
    },
  });
  printJson({
    ...result,
    target: {
      mode: 'live_lark_dev_apply',
      environment: runtime.environment,
      profileKey: runtime.profileKey,
    },
    configNote: 'นำ environmentUpdates ไปใส่ใน .dev.vars และ wrangler.sync.jsonc ที่ถูก Ignore; ห้าม Commit Table IDs จริง',
    runtimeNote: 'Google Ads Connector, Worker endpoint และ Schedule ยังปิดอยู่หลัง Schema Apply',
  });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
