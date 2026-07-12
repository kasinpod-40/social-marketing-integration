import { createSyncLogEntry } from '../../domain/src/entities/sync-log.js';
import { createSystemAlert } from '../../domain/src/entities/system-alert.js';
import {
  isPartialSyncError,
  markReliabilityHandled,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_RENEW_ATTEMPTS = 3;

/**
 * ครอบ Use case Sync ด้วย Run ID, Persisted log, Lease lock, Renewal, Recovery metadata และ Alert
 */
export async function runReliableSync(input = {}) {
  const store = requireStore(input.store);
  const lockManager = requireLockManager(input.lockManager);
  const execute = requireFunction(input.execute, 'execute');
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const syncRunId = normalizeId(input.syncRunId);
  const lockKey = createSyncLockKey(input);
  const leaseMs = positiveInteger(input.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs');
  const renewIntervalMs = resolveRenewInterval(input.renewIntervalMs, leaseMs);
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

  const heartbeat = createLeaseHeartbeat({
    lockManager,
    lockKey,
    ownerId: syncRunId,
    leaseMs,
    renewIntervalMs,
    initialExpiresAt: lock.expiresAt,
    now,
    sleep: input.sleep,
    renewAttempts: input.renewAttempts,
    onReliabilityError: input.onReliabilityError,
  });

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
      details: { lockKey, leaseMs, renewIntervalMs },
    }));

    await heartbeat.assertActive();
    const result = await execute({
      syncRunId,
      lockKey,
      assertLockActive: heartbeat.assertActive,
      renewLease: heartbeat.renewNow,
    });
    await heartbeat.assertActive();

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
        incremental: result?.incremental ?? null,
        warningCount: Array.isArray(result?.warnings) ? result.warnings.length : 0,
        writeOutcomes: readWriteOutcomes(result),
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
        incremental: sourceResult?.incremental ?? null,
        writeOutcomes: readWriteOutcomes(sourceResult),
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
          writeOutcomes: readWriteOutcomes(sourceResult),
        },
      }));
    }

    throw markReliabilityHandled(error, syncRunId);
  } finally {
    await heartbeat.stop();
    try {
      const released = await lockManager.release({ lockKey, ownerId: syncRunId });
      if (released === false) {
        throw transientError(`Sync lock was not owned during release: ${lockKey}`, {
          code: 'SYNC_LOCK_RELEASE_NOT_OWNED',
          details: { lockKey },
        });
      }
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

/** รวม Count ที่ยืนยันได้จริง โดยค่า Unknown write จะอยู่ใน details ไม่ถูกเดาเป็นจำนวนสำเร็จ */
export function summarizeSyncResult(result) {
  const outputs = [
    result?.content,
    result?.dailySnapshots,
    result?.reportSnapshot,
    result?.reportMetricValues,
    result?.reportTopContent,
  ].filter((value) => value && typeof value === 'object');
  const recordsCreated = outputs.reduce((sum, output) => sum + count(output.created), 0);
  const recordsUpdated = outputs.reduce((sum, output) => sum + count(output.updated), 0);
  const recordsSkipped = outputs.reduce((sum, output) => sum + count(output.skipped), 0);

  return Object.freeze({
    recordsPulled: count(result?.rawRecords),
    recordsCreated,
    recordsUpdated,
    recordsSkipped,
    recordsWritten: recordsCreated + recordsUpdated,
  });
}

/** สร้าง Heartbeat ที่ต่ออายุ Lease และเปิด Guard ให้ Use case ตรวจ Ownership ก่อนทุก Chunk */
export function createLeaseHeartbeat(input = {}) {
  const lockManager = requireLockManager(input.lockManager);
  const lockKey = requireText(input.lockKey, 'lockKey');
  const ownerId = requireText(input.ownerId, 'ownerId');
  const leaseMs = positiveInteger(input.leaseMs, 'leaseMs');
  const intervalMs = resolveRenewInterval(input.renewIntervalMs, leaseMs);
  const renewAttempts = positiveInteger(input.renewAttempts ?? DEFAULT_RENEW_ATTEMPTS, 'renewAttempts');
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const sleep = typeof input.sleep === 'function' ? input.sleep : defaultSleep;
  let expiresAt = normalizeLeaseExpiry(input.initialExpiresAt, now() + leaseMs);
  let stopped = false;
  let timer = null;
  let inFlight = null;
  let terminalError = null;

  const setTerminalError = (error) => {
    if (!terminalError) terminalError = error;
    input.onReliabilityError?.({ stage: 'lock_heartbeat_failed', error: terminalError, lockKey });
  };

  const renewNow = async () => {
    if (stopped) return false;
    if (terminalError) throw terminalError;

    let lastError = null;
    for (let attempt = 1; attempt <= renewAttempts; attempt += 1) {
      try {
        const result = await lockManager.renew({ lockKey, ownerId, leaseMs });
        if (!result?.renewed) {
          const lost = transientError(`Sync lock ownership was lost: ${lockKey}`, {
            code: 'SYNC_LOCK_LOST',
            details: { lockKey, ownerId, attempt },
          });
          setTerminalError(lost);
          throw lost;
        }
        expiresAt = normalizeLeaseExpiry(result.expiresAt, now() + leaseMs);
        if (now() >= expiresAt) {
          const expired = transientError(`Renewed sync lock is already expired: ${lockKey}`, {
            code: 'SYNC_LOCK_LEASE_EXPIRED',
            details: { lockKey, ownerId, expiresAt },
          });
          setTerminalError(expired);
          throw expired;
        }
        return true;
      } catch (error) {
        lastError = error;
        if (new Set(['SYNC_LOCK_LOST', 'SYNC_LOCK_LEASE_EXPIRED']).has(error?.code)) throw error;
        if (attempt < renewAttempts) await sleep(Math.min(1_000, 200 * attempt));
      }
    }

    const failure = transientError(`Sync lock renewal failed: ${lockKey}`, {
      code: 'SYNC_LOCK_RENEW_FAILED',
      cause: lastError,
      details: {
        lockKey,
        ownerId,
        attempts: renewAttempts,
        causeCode: lastError?.code ?? null,
        causeMessage: lastError instanceof Error ? lastError.message : String(lastError),
      },
    });
    setTerminalError(failure);
    throw failure;
  };

  const assertActive = async () => {
    if (terminalError) throw terminalError;
    const checkedAt = now();
    if (checkedAt >= expiresAt) {
      const expired = transientError(`Sync lock lease expired: ${lockKey}`, {
        code: 'SYNC_LOCK_LEASE_EXPIRED',
        details: { lockKey, ownerId, expiresAt, checkedAt },
      });
      setTerminalError(expired);
      throw expired;
    }
    return true;
  };

  const schedule = () => {
    if (stopped || terminalError) return;
    timer = setTimeout(() => {
      inFlight = renewNow()
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
          schedule();
        });
    }, intervalMs);
    timer?.unref?.();
  };

  const stop = async () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    if (inFlight) await inFlight;
  };

  schedule();
  return Object.freeze({ assertActive, renewNow, stop, intervalMs });
}


