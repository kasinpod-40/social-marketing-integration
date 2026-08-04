import { assertReportRuntimeFinalizerEvidence } from './report-runtime-closeout-operator.js';

const DECISIONS = Object.freeze({
  fresh: 'REPORT_WINDOW_CREATED',
  refresh: 'REPORT_WINDOW_REFRESHED',
});

/**
 * ยอมใช้ Finalizer evidence ซ้ำเฉพาะเมื่อเป็นหลักฐาน Safe-closed ที่ Head เดียวกันเท่านั้น.
 * Head อื่นต้องรัน Finalizer ใหม่ เพื่อไม่รับรองโค้ดที่ยังไม่ผ่าน Repository gates ชุดเดียวกัน.
 */
export function validateReusableReportFinalizerEvidence(value = {}, expectedHead) {
  assertReportRuntimeFinalizerEvidence(value);
  const head = requireText(expectedHead, 'expectedHead');
  if (value.repository?.head !== head) {
    throw resumeError(
      'Report finalizer evidence belongs to a different repository Head',
      'REPORT_RUNTIME_WINDOW_REPAIR_FINALIZER_HEAD_STALE',
      { evidenceHead: value.repository?.head ?? null, expectedHead: head },
    );
  }

  const migration = value.schema?.metricFieldMigration;
  if (migration && (
    Number(migration.pendingMigrationCount ?? -1) !== 0
    || Number(migration.legacyValueMutationCount ?? -1) !== 0
    || Number(migration.deleteCount ?? -1) !== 0
  )) {
    throw resumeError(
      'Report finalizer evidence contains an incomplete or destructive Metric field migration',
      'REPORT_RUNTIME_WINDOW_REPAIR_FINALIZER_MIGRATION_INVALID',
    );
  }

  return Object.freeze({
    reusable: true,
    repositoryHead: head,
    schemaVersion: value.schema?.version ?? null,
    canonicalSettingsActive: Number(value.settings?.canonicalActive ?? 0),
    notificationRuntimeState: value.settings?.notificationRuntimeState ?? null,
    preservedNotificationRuntimeSettingCount: Number(
      value.settings?.preservedNotificationRuntimeSettingCount ?? 0,
    ),
  });
}

/**
 * ตรวจ Summary ของ Window ที่จบแล้วก่อนข้ามการ Deploy/Queue ซ้ำ.
 * Summary ต้องพิสูจน์ D1 row เดียว, replay เดิม และคืน Worker baseline เดิมแล้วเท่านั้น.
 */
export function summarizeReusableReportWindow(value = {}, expected = {}) {
  const operation = requireOperation(expected.operation);
  const windowDays = requireWindowDays(expected.windowDays);
  const decision = DECISIONS[operation];
  const baseline = readRestoredBaseline(value.runtime ?? {});
  if (value.ok !== true
    || value.decision !== decision
    || value.target?.operation !== operation
    || Number(value.target?.windowDays) !== windowDays
    || Number(value.materialization?.d1MaterializationCount ?? -1) !== 1
    || Number(value.replay?.d1MaterializationCount ?? -1) !== 1
    || value.replay?.sameReportId !== true
    || value.replay?.samePayloadChecksum !== true
    || value.replay?.larkRowsUnchanged !== true
    || value.replay?.integrityUnchanged !== true
    || baseline.valid !== true
    || value.runtime?.connectorFlagsEnabled !== false
    || value.runtime?.aiSummaryEnabled !== false
    || value.runtime?.dailyScheduleEnabled !== false
    || value.runtime?.weeklyScheduleEnabled !== false
    || value.runtime?.production !== false) {
    throw resumeError(
      `Existing Report ${windowDays}D ${operation} evidence is incomplete`,
      'REPORT_RUNTIME_WINDOW_REPAIR_WINDOW_EVIDENCE_INVALID',
      {
        operation,
        windowDays,
        decision: value.decision ?? null,
        restoredBaseline: baseline.valid,
        notificationRuntimeState: baseline.state,
      },
    );
  }

  return Object.freeze({
    windowDays,
    operation,
    decision,
    reportId: value.target?.reportId ?? null,
    dataStatus: value.materialization?.dataStatus ?? null,
    integrity: value.materialization?.integrity ?? null,
    restoredBaseline: true,
    restoredAllFalse: baseline.state === 'inactive',
    notificationRuntimeState: baseline.state,
    baselineTrueFlagCount: baseline.trueFlagCount,
    finalWorkerVersion: value.runtime?.finalWorkerVersion ?? null,
    reused: true,
  });
}

/**
 * หาก Window ไม่มี Summary แต่มี Attempt/Backup/Evidence ใดแล้ว ห้ามรันซ้ำอัตโนมัติ.
 * ผู้ดำเนินการต้องตรวจ partial remote mutation ก่อนเสมอ.
 */
export function assertReportWindowDirectorySafeToStart(entries = [], expected = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Report window evidence entries must be an array');
  const meaningful = entries
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry) => entry && entry !== '.DS_Store')
    .sort();
  if (meaningful.length !== 0) {
    throw resumeError(
      'Report window has partial evidence without a verified closeout summary',
      'REPORT_RUNTIME_WINDOW_REPAIR_PARTIAL_WINDOW_BLOCKED',
      {
        operation: expected.operation ?? null,
        windowDays: expected.windowDays ?? null,
        evidenceEntryCount: meaningful.length,
        evidenceEntries: meaningful,
      },
    );
  }
  return true;
}

function readRestoredBaseline(runtime) {
  const legacyInactive = runtime.restoredAllFalse === true
    && runtime.restoredBaseline !== false;
  const restored = runtime.restoredBaseline === true || legacyInactive;
  const state = runtime.notificationRuntimeState
    ?? (legacyInactive ? 'inactive' : null);
  const trueFlagCount = runtime.baselineTrueFlagCount === undefined
    ? (state === 'inactive' ? 0 : Number.NaN)
    : Number(runtime.baselineTrueFlagCount);
  const expectedCount = state === 'active' ? 3 : state === 'inactive' ? 0 : -1;
  return Object.freeze({
    valid: restored
      && expectedCount >= 0
      && Number.isSafeInteger(trueFlagCount)
      && trueFlagCount === expectedCount,
    state,
    trueFlagCount: Number.isSafeInteger(trueFlagCount) ? trueFlagCount : null,
  });
}

function requireOperation(value) {
  const operation = String(value ?? '').trim().toLowerCase();
  if (!Object.hasOwn(DECISIONS, operation)) {
    throw new TypeError('Report window operation must be fresh or refresh');
  }
  return operation;
}

function requireWindowDays(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('Report window days must be a positive integer');
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report window resume requires ${fieldName}`);
  }
  return value.trim();
}

function resumeError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeWindowRepairResumeError';
  error.code = code;
  error.details = details;
  return error;
}
