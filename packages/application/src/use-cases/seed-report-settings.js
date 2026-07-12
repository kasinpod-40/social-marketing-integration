import { createReportSettingRowsForProfile } from '../../../config/src/report-settings.seed.js';

/**
 * Upsert Report settings มาตรฐานของ Customer profile ไปยัง MKT_Report_Settings
 * ใช้ report_setting_key เป็น Stable key เพื่อให้ Seed ซ้ำได้โดยไม่สร้างแถวใหม่
 */
export async function seedReportSettings(input) {
  const repository = requireRepository(input?.repository);
  const syncEngine = requireSyncEngine(input?.syncEngine);
  const tableId = requireText(input?.tableId, 'tableId');
  const rows = input?.rows ?? createReportSettingRowsForProfile(input?.profileKey);

  if (!Array.isArray(rows)) throw new TypeError('seedReportSettings requires rows array');
  return syncEngine.syncByKey({
    repository,
    tableId,
    keyField: 'report_setting_key',
    rows,
    beforeWrite: input?.beforeWrite,
  });
}

function requireRepository(repository) {
  for (const method of ['prepareRows', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`seedReportSettings requires repository.${method}`);
    }
  }
  if (typeof repository?.listByFieldValues !== 'function' && typeof repository?.listAll !== 'function') {
    throw new TypeError('seedReportSettings requires repository.listByFieldValues or repository.listAll');
  }
  return repository;
}

function requireSyncEngine(syncEngine) {
  if (typeof syncEngine?.syncByKey !== 'function') {
    throw new TypeError('seedReportSettings requires syncEngine.syncByKey');
  }
  return syncEngine;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`seedReportSettings requires ${fieldName}`);
  }
  return value.trim();
}
