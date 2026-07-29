import { createHash } from 'node:crypto';
import {
  buildWooCommerceFinalSnapshotSql,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';
import { WOOCOMMERCE_FINAL_FAILED_WORK_REASON } from './woocommerce-final-failed-work-recovery.js';

export const WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID =
  'woo-final-full-e2372e56d52d';
export const WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY =
  `woocommerce:${WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID}`;
export const WOOCOMMERCE_FINAL_EXACT_RESUME_ACCIDENT_AUDIT =
  'woocommerce-final-recovery:b10458e3873a16481264fa4889a88620b9669c3d';
export const WOOCOMMERCE_FINAL_EXACT_RESUME_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_EXACT_RESUME_REACTIVATION',
  value: 'REACTIVATE_WOO_FINAL_FULL_E2372E56D52D_ONLY',
});

const EXPECTED_COUNTS = Object.freeze({
  raw_commerce_stores: 1,
  raw_commerce_orders: 200,
  raw_commerce_order_items: 201,
  raw_commerce_products: 0,
  raw_commerce_product_variations: 0,
  raw_commerce_categories: 0,
  raw_commerce_customers: 0,
  raw_commerce_coupons: 0,
  raw_commerce_refunds: 0,
  commerce_order_state: 200,
  commerce_product_state: 0,
  commerce_customer_aggregates: 199,
  commerce_daily_sales_facts: 38,
  commerce_product_daily_facts: 58,
});

export function parseWooCommerceExactResumeReactivationArgs(args = []) {
  let execute = false;
  let operationId = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--execute') {
      execute = true;
    } else if (arg === '--operation-id') {
      operationId = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith('--operation-id=')) {
      operationId = arg.slice('--operation-id='.length);
    } else {
      throw exactResumeError(
        `Unknown WooCommerce exact-resume reactivation argument: ${arg}`,
        'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_ARGUMENT_INVALID',
      );
    }
  }
  const exactOperationId = requireOperationId(operationId);
  if (exactOperationId !== WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID) {
    throw exactResumeError(
      'Exact-resume reactivation is pinned to the approved partial operation',
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_OPERATION_NOT_APPROVED',
      { operationIdFingerprint: sha256(exactOperationId) },
    );
  }
  return Object.freeze({ execute, operationId: exactOperationId });
}

