import { METRIC_DEFINITION_ROWS } from '../../../config/src/metric-definitions.seed.js';

/**
 * Upsert Metric definition มาตรฐานไปยัง MKT_Metric_Definitions ด้วย Universal Sync Engine
 * ใช้ metric_key เป็น Stable Key จึงรันซ้ำได้โดยไม่สร้าง Record ซ้ำ
 */
export async function seedMetricDefinitions(input) {
  const repository = requireRepository(input?.repository);
  const syncEngine = requireSyncEngine(input?.syncEngine);
  const tableId = requireText(input?.tableId, 'tableId');
  const rows = input?.rows ?? METRIC_DEFINITION_ROWS;

  if (!Array.isArray(rows)) throw new TypeError('seedMetricDefinitions requires rows array');
  return syncEngine.syncByKey({ repository, tableId, keyField: 'metric_key', rows });
}

/** ตรวจ Repository contract ให้ตรงกับสิ่งที่ TableSyncEngine ใช้จริง */
function requireRepository(repository) {
  for (const method of ['prepareRows', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`seedMetricDefinitions requires repository.${method}`);
    }
  }
  if (typeof repository?.listByFieldValues !== 'function' && typeof repository?.listAll !== 'function') {
    throw new TypeError('seedMetricDefinitions requires repository.listByFieldValues or repository.listAll');
  }
  return repository;
}

/** ตรวจว่า Sync engine รองรับคำสั่ง Upsert แบบ Stable Key */
function requireSyncEngine(syncEngine) {
  if (typeof syncEngine?.syncByKey !== 'function') {
    throw new TypeError('seedMetricDefinitions requires syncEngine.syncByKey');
  }
  return syncEngine;
}

/** บังคับ Table ID เป็นข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`seedMetricDefinitions requires ${fieldName}`);
  }
  return value.trim();
}
