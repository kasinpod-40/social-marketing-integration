import { readFile } from 'node:fs/promises';
import { readDevVars } from './lib/dev-vars.js';
import { printJson } from './lib/lark-runtime.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { assertSharedTableSchemaDevTarget } from '../packages/config/src/shared-table-schema-runtime-config.js';
import {
  SHARED_TABLE_LARK_SCHEMA_VERSION,
  validateSharedTableLarkSchema,
} from '../packages/config/src/shared-table-lark-schema.js';
import { previewSharedTableLarkSchema } from '../packages/application/src/use-cases/preview-shared-table-lark-schema.js';
import { permanentError } from '../packages/shared/src/errors/runtime-error.js';
import { createLarkBaseExportReadOnlyClient } from '../packages/shared/src/lark/lark-base-export.js';
import { loadSharedTableSchemaContract } from './lib/shared-table-schema-contract.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'SHARED_TABLE_SCHEMA_PREVIEW_FAILED',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  if (process.argv.includes('--apply') || process.env.CONFIRM_WRITE === 'YES') {
    throw permanentError('Shared-table Preview command is read-only; use the separately guarded setup:shared-table-schema:apply command only after explicit authorization', {
      code: 'SHARED_TABLE_SCHEMA_APPLY_NOT_AUTHORIZED',
    });
  }
  const baseExportPath = readFlagValue(process.argv.slice(2), '--base-export');
  const { schema, views } = await loadSharedTableSchemaContract();

  if (baseExportPath) {
    const exportText = await readFile(baseExportPath, 'utf8');
    const client = createLarkBaseExportReadOnlyClient(exportText);
    const result = await previewSharedTableLarkSchema({
      client,
      env: {},
      schema,
      views,
      schemaVersion: SHARED_TABLE_LARK_SCHEMA_VERSION,
      validateSchema: validateSharedTableLarkSchema,
    });
    printResult(result, { mode: 'offline_base_export', path: baseExportPath });
    return;
  }

  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const fileEnv = await readDevVars(devVarsFile);
  const env = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const runtime = assertSharedTableSchemaDevTarget(env, {
    operation: 'preview',
    errorCode: 'SHARED_TABLE_PREVIEW_DEV_TARGET_REQUIRED',
  });
  const client = createLarkBitableClientFromEnv(env, {
    onRequest: process.env.MKT_SCHEMA_VERBOSE === 'true'
      ? (event) => console.error(JSON.stringify(event))
      : undefined,
  });
  const result = await previewSharedTableLarkSchema({
    client,
    env,
    schema,
    views,
    schemaVersion: SHARED_TABLE_LARK_SCHEMA_VERSION,
    validateSchema: validateSharedTableLarkSchema,
  });
  printResult(result, { mode: 'live_lark_dev', environment: runtime.environment, profileKey: runtime.profileKey });
}

function printResult(result, target) {
  printJson({
    ok: true,
    ...result,
    target,
    note: 'Read-only Preview เท่านั้น: ไม่ Rename/Create/Update Table, Field, View หรือ Record',
    nextGate: result.readyForApplyAuthorization
      ? 'Review exact actions and request separate explicit authorization before implementing or running Apply'
      : 'Resolve every conflict and rerun Preview',
  });
}

function readFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new TypeError(`${flag} requires a file path`);
  return value;
}

function normalizeEnvAliases(source) {
  const normalized = { ...source };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}