export function assertWooCommerceExactResumeReactivationConfirmation(env = {}) {
  const { envName, value } = WOOCOMMERCE_FINAL_EXACT_RESUME_CONFIRMATION;
  if (env[envName] !== value) {
    throw exactResumeError(
      `Exact-resume reactivation requires ${envName}=${value}`,
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildWooCommerceExactResumeReactivationSnapshotSql(input = {}) {
  requireExactTarget(input);
  const baseSql = buildWooCommerceFinalSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
  }).replace(/;$/u, '');
  const workKey = sqlQuote(WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY);
  return compactSql(`
    WITH base AS (${baseSql})
    SELECT
      base.*,
      (SELECT terminal_reason FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_terminal_reason,
      (SELECT abandoned_at FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_abandoned_at,
      (SELECT expires_at FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_expires_at,
      (SELECT audit_reference FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_audit_reference,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = ${workKey})
        AS phase_count,
      (SELECT expected_items FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_expected_items,
      (SELECT processed_items FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_processed_items,
      (SELECT pages_processed FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_pages_processed,
      (SELECT chunks_processed FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_chunks_processed,
      (SELECT COUNT(*) FROM sync_work_units WHERE work_key = ${workKey})
        AS work_unit_count,
      (SELECT COUNT(*) FROM sync_generation_fences WHERE work_key = ${workKey})
        AS generation_fence_count,
      (SELECT generation FROM sync_generation_fences WHERE work_key = ${workKey})
        AS fence_generation,
      (SELECT requested_at FROM sync_generation_fences WHERE work_key = ${workKey})
        AS fence_requested_at,
      (SELECT COUNT(*) FROM queue_operation_attempts
        WHERE operation_id = ${sqlQuote(WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID)}
          AND work_key = ${workKey}) AS queue_operation_row_count,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active')
        AS active_work_count,
      (SELECT COUNT(*) FROM sync_work_runs
        WHERE lifecycle_status = 'active' AND work_key <> ${workKey})
        AS other_active_work_count,
      (SELECT COUNT(*) FROM sync_work_runs
        WHERE lifecycle_status = 'active'
          AND work_key LIKE 'woocommerce:woo-final-%'
          AND work_key <> ${workKey}) AS other_active_woo_work_count
    FROM base;
  `);
}

export function verifyWooCommerceExactResumeReactivationEligibility(row) {
  const evidence = normalizeExactSnapshot(row);
  const violations = validateImmutableIncident(evidence);
  if (evidence.snapshot.workLifecycleStatus !== 'terminal') {
    violations.push('work_not_terminal');
  }
  if (evidence.terminalReason !== WOOCOMMERCE_FINAL_FAILED_WORK_REASON) {
    violations.push('terminal_reason_changed');
  }
  if (evidence.auditReference !== WOOCOMMERCE_FINAL_EXACT_RESUME_ACCIDENT_AUDIT) {
    violations.push('audit_reference_changed');
  }
  if (evidence.abandonedAt === null) violations.push('abandoned_at_missing');
  if (evidence.expiresAt === null) violations.push('expires_at_missing');
  if (evidence.activeWorkCount !== 0) violations.push('active_work_present');
  if (evidence.otherActiveWorkCount !== 0) violations.push('other_active_work_present');
  if (evidence.otherActiveWooWorkCount !== 0) {
    violations.push('other_active_woo_work_present');
  }
  rejectViolations(violations, evidence, 'PREFLIGHT_REJECTED');
  return Object.freeze({
    eligible: true,
    operationId: WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
    workKey: WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY,
    immutableFingerprint: evidence.immutableFingerprint,
    evidence,
  });
}

export function buildWooCommerceExactResumeReactivationSql(input = {}) {
  const eligibility = input.eligibility;
  if (!eligibility?.eligible
    || eligibility.operationId !== WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID
    || eligibility.workKey !== WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY) {
    throw exactResumeError(
      'Verified exact-resume eligibility is required',
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_ELIGIBILITY_REQUIRED',
    );
  }
  const evidence = eligibility.evidence;
  const snapshot = evidence.snapshot;
  const workKey = sqlQuote(WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY);
  const operationId = sqlQuote(WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID);
  const countGuards = Object.entries(EXPECTED_COUNTS)
    .map(([table, expected]) => (
      `(SELECT COUNT(*) FROM ${table} WHERE account_key = 'chemistry_k') = ${expected}`
    ))
    .join(' AND ');
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status = 'active',
        terminal_reason = NULL,
        abandoned_at = NULL,
        expires_at = NULL,
        audit_reference = NULL,
        updated_at = unixepoch('now') * 1000
    WHERE work_key = ${workKey}
      AND lifecycle_status = 'terminal'
      AND terminal_reason = ${sqlQuote(WOOCOMMERCE_FINAL_FAILED_WORK_REASON)}
      AND abandoned_at = ${evidence.abandonedAt}
      AND expires_at = ${evidence.expiresAt}
      AND audit_reference = ${sqlQuote(WOOCOMMERCE_FINAL_EXACT_RESUME_ACCIDENT_AUDIT)}
      AND completed_at IS NULL
      AND completion_json IS NULL
      AND generation = ${snapshot.workGeneration}
      AND requested_at = ${snapshot.workRequestedAt}
      AND EXISTS (
        SELECT 1 FROM sync_runs sr
        WHERE sr.sync_run_id = ${workKey}
          AND sr.status = 'failed'
          AND sr.error_code = 'WOOCOMMERCE_D1_READ_FAILED'
          AND sr.finished_at = ${snapshot.syncRunFinishedAt}
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_phases swp
        WHERE swp.work_key = ${workKey}
          AND swp.phase = 'woocommerce_commerce_pages_v1'
          AND swp.complete = 0
          AND swp.state_json = ${sqlQuote(evidence.stateJson)}
          AND swp.expected_items = ${evidence.phaseExpectedItems}
          AND swp.processed_items = ${evidence.phaseProcessedItems}
          AND swp.pages_processed = ${evidence.phasePagesProcessed}
          AND swp.chunks_processed = ${evidence.phaseChunksProcessed}
      )
      AND (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = ${workKey})
        = ${evidence.phaseCount}
      AND (SELECT COUNT(*) FROM sync_work_units WHERE work_key = ${workKey})
        = ${evidence.workUnitCount}
      AND EXISTS (
        SELECT 1 FROM queue_operation_attempts qoa
        WHERE qoa.operation_id = ${operationId}
          AND qoa.work_key = ${workKey}
          AND qoa.generation = ${snapshot.queueGeneration}
          AND qoa.original_requested_at = ${snapshot.queueOriginalRequestedAt}
          AND qoa.main_queue_attempts = ${snapshot.queueOperationAttempts}
      )
      AND EXISTS (
        SELECT 1 FROM sync_generation_fences sgf
        WHERE sgf.work_key = ${workKey}
          AND sgf.generation = ${evidence.fenceGeneration}
          AND sgf.requested_at = ${evidence.fenceRequestedAt}
      )
      AND (SELECT COUNT(*) FROM data_coverage_runs
        WHERE sync_run_id = ${workKey}) = 2
      AND (SELECT COUNT(*) FROM data_coverage_runs
        WHERE sync_run_id = ${workKey}
          AND (failed_rows <> 0
            OR status NOT IN ('complete','no_data_confirmed','revisable'))) = 1
      AND ${countGuards}
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks
        WHERE owner_id = ${workKey}
          AND expires_at > unixepoch('now') * 1000
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_work_runs WHERE lifecycle_status = 'active'
      );
    SELECT
      changes() AS reactivated_rows,
      work_key,
      lifecycle_status,
      terminal_reason,
      abandoned_at,
      expires_at,
      audit_reference
    FROM sync_work_runs
    WHERE work_key = ${workKey};
  `);
}

export function verifyWooCommerceExactResumeReactivationMutation(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || count(row.reactivated_rows, 'reactivated_rows') !== 1
    || row.work_key !== WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY
    || row.lifecycle_status !== 'active'
    || optionalText(row.terminal_reason) !== null
    || nullableNumber(row.abandoned_at) !== null
    || nullableNumber(row.expires_at) !== null
    || optionalText(row.audit_reference) !== null) {
    throw exactResumeError(
      'Exact-resume lifecycle reactivation did not mutate exactly one guarded row',
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_MUTATION_VERIFY_FAILED',
    );
  }
  return Object.freeze({
    reactivatedRows: 1,
    workKeyFingerprint: sha256(WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY),
  });
}

export function verifyWooCommerceExactResumeReactivationPostState(
  row,
  input = {},
) {
  const expectedFingerprint = requireText(
    input.immutableFingerprint,
    'immutableFingerprint',
  );
  const evidence = normalizeExactSnapshot(row);
  const violations = validateImmutableIncident(evidence);
  if (evidence.snapshot.workLifecycleStatus !== 'active') {
    violations.push('work_not_active');
  }
  if (evidence.terminalReason !== null) violations.push('terminal_reason_not_cleared');
  if (evidence.auditReference !== null) violations.push('audit_reference_not_cleared');
  if (evidence.abandonedAt !== null) violations.push('abandoned_at_not_cleared');
  if (evidence.expiresAt !== null) violations.push('expires_at_not_cleared');
  if (evidence.activeWorkCount !== 1) violations.push('active_work_count_not_one');
  if (evidence.otherActiveWorkCount !== 0) violations.push('other_active_work_present');
  if (evidence.otherActiveWooWorkCount !== 0) {
    violations.push('other_active_woo_work_present');
  }
  if (evidence.immutableFingerprint !== expectedFingerprint) {
    violations.push('immutable_state_changed');
  }
  rejectViolations(violations, evidence, 'POST_VERIFY_FAILED');
  return Object.freeze({
    verified: true,
    operationId: WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
    workKeyFingerprint: sha256(WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY),
    immutableFingerprint: evidence.immutableFingerprint,
    evidence,
  });
}

function normalizeExactSnapshot(row = {}) {
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  const stateJson = requireText(row.state_json, 'state_json');
  const evidence = {
    snapshot,
    stateJson,
    terminalReason: optionalText(row.work_terminal_reason),
    abandonedAt: nullableNumber(row.work_abandoned_at),
    expiresAt: nullableNumber(row.work_expires_at),
    auditReference: optionalText(row.work_audit_reference),
    phaseCount: count(row.phase_count, 'phase_count'),
    phaseExpectedItems: count(row.phase_expected_items, 'phase_expected_items'),
    phaseProcessedItems: count(row.phase_processed_items, 'phase_processed_items'),
    phasePagesProcessed: count(row.phase_pages_processed, 'phase_pages_processed'),
    phaseChunksProcessed: count(row.phase_chunks_processed, 'phase_chunks_processed'),
    workUnitCount: count(row.work_unit_count, 'work_unit_count'),
    generationFenceCount: count(row.generation_fence_count, 'generation_fence_count'),
    fenceGeneration: nullableNumber(row.fence_generation),
    fenceRequestedAt: nullableNumber(row.fence_requested_at),
    queueOperationRowCount: count(
      row.queue_operation_row_count,
      'queue_operation_row_count',
    ),
    activeWorkCount: count(row.active_work_count, 'active_work_count'),
    otherActiveWorkCount: count(row.other_active_work_count, 'other_active_work_count'),
    otherActiveWooWorkCount: count(
      row.other_active_woo_work_count,
      'other_active_woo_work_count',
    ),
  };
  return Object.freeze({
    ...evidence,
    immutableFingerprint: immutableFingerprint(evidence),
  });
}

function validateImmutableIncident(evidence) {
  const snapshot = evidence.snapshot;
  const violations = [];
  if (snapshot.syncRunStatus !== 'failed') violations.push('sync_run_not_failed');
  if (snapshot.syncRunErrorCode !== 'WOOCOMMERCE_D1_READ_FAILED') {
    violations.push('sync_run_error_changed');
  }
  if (snapshot.syncRunFinishedAt === null) violations.push('sync_run_not_finished');
  if (snapshot.workCompletedAt !== null) violations.push('work_already_completed');
  if (snapshot.completion !== null) violations.push('completion_present');
  if (snapshot.phaseComplete) violations.push('phase_complete');
  if (snapshot.state?.datasetIndex !== 1 || snapshot.state?.page !== 2) {
    violations.push('phase_state_changed');
  }
  if (snapshot.activeLockCount !== 0) violations.push('active_lock_present');
  if (snapshot.queueOperationAttempts < 1) violations.push('queue_attempt_missing');
  if (evidence.queueOperationRowCount !== 1) violations.push('queue_identity_not_unique');
  if (snapshot.coverageRunCount !== 2) violations.push('coverage_count_changed');
  if (snapshot.invalidCoverageCount !== 1) violations.push('coverage_state_changed');
  if (evidence.phaseCount !== 1) violations.push('phase_count_changed');
  if (evidence.generationFenceCount !== 1) violations.push('generation_fence_count_changed');
  const requestedAt = snapshot.queueOriginalRequestedAt;
  if (requestedAt === null
    || snapshot.queueGeneration !== requestedAt
    || snapshot.workGeneration !== requestedAt
    || snapshot.workRequestedAt !== requestedAt
    || evidence.fenceGeneration !== requestedAt
    || evidence.fenceRequestedAt !== requestedAt) {
    violations.push('durable_identity_changed');
  }
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (snapshot.counts[table] !== expected) {
      violations.push(`business_count_changed:${table}`);
    }
  }
  return violations;
}

function immutableFingerprint(evidence) {
  return sha256(JSON.stringify({
    syncRunStatus: evidence.snapshot.syncRunStatus,
    syncRunFinishedAt: evidence.snapshot.syncRunFinishedAt,
    syncRunErrorCode: evidence.snapshot.syncRunErrorCode,
    workGeneration: evidence.snapshot.workGeneration,
    workRequestedAt: evidence.snapshot.workRequestedAt,
    workCompletedAt: evidence.snapshot.workCompletedAt,
    completion: evidence.snapshot.completion,
    phaseComplete: evidence.snapshot.phaseComplete,
    stateJson: evidence.stateJson,
    phaseCount: evidence.phaseCount,
    phaseExpectedItems: evidence.phaseExpectedItems,
    phaseProcessedItems: evidence.phaseProcessedItems,
    phasePagesProcessed: evidence.phasePagesProcessed,
    phaseChunksProcessed: evidence.phaseChunksProcessed,
    workUnitCount: evidence.workUnitCount,
    generationFenceCount: evidence.generationFenceCount,
    fenceGeneration: evidence.fenceGeneration,
    fenceRequestedAt: evidence.fenceRequestedAt,
    queueGeneration: evidence.snapshot.queueGeneration,
    queueOriginalRequestedAt: evidence.snapshot.queueOriginalRequestedAt,
    queueOperationAttempts: evidence.snapshot.queueOperationAttempts,
    queueOperationRowCount: evidence.queueOperationRowCount,
    coverageRunCount: evidence.snapshot.coverageRunCount,
    invalidCoverageCount: evidence.snapshot.invalidCoverageCount,
    counts: evidence.snapshot.counts,
  }));
}

function rejectViolations(violations, evidence, suffix) {
  if (violations.length === 0) return;
  throw exactResumeError(
    'Exact-resume lifecycle reactivation state is not the approved incident state',
    `WOOCOMMERCE_EXACT_RESUME_REACTIVATION_${suffix}`,
    {
      operationIdFingerprint: sha256(WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID),
      violations: Object.freeze(violations),
      immutableFingerprint: evidence.immutableFingerprint,
    },
  );
}

function requireExactTarget(input) {
  if (input.operationId !== WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID
    || input.accountKey !== 'chemistry_k') {
    throw exactResumeError(
      'Exact-resume reactivation target is invalid',
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_TARGET_INVALID',
    );
  }
}

function requireOperationId(value) {
  const text = requireText(value, 'operationId');
  if (!/^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u.test(text)) {
    throw exactResumeError(
      'Exact-resume operation ID is invalid',
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_OPERATION_INVALID',
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw exactResumeError(
      `${fieldName} is required`,
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function count(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw exactResumeError(
      `${fieldName} is invalid`,
      'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_COUNT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value) {
  return value === null || value === undefined || value === ''
    ? null
    : String(value);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function exactResumeError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceExactResumeReactivationError';
  error.code = code;
  error.details = details;
  return error;
}