function normalizeLeaseExpiry(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.trunc(number);
  return Math.trunc(fallback);
}

function readWriteOutcomes(result) {
  if (!result || typeof result !== 'object') return null;
  return Object.freeze({
    content: result.content?.writeOutcome ?? null,
    dailySnapshots: result.dailySnapshots?.writeOutcome ?? null,
    reportSnapshot: result.reportSnapshot?.writeOutcome ?? null,
    reportMetricValues: result.reportMetricValues?.writeOutcome ?? null,
    reportTopContent: result.reportTopContent?.writeOutcome ?? null,
  });
}

function buildAlertMessage(error, context) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    context.partial ? 'เกิด Partial/Unknown write และระบบจะ Reconcile ในรอบถัดไป' : 'รอบ Sync ล้มเหลว',
    `sync_run_id=${context.syncRunId}`,
    `lock_key=${context.lockKey}`,
    `error=${message}`,
  ].join('\n');
}

function resolveRenewInterval(value, leaseMs) {
  const fallback = Math.max(1_000, Math.floor(leaseMs / 3));
  const interval = value === null || value === undefined || value === ''
    ? fallback
    : positiveInteger(value, 'renewIntervalMs');
  if (interval >= leaseMs) {
    throw new TypeError('runReliableSync renewIntervalMs must be lower than leaseMs');
  }
  return interval;
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
  for (const method of ['acquire', 'renew', 'release']) {
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

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
