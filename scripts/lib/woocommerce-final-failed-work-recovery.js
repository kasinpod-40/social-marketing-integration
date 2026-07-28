import { createHash } from 'node:crypto';

const WORK_KEY = /^woocommerce:woo-final-(?:full|incremental)-[0-9a-f]{12}$/u;
const RETENTION_MS = 7 * 86_400_000;
const MAX_RECOVERABLE_WORK = 20;

export const WOOCOMMERCE_FINAL_FAILED_WORK_REASON =
  'woocommerce_final_failed_sync_recovery';

/**
 * อ่านเฉพาะ durable work ของ Final WooCommerce operation ที่ Sync Run จบเป็น failed
 * และไม่มี active lock จึงปลอดภัยต่อการเปลี่ยน lifecycle เป็น terminal.
 */
export function buildWooCommerceFailedWorkDiscoverySql() {
  return compactSql(`
    SELECT
      wr.work_key,
      wr.lifecycle_status,
      wr.work_type,
      wr.generation,
      wr.requested_at,
      sr.status AS sync_run_status,
      sr.error_code AS sync_run_error_code,
      (
        SELECT COUNT(*)
        FROM sync_locks sl
        WHERE sl.owner_id = wr.work_key
          AND sl.expires_at > unixepoch('now') * 1000
      ) AS active_lock_count
    FROM sync_work_runs wr
    JOIN sync_runs sr ON sr.sync_run_id = wr.work_key
    WHERE wr.lifecycle_status = 'active'
      AND wr.work_key LIKE 'woocommerce:woo-final-%'
      AND sr.status = 'failed'
      AND NOT EXISTS (
        SELECT 1
        FROM sync_locks sl
        WHERE sl.owner_id = wr.work_key
          AND sl.expires_at > unixepoch('now') * 1000
      )
    ORDER BY wr.updated_at ASC, wr.work_key ASC
    LIMIT ${MAX_RECOVERABLE_WORK + 1};
  `);
}

export function normalizeWooCommerceFailedWorkRows(rowsInput) {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  if (rows.length > MAX_RECOVERABLE_WORK) {
    throw recoveryError(
      'Too many failed WooCommerce work rows require manual review',
      'WOOCOMMERCE_FINAL_FAILED_WORK_RECOVERY_BOUND_EXCEEDED',
      { observed: rows.length, maximum: MAX_RECOVERABLE_WORK },
    );
  }

  const seen = new Set();
  return Object.freeze(rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw recoveryError(
        'WooCommerce failed-work row is invalid',
        'WOOCOMMERCE_FINAL_FAILED_WORK_ROW_INVALID',
      );
    }
    const workKey = requireWorkKey(row.work_key);
    if (seen.has(workKey)) {
      throw recoveryError(
        'WooCommerce failed-work discovery returned a duplicate work key',
        'WOOCOMMERCE_FINAL_FAILED_WORK_ROW_DUPLICATE',
        { workKeyFingerprint: sha256(workKey) },
      );
    }
    seen.add(workKey);
    if (row.lifecycle_status !== 'active' || row.sync_run_status !== 'failed') {
      throw recoveryError(
        'WooCommerce failed-work row is not recoverable',
        'WOOCOMMERCE_FINAL_FAILED_WORK_ROW_INVALID',
        {
          workKeyFingerprint: sha256(workKey),
          lifecycleStatus: row.lifecycle_status ?? null,
          syncRunStatus: row.sync_run_status ?? null,
        },
      );
    }
    const activeLockCount = count(row.active_lock_count, 'active_lock_count');
    if (activeLockCount !== 0) {
      throw recoveryError(
        'WooCommerce failed work still has an active lock',
        'WOOCOMMERCE_FINAL_FAILED_WORK_LOCKED',
        { workKeyFingerprint: sha256(workKey), activeLockCount },
      );
    }
    return Object.freeze({
      workKey,
      workKeyFingerprint: sha256(workKey),
      syncRunErrorCode: optionalText(row.sync_run_error_code),
      generation: safeInteger(row.generation, 'generation'),
      requestedAt: safeInteger(row.requested_at, 'requested_at'),
    });
  }));
}

