import { createReportSettingRowsForProfile } from '../../../config/src/report-settings.seed.js';
import {
  REPORT_SOURCE_STATUS,
  listReportPlatformContracts,
} from '../reports/report-platform-adapter-registry.js';

export const CUSTOMER_WEEKLY_NOTIFICATION_SETTINGS_ACTIVATION_VERSION =
  'customer_weekly_notification_settings_activation_v1';

const CUSTOMER_NOTIFICATION_PROFILE = 'chemistry_k';
const WEEKLY_WINDOW_DAYS = 7;

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

/**
 * เปิดเฉพาะ Settings 7D ของช่องทาง Report ที่ active สำหรับ Customer Notification runtime.
 * Destination ไม่ถูกส่งผ่าน Queue; Runtime จะ resolve กลุ่มจากชื่อ+SHA-256 ที่ review แล้ว.
 */
export async function seedCustomerWeeklyNotificationReportSettings(input) {
  const profileKey = requireText(input?.profileKey, 'profileKey');
  if (profileKey !== CUSTOMER_NOTIFICATION_PROFILE) {
    throw new TypeError('Customer Weekly Notification settings require chemistry_k profile');
  }
  return seedReportSettings({
    ...input,
    rows: buildCustomerWeeklyNotificationReportSettingRows(profileKey),
  });
}

export function buildCustomerWeeklyNotificationReportSettingRows(profileKey) {
  const normalizedProfile = requireText(profileKey, 'profileKey');
  if (normalizedProfile !== CUSTOMER_NOTIFICATION_PROFILE) {
    throw new TypeError('Customer Weekly Notification settings require chemistry_k profile');
  }
  const activePlatforms = new Set(listReportPlatformContracts()
    .filter((contract) => contract.sourceStatus === REPORT_SOURCE_STATUS.ACTIVE)
    .map((contract) => contract.platformScope));
  const rows = createReportSettingRowsForProfile(normalizedProfile)
    .filter((row) => row.report_type === 'dashboard_performance_report'
      && row.window_days === WEEKLY_WINDOW_DAYS
      && activePlatforms.has(row.platforms[0]))
    .map((row) => Object.freeze({
      ...row,
      ai_enabled: true,
      notification_enabled: true,
      group_id: null,
    }));
  if (rows.length !== activePlatforms.size) {
    throw new TypeError('Customer Weekly Notification settings do not match active Report platforms');
  }
  return Object.freeze(rows);
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
