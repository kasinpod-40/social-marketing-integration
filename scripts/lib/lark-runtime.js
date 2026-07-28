import { readDevVars } from './dev-vars.js';
import { createLarkBitableClientFromEnv } from '../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { readLarkTableIdsFromEnv } from '../../packages/config/src/lark-table-config.js';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { listConnectorCatalog } from '../../packages/config/src/connector-catalog.js';
import { todayInTimeZone } from '../../packages/shared/src/date/date-only.js';
import { DEFAULT_REPORT_TIMEZONE, resolveMetricDate } from '../../packages/config/src/metric-date-config.js';
import { assertConnectorRunnable } from '../../packages/application/src/connectors/connector-registry.js';
import { createOrganicContentOwnershipRoutingRepository } from '../../packages/application/src/policies/organic-content-field-ownership.js';

const LOCAL_LARK_RUNTIME_CONFIG_SCOPE = Object.freeze({
  FULL: 'full',
  ADMINISTRATIVE: 'administrative',
});

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
  const normalizedEnv = normalizeEnvAliases({
    ...fileEnv,
    ...(options?.env ?? {}),
    ...process.env,
  });
  const runtimeConfigEnv = resolveRuntimeConfigEnv(
    normalizedEnv,
    options?.runtimeConfigScope ?? LOCAL_LARK_RUNTIME_CONFIG_SCOPE.FULL,
  );
  const runtimeConfig = loadCustomerRuntimeConfig(runtimeConfigEnv);
  const tables = readLarkTableIdsFromEnv(normalizedEnv, requiredTableKeys);
  const client = createLarkBitableClientFromEnv(normalizedEnv, {
    onRequest: options?.onRequest,
  });
  const baseRepository = new LarkRecordRepository({ client });
  const repository = createOrganicContentOwnershipRoutingRepository({
    repository: baseRepository,
    mktContentTableId: normalizedEnv.LARK_TABLE_MKT_CONTENT,
  });
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
 * งาน Lark เชิงบริหาร เช่น Schema/Settings ต้องตรวจ Environment/Profile แต่ไม่ควรรับ
 * Connector feature flags หรือ Source identity override จาก Shell/.dev.vars เข้ามาเป็น dependency.
 * Guard ของ Connector Runtime ปกติยังคงทำงานเหมือนเดิมใน scope `full`.
 */
export function buildAdministrativeLarkRuntimeConfigEnv(env = {}) {
  const administrativeEnv = { ...env };
  for (const definition of listConnectorCatalog()) {
    administrativeEnv[definition.featureFlagEnv] = 'false';
    if (definition.sourceHandleEnv) delete administrativeEnv[definition.sourceHandleEnv];
  }
  return Object.freeze(administrativeEnv);
}

function resolveRuntimeConfigEnv(env, scope) {
  if (scope === LOCAL_LARK_RUNTIME_CONFIG_SCOPE.FULL) return env;
  if (scope === LOCAL_LARK_RUNTIME_CONFIG_SCOPE.ADMINISTRATIVE) {
    return buildAdministrativeLarkRuntimeConfigEnv(env);
  }
  throw new Error(`Unsupported Local Lark runtime config scope: ${scope}`);
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

/**
 * ดึง TikTok config ผ่าน Connector registry
 * เพื่อให้ Local script ใช้ Feature flag และ Readiness guard ชุดเดียวกับ Cloudflare Worker
 */
export function readTikTokRuntime(runtimeConfig) {
  return assertConnectorRunnable(runtimeConfig, 'tiktok');
}

/** พิมพ์ JSON แบบอ่านง่ายสำหรับผล Validate/Sync ใน Terminal */
export function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}
