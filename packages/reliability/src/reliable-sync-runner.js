import { createSyncLogEntry } from '../../domain/src/entities/sync-log.js';
import { createSystemAlert } from '../../domain/src/entities/system-alert.js';
import {
  isPartialSyncError,
  markReliabilityHandled,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

const DEFAULT_LEASE_MS = 10 * 60 * 1000;

/**
 * ครอบ Use case Sync ด้วย Run ID, Persisted log, Lease lock, Recovery metadata และ Alert
 */
export async function runReliableSync(input = {}) {
  const store = requireStore(input.store);
  const lockManager = requireLockManager(input.lockManager);
  const execute = requireFunction(input.execute, 'execute');
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const syncRunId = normalizeId(input.syncRunId);
  const lockKey = createSyncLockKey(input);
  const leaseMs = positiveInteger(input.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs');
  const startedAt = now();

  const lock = await lockManager.acquire({ lockKey, ownerId: syncRunId, leaseMs });
  if (!lock?.acquired) {
    const busyError = transientError(`Sync lock is busy: ${lockKey}`, {
      code: 'SYNC_LOCK_BUSY',
      details: { lockKey, expiresAt: lock?.expiresAt ?? null },
    });
    await store.saveSyncRun(createSyncLogEntry({
      syncId: syncRunId,
      customerProfile: input.customerProfile,
      accountKey: input.accountKey,
      platform: input.platform,
      source: input.source,
      syncType: input.syncType,
      status: 'skipped',
      startedAt,
      finishedAt: now(),
      retryCount: input.retryCount ?? 0,
      errorCode: busyError.code,
      errorMessage: busyError.message,
      details: busyError.details,
    }));
    throw markReliabilityHandled(busyError, syncRunId);
  }

  let completedResult = null;
  let primaryError = null;

  try {
    await store.saveSyncRun(createSyncLogEntry({
      syncId: syncRunId,
      customerProfile: input.customerProfile,
      accountKey: input.accountKey,
      platform: input.platform,
      source: input.source,
      syncType: input.syncType,
      status: 'running',
      startedAt,
      retryCount: input.retryCount ?? 0,
    }));

    const result = await execute({ syncRunId, lockKey });
    const counts = summarizeSyncResult(result);
    const finishedAt = now();

    await store.saveSyncRun(createSyncLogEntry({
      syncId: syncRunId,
      customerProfile: input.customerProfile,
      accountKey: input.accountKey,
      platform: input.platform,
      source: input.source ?? result?.source,
      syncType: input.syncType,
      status: 'success',
      startedAt,
      finishedAt,
      retryCount: input.retryCount ?? 0,
      ...counts,
      details: {
        reconciliation: result?.reconciliation ?? null,
        warningCount: Array.isArray(result?.warnings) ? result.warnings.length : 0,
      },
    }));

    completedResult = Object.freeze({ ...result, syncRunId });
    return completedResult;
  } catch (error) {
    primaryError = error;
    const partial = isPartialSyncError(error);
    const sourceResult = partial ? error.partialResult : null;
    const counts = summarizeSyncResult(sourceResult);
    const finishedAt = now();

    await store.saveSyncRun(createSyncLogEntry({
      syncId: syncRunId,
      customerProfile: input.customerProfile,
      accountKey: input.accountKey,
      platform: input.platform,
      source: input.source ?? sourceResult?.source,
      syncType: input.syncType,
      status: partial ? 'partial_success' : 'failed',
      startedAt,
      finishedAt,
      retryCount: input.retryCount ?? 0,
      ...counts,
      errorCode: error?.code ?? 'UNHANDLED_SYNC_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
      details: {
        retryable: error?.retryable === true,
        reconciliation: sourceResult?.reconciliation ?? null,
        errorDetails: error?.details ?? {},
      },
    }));

    const shouldAlert = partial || error?.retryable !== true || input.alertOnRetryableFailure === true;
    if (shouldAlert) {
      await store.saveSystemAlert(createSystemAlert({
        syncRunId,
        alertType: partial ? 'sync_partial_write' : 'sync_failed',
        severity: partial ? 'critical' : (error?.retryable === true ? 'warning' : 'critical'),
        platform: input.platform,
        status: 'open',
        errorCode: error?.code ?? 'UNHANDLED_SYNC_ERROR',
        message: buildAlertMessage(error, { syncRunId, lockKey, partial }),
        createdAt: finishedAt,
        details: {
          customerProfile: input.customerProfile ?? null,
          accountKey: input.accountKey ?? null,
          retryable: error?.retryable === true,
          partial,
        },
      }));
    }

    throw markReliabilityHandled(error, syncRunId);
  } finally {
    try {
      await lockManager.release({ lockKey, ownerId: syncRunId });
    } catch (releaseError) {
      const alert = createSystemAlert({
        syncRunId,
        alertType: 'sync_lock_release_failed',
        severity: 'critical',
        platform: input.platform,
        errorCode: releaseError?.code ?? 'SYNC_LOCK_RELEASE_FAILED',
        message: `ปล่อย Lock ไม่สำเร็จ: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        details: { lockKey, operationCompleted: completedResult !== null, primaryError: primaryError?.message ?? null },
      });
      try {
        await store.saveSystemAlert(alert);
      } catch (alertError) {
        input.onReliabilityError?.({ stage: 'lock_release_alert_failed', error: alertError, releaseError });
      }
      input.onReliabilityError?.({ stage: 'lock_release_failed', error: releaseError });
    }
  }
}

/** สร้าง Lock key ที่แยก Customer, Platform, Account และ Sync type ชัดเจน */
export function createSyncLockKey(input = {}) {
  return [
    requireText(input.customerProfile, 'customerProfile'),
    requireText(input.platform, 'platform').toLowerCase(),
    requireText(input.accountKey, 'accountKey'),
    requireText(input.syncType, 'syncType'),
  ].map(escapePart).join(':');
}

/** รวม Count จากผล Sync หลายตารางโดยไม่เดาค่าที่ไม่มี */
export function summarizeSyncResult(result) {
  const content = result?.content ?? {};
  const daily = result?.dailySnapshots ?? {};
  const recordsCreated = count(content.created) + count(daily.created);
  const recordsUpdated = count(content.updated) + count(daily.updated);
  const recordsSkipped = count(content.skipped) + count(daily.skipped);

  return Object.freeze({
    recordsPulled: count(result?.rawRecords),
    recordsCreated,
    recordsUpdated,
    recordsSkipped,
    recordsWritten: recordsCreated + recordsUpdated,
  });
}

function buildAlertMessage(error, context) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    context.partial ? 'เกิด Partial write และระบบจะ Reconcile ในรอบถัดไป' : 'รอบ Sync ล้มเหลว',
    `sync_run_id=${context.syncRunId}`,
    `lock_key=${context.lockKey}`,
    `error=${message}`,
  ].join('\n');
}

function escapePart(value) {
  return encodeURIComponent(value).replaceAll('%', '_');
}

function count(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function normalizeId(value) {
  if (value === null || value === undefined || value === '') return crypto.randomUUID();
  return requireText(value, 'syncRunId');
}

function requireStore(value) {
  for (const method of ['saveSyncRun', 'saveSystemAlert']) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`runReliableSync requires store.${method}`);
  }
  return value;
}

function requireLockManager(value) {
  for (const method of ['acquire', 'release']) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`runReliableSync requires lockManager.${method}`);
  }
  return value;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`runReliableSync requires ${fieldName}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`runReliableSync requires ${fieldName}`);
  }
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`runReliableSync ${fieldName} must be a positive integer`);
  }
  return number;
}
