import { readFile } from 'node:fs/promises';
import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { resolveConfirmedApplyMode } from './lib/confirmed-apply-mode.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { applyLarkSchema, planLarkSchema } from '../packages/application/src/use-cases/install-lark-report-schema.js';
import { META_LARK_SCHEMA_VERSION, buildMetaLarkSchemaFromCsv, validateMetaLarkSchema } from '../packages/config/src/meta-lark-schema.js';
import { assertMetaSchemaDevTarget } from '../packages/config/src/meta-schema-runtime-config.js';

const ROOT = new URL('../', import.meta.url);
const FIELD_CONTRACTS = Object.freeze([
  'docs/meta-blueprint-v0.12.0/facebook-organic-fields.csv',
  'docs/meta-blueprint-v0.12.0/instagram-organic-fields.csv',
  'docs/meta-blueprint-v0.12.0/meta-ads-fields.csv',
  'docs/meta-blueprint-v0.12.0/canonical-account-daily-fields.csv',
]);

try { await main(); } catch (error) {
  console.error(JSON.stringify({ ok: false, name: error?.name ?? 'Error', code: error?.code ?? 'UNEXPECTED_ERROR', retryable: error?.retryable === true, message: error?.message ?? String(error), details: error?.details ?? {} }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const runtime = assertMetaSchemaDevTarget(env);
  const mode = resolveConfirmedApplyMode({ argv: process.argv.slice(2), env: process.env, operationName: 'Meta DEV schema apply', confirmationErrorCode: 'META_SCHEMA_WRITE_CONFIRMATION_REQUIRED', applyCommand: 'CONFIRM_WRITE=YES npm run setup:meta-schema:apply' });
  const [inventoryCsv, ...fieldCsvs] = await Promise.all([readFile(new URL('docs/meta-blueprint-v0.12.0/table-inventory.csv', ROOT), 'utf8'), ...FIELD_CONTRACTS.map((path) => readFile(new URL(path, ROOT), 'utf8'))]);
  const schema = buildMetaLarkSchemaFromCsv({ inventoryCsv, fieldCsvs });
  const client = createLarkBitableClientFromEnv(env, { onRequest: process.env.MKT_SCHEMA_VERBOSE === 'true' ? (event) => console.error(JSON.stringify(event)) : undefined });
  const common = { client, env, schema, schemaVersion: META_LARK_SCHEMA_VERSION, validateSchema: validateMetaLarkSchema };
  if (!mode.apply) {
    const preview = await planLarkSchema(common);
    printJson({ ...preview, target: { environment: runtime.environment, profileKey: runtime.profileKey }, nextCommand: preview.readyToApply ? 'CONFIRM_WRITE=YES npm run setup:meta-schema:apply' : null, note: 'Preview เท่านั้น ยังไม่สร้างหรือแก้ Meta/Facebook/Instagram tables ใน Lark DEV', warning: mode.ignoredAmbientConfirmation ? 'พบ CONFIRM_WRITE=YES แต่ Preview command ไม่เขียนข้อมูล' : null });
    return;
  }
  const result = await applyLarkSchema({ ...common, onProgress: (event) => { if (process.env.MKT_SCHEMA_VERBOSE === 'true') console.error(JSON.stringify(event)); } });
  printJson({ ...result, target: { environment: runtime.environment, profileKey: runtime.profileKey }, configNote: 'นำ environmentUpdates ไปใส่ใน local .dev.vars/wrangler.sync.jsonc เท่านั้น ห้าม Commit', safetyNote: 'Schema apply ไม่เขียนข้อมูลธุรกิจและไม่เปิด Meta connectors/schedules' });
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  return Object.freeze(normalized);
}
