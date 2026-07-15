import { createSystemAlert } from '../../domain/src/entities/system-alert.js';
import { sanitizeOperationalText } from '../../shared/src/errors/runtime-error.js';

const MAX_LARK_MESSAGE_LENGTH = 5_000;

/**
 * Mirror Sync run และ System alert ไปยัง Lark Base เพื่อให้ผู้ใช้ตรวจจาก UI ได้
 * D1 ยังคงเหมาะเป็น Operational source of truth เพราะเก็บรายละเอียดได้มากกว่า
 */
export class LarkReliabilityStore {
  constructor(input = {}) {
    this.syncEngine = requireSyncEngine(input.syncEngine);
    this.repository = requireRepository(input.repository);
    this.tables = Object.freeze({
      syncLog: requireText(input.tables?.syncLog, 'tables.syncLog'),
      systemAlerts: requireText(input.tables?.systemAlerts, 'tables.systemAlerts'),
    });
  }

  /** Upsert MKT_Sync_Log ด้วย sync_id โดยใช้ Field ที่มีจริงใน Dev Base ปัจจุบัน */
  async saveSyncRun(entry) {
    const row = {
      sync_id: requireText(entry?.syncId, 'entry.syncId'),
      platform: requireText(entry?.platform, 'entry.platform'),
      sync_type: mapSyncType(entry?.syncType),
      status: mapStatus(entry?.status),
      records_pulled: nonNegativeInteger(entry?.recordsPulled ?? 0, 'recordsPulled'),
      records_written: nonNegativeInteger(entry?.recordsWritten ?? 0, 'recordsWritten'),
      ...(entry?.errorMessage || entry?.errorCode
        ? { error_message: buildSyncErrorMessage(entry) }
        : {}),
    };

    return this.syncEngine.syncByKey({
      repository: this.repository,
      tableId: this.tables.syncLog,
      keyField: 'sync_id',
      rows: [row],
    });
  }

  /** Upsert MKT_System_Alerts ด้วย alert_id */
  async saveSystemAlert(value) {
    const alert = createSystemAlert(value);
    const row = {
      alert_id: alert.alertId,
      severity: alert.severity,
      platform: mapAlertPlatform(alert.platform),
      status: alert.status,
      alert_message: truncate(buildAlertMessage(alert), MAX_LARK_MESSAGE_LENGTH),
    };

    return this.syncEngine.syncByKey({
      repository: this.repository,
      tableId: this.tables.systemAlerts,
      keyField: 'alert_id',
      rows: [row],
    });
  }
}

/** Base ปัจจุบันมี Select ชุดจำกัด จึง map sync type เชิงเทคนิคเป็น native_import */
function mapSyncType(value) {
  const type = requireText(value, 'syncType');
  const supported = new Set(['organic_content', 'content_daily', 'ads_master', 'ads_daily', 'native_import', 'ai_report']);
  return supported.has(type) ? type : 'native_import';
}

function mapStatus(value) {
  const status = value === 'queued' ? 'pending' : requireText(value, 'status');
  const supported = new Set(['pending', 'running', 'success', 'failed', 'partial_success', 'skipped']);
  if (!supported.has(status)) throw new TypeError(`Unsupported Lark sync status: ${status}`);
  return status;
}

function mapAlertPlatform(value) {
  const platform = requireText(value, 'platform').toLowerCase();
  const supported = new Set([
    'facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'tiktok_ads', 'google_ads', 'lark', 'system',
  ]);
  return supported.has(platform) ? platform : 'system';
}

function buildSyncErrorMessage(entry) {
  const parts = [
    entry.errorCode ? `[${String(entry.errorCode).toUpperCase()}]` : null,
    entry.errorMessage
      ? sanitizeOperationalText(entry.errorMessage, { code: entry.errorCode })
      : null,
    entry.syncId ? `sync_run_id=${entry.syncId}` : null,
  ].filter(Boolean);
  return truncate(parts.join(' | '), MAX_LARK_MESSAGE_LENGTH);
}

function buildAlertMessage(alert) {
  const prefix = [
    alert.errorCode ? `[${alert.errorCode}]` : null,
    alert.syncRunId ? `sync_run_id=${alert.syncRunId}` : null,
    alert.alertType ? `type=${alert.alertType}` : null,
  ].filter(Boolean).join(' ');
  const message = sanitizeOperationalText(alert.message, { code: alert.errorCode });
  return prefix ? `${prefix}\n${message}` : message;
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function requireSyncEngine(value) {
  if (typeof value?.syncByKey !== 'function') {
    throw new TypeError('LarkReliabilityStore requires syncEngine.syncByKey');
  }
  return value;
}

function requireRepository(value) {
  if (!value || typeof value !== 'object') throw new TypeError('LarkReliabilityStore requires repository');
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`LarkReliabilityStore requires ${fieldName}`);
  }
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`LarkReliabilityStore ${fieldName} must be a non-negative integer`);
  }
  return number;
}
