import { readDevVars } from './dev-vars.js';
import { createLarkBitableClientFromEnv } from '../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { readLarkTableIdsFromEnv } from '../../packages/config/src/lark-table-config.js';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { todayInTimeZone } from '../../packages/shared/src/date/date-only.js';
import { DEFAULT_REPORT_TIMEZONE, resolveMetricDate } from '../../packages/config/src/metric-date-config.js';

/**
 * สร้าง Runtime สำหรับ Script บนเครื่องผู้พัฒนา
 *
 * ลำดับ Priority ของ Environment:
 * 1. Shell environment ตอนรันคำสั่ง
 * 2. ค่าใน .dev.vars
 *
 * Shell จึงสามารถ Override ค่าเฉพาะรอบได้โดยไม่แก้ไฟล์ Secret
 */
export async function createLocalLarkRuntime(requiredTableKeys, options = {}) {
  const devVarsFile = process.env.DEV_VARS_FILE ?? '.dev.vars';
  const fileEnv = await readDevVars(devVarsFile);
  const normalizedEnv = normalizeEnvAliases({ ...fileEnv, ...process.env });
  const runtimeConfig = loadCustomerRuntimeConfig(normalizedEnv);
  const tables = readLarkTableIdsFromEnv(normalizedEnv, requiredTableKeys);
  const client = createLarkBitableClientFromEnv(normalizedEnv, {
    onRequest: options?.onRequest,
  });
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();

  return Object.freeze({
    env: normalizedEnv,
    runtimeConfig,
    client,
    repository,
    syncEngine,
    tables,
  });
}

/**
 * รองรับชื่อ LARK_BASE_APP_TOKEN เดิมชั่วคราว แต่ Runtime ภายในใช้ LARK_APP_TOKEN ชื่อเดียว
 */
function normalizeEnvAliases(env) {
  const normalized = { ...env };
  if (!normalized.LARK_APP_TOKEN && normalized.LARK_BASE_APP_TOKEN) {
    normalized.LARK_APP_TOKEN = normalized.LARK_BASE_APP_TOKEN;
  }
  return Object.freeze(normalized);
}

/** คืนวันที่ปัจจุบันของกรุงเทพฯ ใช้เป็น Snapshot date เริ่มต้น */
export function todayInBangkok(now = new Date()) {
  return todayInTimeZone(DEFAULT_REPORT_TIMEZONE, now);
}

/**
 * อ่าน Metric date จาก Runtime env ที่รวม Shell + .dev.vars แล้ว
 * ห้ามอ่าน process.env ซ้ำที่นี่ เพราะจะทำให้ Test และ Override order ไม่ชัดเจน
 */
export function readMetricDate(env) {
  return resolveMetricDate({ env });
}

/** ดึง TikTok config จาก Customer profile และตรวจค่าที่จำเป็น */
export function readTikTokRuntime(runtimeConfig) {
  if (!runtimeConfig?.tiktok?.accountKey || !runtimeConfig?.tiktok?.sourceHandle) {
    throw new Error('Runtime customer profile is missing TikTok accountKey/sourceHandle');
  }
  return runtimeConfig.tiktok;
}

/** พิมพ์ JSON แบบอ่านง่ายสำหรับผล Validate/Sync ใน Terminal */
export function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}
