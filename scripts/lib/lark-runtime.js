import { readDevVars } from './dev-vars.js';
import { createLarkBitableClientFromEnv } from '../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { readLarkTableIdsFromEnv } from '../../packages/config/src/lark-table-config.js';

export async function createLocalLarkRuntime(requiredTableKeys, options = {}) {
  const env = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const normalizedEnv = normalizeEnvAliases(env);
  const client = createLarkBitableClientFromEnv(normalizedEnv, { onRequest: options?.onRequest });
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();
  const tables = readLarkTableIdsFromEnv(normalizedEnv, requiredTableKeys);
  return Object.freeze({ env: normalizedEnv, client, repository, syncEngine, tables });
}

function normalizeEnvAliases(env) {
  const normalized = { ...env };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  return Object.freeze(normalized);
}

export function todayInBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function readMetricDate(env) {
  return process.env.METRIC_DATE ?? env.METRIC_DATE ?? todayInBangkok();
}

export function readAccountId(env) {
  const value = process.env.TIKTOK_CREATOR_ACCOUNT_ID ?? env.TIKTOK_CREATOR_ACCOUNT_ID;
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Missing TIKTOK_CREATOR_ACCOUNT_ID in .dev.vars or process env');
  return value.trim();
}

export function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}
