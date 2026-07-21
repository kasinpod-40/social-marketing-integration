import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { loadSharedTableSchemaContract } from './lib/shared-table-schema-contract.js';
import { resolveSharedTableSchemaInstallerMode } from './lib/shared-table-schema-installer-mode.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { assertSharedTableSchemaDevTarget } from '../packages/config/src/shared-table-schema-runtime-config.js';
import {
  SHARED_TABLE_LARK_SCHEMA_VERSION,
  validateSharedTableLarkSchema,
} from '../packages/config/src/shared-table-lark-schema.js';
import { previewSharedTableLarkSchema } from '../packages/application/src/use-cases/preview-shared-table-lark-schema.js';
import { applySharedTableLarkSchema } from '../packages/application/src/use-cases/apply-shared-table-lark-schema.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'SHARED_TABLE_SCHEMA_SETUP_FAILED',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveSharedTableSchemaInstallerMode({
    argv: process.argv.slice(2),
    env: process.env,
  });
  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const fileEnv = await readDevVars(devVarsFile);
  const env = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const runtime = assertSharedTableSchemaDevTarget(env, {
    operation: mode.apply ? 'apply' : 'preview',
    errorCode: mode.apply
      ? 'SHARED_TABLE_APPLY_DEV_TARGET_REQUIRED'
      : 'SHARED_TABLE_PREVIEW_DEV_TARGET_REQUIRED',
  });
  const { schema, views } = await loadSharedTableSchemaContract();
  const client = createLarkBitableClientFromEnv(env, {
    onRequest: process.env.MKT_SCHEMA_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });

  if (!mode.apply) {
    const preview = await previewSharedTableLarkSchema({
      client,
      env,
      schema,
      views,
      schemaVersion: SHARED_TABLE_LARK_SCHEMA_VERSION,
      validateSchema: validateSharedTableLarkSchema,
    });
    printJson({
      ok: true,
      ...preview,
      target: { mode: 'live_lark_dev', environment: runtime.environment, profileKey: runtime.profileKey },
      nextCommand: preview.readyForApplyAuthorization
        ? 'CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply'
        : null,
      note: 'Preview mode เท่านั้น ยังไม่มีการ Rename/Create/Update Table, Field, View หรือ Record',
      warning: mode.ignoredAmbientConfirmation || mode.ignoredAmbientSchemaConfirmation
        ? 'พบ Confirmation ใน Shell แต่ Preview command จะไม่เขียน ต้องใช้ setup:shared-table-schema:apply เท่านั้น'
        : null,
    });
    return;
  }

  const result = await applySharedTableLarkSchema({
    client,
    env,
    schema,
    views,
    schemaVersion: SHARED_TABLE_LARK_SCHEMA_VERSION,
    validateSchema: validateSharedTableLarkSchema,
    onProgress: (event) => {
      if (process.env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event));
    },
  });
  printJson({
    ...result,
    target: { mode: 'live_lark_dev_apply', environment: runtime.environment, profileKey: runtime.profileKey },
    configNote: 'นำ environmentUpdates ไปใส่ใน .dev.vars และ wrangler.sync.jsonc ที่ถูก ignore; ห้าม Commit Table IDs จริง',
    verificationNote: 'Apply สำเร็จเมื่อ Preview และ View verification เหลือ 0 actions/conflicts/warnings/manual blockers เท่านั้น',
  });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