/** Guarded equivalent of D1ResumableWorkStore.abandonWork for one exact failed operation. */
export function buildWooCommerceFailedWorkRecoverySql(input = {}) {
  const workKey = requireWorkKey(input.workKey);
  const auditReference = requireAuditReference(input.auditReference);
  const now = "unixepoch('now') * 1000";
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status = 'terminal',
        terminal_reason = COALESCE(terminal_reason, '${sqlText(WOOCOMMERCE_FINAL_FAILED_WORK_REASON)}'),
        abandoned_at = COALESCE(abandoned_at, ${now}),
        expires_at = COALESCE(expires_at, ${now} + ${RETENTION_MS}),
        audit_reference = COALESCE(audit_reference, '${sqlText(auditReference)}'),
        updated_at = ${now}
    WHERE work_key = '${sqlText(workKey)}'
      AND lifecycle_status = 'active'
      AND EXISTS (
        SELECT 1
        FROM sync_runs sr
        WHERE sr.sync_run_id = sync_work_runs.work_key
          AND sr.status = 'failed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM sync_locks sl
        WHERE sl.owner_id = sync_work_runs.work_key
          AND sl.expires_at > ${now}
      );
    SELECT
      changes() AS recovered_rows,
      work_key,
      lifecycle_status,
      terminal_reason,
      audit_reference
    FROM sync_work_runs
    WHERE work_key = '${sqlText(workKey)}';
  `);
}

export function verifyWooCommerceFailedWorkRecovery(input = {}) {
  const expectedWorkKey = requireWorkKey(input.expectedWorkKey);
  const row = input.row;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw recoveryError(
      'WooCommerce failed-work recovery verification returned no row',
      'WOOCOMMERCE_FINAL_FAILED_WORK_RECOVERY_VERIFY_FAILED',
    );
  }
  const workKey = requireWorkKey(row.work_key);
  if (workKey !== expectedWorkKey
    || row.lifecycle_status !== 'terminal'
    || row.terminal_reason !== WOOCOMMERCE_FINAL_FAILED_WORK_REASON
    || count(row.recovered_rows, 'recovered_rows') !== 1) {
    throw recoveryError(
      'WooCommerce failed-work recovery did not update exactly one guarded row',
      'WOOCOMMERCE_FINAL_FAILED_WORK_RECOVERY_VERIFY_FAILED',
      {
        expectedWorkKeyFingerprint: sha256(expectedWorkKey),
        observedWorkKeyFingerprint: sha256(workKey),
        lifecycleStatus: row.lifecycle_status ?? null,
        terminalReason: row.terminal_reason ?? null,
        recoveredRows: row.recovered_rows ?? null,
      },
    );
  }
  return Object.freeze({
    recovered: true,
    workKeyFingerprint: sha256(workKey),
    auditReferenceFingerprint: sha256(String(row.audit_reference ?? '')),
  });
}

export function buildWooCommerceActiveWorkVerificationSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work_count,
      (
        SELECT COUNT(*)
        FROM sync_locks
        WHERE expires_at > unixepoch('now') * 1000
      ) AS active_lock_count;
  `);
}

export function verifyWooCommerceActiveWorkCleared(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw recoveryError(
      'WooCommerce active-work verification returned no row',
      'WOOCOMMERCE_FINAL_ACTIVE_WORK_VERIFY_FAILED',
    );
  }
  const activeWorkCount = count(row.active_work_count, 'active_work_count');
  const activeLockCount = count(row.active_lock_count, 'active_lock_count');
  if (activeWorkCount !== 0 || activeLockCount !== 0) {
    throw recoveryError(
      'Active work or lock still blocks WooCommerce final rollout',
      'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED',
      { activeWorkCount, activeLockCount },
    );
  }
  return Object.freeze({ activeWorkCount, activeLockCount });
}

export function parseWranglerD1Rows(output) {
  let payload;
  try {
    payload = JSON.parse(String(output ?? ''));
  } catch {
    throw recoveryError(
      'Wrangler D1 output is not valid JSON',
      'WOOCOMMERCE_FINAL_FAILED_WORK_D1_OUTPUT_INVALID',
    );
  }
  const entries = Array.isArray(payload) ? payload : [payload];
  const rows = [];
  for (const entry of entries) {
    if (entry?.success === false) {
      throw recoveryError(
        'Wrangler D1 command reported failure',
        'WOOCOMMERCE_FINAL_FAILED_WORK_D1_COMMAND_FAILED',
      );
    }
    if (Array.isArray(entry?.results)) rows.push(...entry.results);
  }
  return Object.freeze(rows);
}

function requireWorkKey(value) {
  const text = requireText(value, 'workKey');
  if (!WORK_KEY.test(text)) {
    throw recoveryError(
      'WooCommerce failed-work key is outside the final rollout scope',
      'WOOCOMMERCE_FINAL_FAILED_WORK_KEY_INVALID',
      { workKeyFingerprint: sha256(text) },
    );
  }
  return text;
}

function requireAuditReference(value) {
  const text = requireText(value, 'auditReference');
  if (!/^woocommerce-final-recovery:[0-9a-f]{40,64}$/u.test(text)) {
    throw recoveryError(
      'WooCommerce failed-work audit reference is invalid',
      'WOOCOMMERCE_FINAL_FAILED_WORK_AUDIT_INVALID',
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `${fieldName} is required`,
      'WOOCOMMERCE_FINAL_FAILED_WORK_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function safeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      `${fieldName} is invalid`,
      'WOOCOMMERCE_FINAL_FAILED_WORK_ROW_INVALID',
      { fieldName },
    );
  }
  return number;
}

function count(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      `${fieldName} is invalid`,
      'WOOCOMMERCE_FINAL_FAILED_WORK_ROW_INVALID',
      { fieldName },
    );
  }
  return number;
}

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function recoveryError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalFailedWorkRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
