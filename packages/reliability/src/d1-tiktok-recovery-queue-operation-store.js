import {
  D1QueueOperationStore as BaseD1QueueOperationStore,
  TIKTOK_BOOTSTRAP_INCIDENT,
} from './d1-queue-operation-store.js';
import {
  permanentError,
  sanitizeOperationalText,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

export { TIKTOK_BOOTSTRAP_INCIDENT };

/**
 * Exact TikTok recovery extension.
 * Completed resumable Work intentionally clears phase/unit rows, so final DLQ closure accepts the
 * persisted completion_json only when every exact durable counter, Coverage proof and zero-Lark
 * invariant matches the immutable 2026-07-23 incident.
 */
export class D1QueueOperationStore extends BaseD1QueueOperationStore {
  async markTikTokBootstrapIncidentRecovered(input = {}) {
    assertExactIncident(input);
    const completedAt = timestamp(input.completedAt ?? this.now(), 'completedAt');
    const auditReference = requireText(input.auditReference, 'auditReference');
    try {
      const proof = await readCompletionProof(this.db);
      await this.db.batch([
        this.db.prepare(`
          UPDATE dead_letter_jobs
          SET status = 'redriven',
              redrive_requested_at = COALESCE(redrive_requested_at, ?),
              redrive_reference = COALESCE(redrive_reference, ?),
              redriven_at = COALESCE(redriven_at, ?),
              updated_at = ?
          WHERE dlq_id = ? AND status IN ('open', 'redrive_pending', 'redriven')
        `).bind(
          completedAt,
          auditReference,
          completedAt,
          completedAt,
          TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
        ),
        this.db.prepare(`
          UPDATE dead_letter_operation_metadata
          SET recovery_status = 'completed',
              recovery_completed_at = COALESCE(recovery_completed_at, ?),
              audit_reference = COALESCE(audit_reference, ?),
              updated_at = ?
          WHERE dlq_id = ?
            AND operation_id = ?
            AND original_work_key = ?
            AND recovery_status IN ('in_progress', 'completed')
        `).bind(
          completedAt,
          auditReference,
          completedAt,
          TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
          TIKTOK_BOOTSTRAP_INCIDENT.operationId,
          TIKTOK_BOOTSTRAP_INCIDENT.workKey,
        ),
      ]);
      return Object.freeze({
        status: 'completed',
        dlqId: TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
        auditReference,
        completedAt,
        coverageRunId: proof.coverageRunId,
        proofSource: proof.proofSource,
      });
    } catch (cause) {
      if (cause?.code?.startsWith?.('TIKTOK_BOOTSTRAP_RECOVERY_')) throw cause;
      throw d1Error(
        'Failed to complete TikTok bootstrap incident recovery',
        'D1_TIKTOK_BOOTSTRAP_RECOVERY_COMPLETE_FAILED',
        cause,
      );
    }
  }
}

async function readCompletionProof(db) {
  const incident = TIKTOK_BOOTSTRAP_INCIDENT;
  const work = await db.prepare(`
    SELECT generation, requested_at, lifecycle_status, completion_json
    FROM sync_work_runs
    WHERE work_key = ?
  `).bind(incident.workKey).first();
  if (!work
    || Number(work.generation) !== incident.generation
    || Number(work.requested_at) !== incident.originalRequestedAt
    || work.lifecycle_status !== 'completed') {
    throw incidentError(
      'Original TikTok bootstrap Work is not completed',
      'TIKTOK_BOOTSTRAP_RECOVERY_WORK_INCOMPLETE',
    );
  }

  const completion = parseObject(work.completion_json, 'completion_json');
  const coverageRunId = optionalText(completion?.d1?.coverageRunId);
  if (!coverageRunId || completion?.d1?.coverageStatus !== 'complete') {
    throw incidentError(
      'Original TikTok bootstrap completion lacks complete Coverage',
      'TIKTOK_BOOTSTRAP_RECOVERY_COVERAGE_INCOMPLETE',
    );
  }

  const phase = await db.prepare(`
    SELECT state_json, complete
    FROM sync_work_phases
    WHERE work_key = ? AND phase = ?
  `).bind(incident.workKey, incident.phase).first();
  let proofSource;
  if (phase) {
    assertPhaseProof(phase);
    proofSource = 'phase_and_completion';
  } else {
    assertClearedPhaseCompletionProof(completion);
    proofSource = 'completion_json_after_phase_cleanup';
  }

  const coverage = await db.prepare(`
    SELECT status, expected_entities, observed_entities,
           expected_rows, observed_rows, failed_rows, completed_at
    FROM data_coverage_runs
    WHERE coverage_run_id = ?
  `).bind(coverageRunId).first();
  const expected = incident.expectedRows;
  if (!coverage
    || coverage.status !== 'complete'
    || Number(coverage.expected_entities) !== expected
    || Number(coverage.observed_entities) !== expected
    || Number(coverage.expected_rows) !== expected
    || Number(coverage.observed_rows) !== expected
    || Number(coverage.failed_rows) !== 0
    || !Number.isSafeInteger(Number(coverage.completed_at))) {
    throw incidentError(
      'TikTok bootstrap Coverage proof is not complete',
      'TIKTOK_BOOTSTRAP_RECOVERY_COVERAGE_INCOMPLETE',
    );
  }
  return Object.freeze({ coverageRunId, proofSource });
}

function assertPhaseProof(phase) {
  const expected = TIKTOK_BOOTSTRAP_INCIDENT.expectedRows;
  const state = parseObject(phase.state_json, 'state_json');
  if (Number(phase.complete) !== 1
    || Number(state.nextSequence) !== 5
    || Number(state.rawRecordsCompleted) !== expected
    || Number(state.contentRowsDurable) !== expected
    || Number(state.observationRowsDurable) !== expected
    || Number(state.coverageEntitiesWritten) !== expected) {
    throw incidentError(
      'TikTok bootstrap write phase is not durably complete',
      'TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE',
    );
  }
}

function assertClearedPhaseCompletionProof(completion) {
  const expected = TIKTOK_BOOTSTRAP_INCIDENT.expectedRows;
  const d1 = objectValue(completion.d1);
  const lark = objectValue(completion.lark);
  const reconciliation = objectValue(completion.reconciliation);
  const resumableWork = objectValue(completion.resumableWork);
  const sourcePagination = objectValue(completion.sourcePagination);
  const exact = [
    completion.mode === 'd1_only',
    completion.destinationMode === 'd1_only',
    completion.dryRun === false,
    Number(completion.rawRecords) === expected,
    completion.continuationRequired === false,
    Number(completion.nextSequence) === 5,
    sourcePagination.durable === true,
    sourcePagination.complete === true,
    Number(sourcePagination.records) === expected,
    d1.coverageStatus === 'complete',
    Number(d1.plannedStateRows) === expected,
    Number(d1.plannedObservationRows) === expected,
    Number(d1.contentRowsDurable) === expected,
    Number(d1.observationRowsDurable) === expected,
    Number(d1.coverageEntitiesWritten) === expected,
    Number(lark.contentWrites) === 0,
    Number(lark.dailyWrites) === 0,
    lark.blocked === true,
    Number(reconciliation.expectedEntities) === expected,
    Number(reconciliation.observedEntities) === expected,
    Number(reconciliation.expectedRows) === expected,
    Number(reconciliation.observedRows) === expected,
    Number(reconciliation.failedRows) === 0,
    Number(reconciliation.skippedRows) === 0,
    Number(reconciliation.duplicateRows) === 0,
    reconciliation.status === 'complete',
    Number(resumableWork.generation) === TIKTOK_BOOTSTRAP_INCIDENT.generation,
    resumableWork.complete === true,
  ];
  if (exact.some((value) => value !== true)) {
    throw incidentError(
      'TikTok bootstrap cleared-phase completion proof is incomplete',
      'TIKTOK_BOOTSTRAP_RECOVERY_COMPLETION_INCOMPLETE',
    );
  }
}

function assertExactIncident(input) {
  const values = {
    dlqId: requireText(input.dlqId, 'dlqId'),
    operationId: requireText(input.operationId, 'operationId'),
    workKey: requireText(input.workKey, 'workKey'),
    generation: timestamp(input.generation, 'generation'),
    originalRequestedAt: timestamp(input.originalRequestedAt, 'originalRequestedAt'),
  };
  for (const [key, expected] of Object.entries(TIKTOK_BOOTSTRAP_INCIDENT)) {
    if (!Object.hasOwn(values, key)) continue;
    if (values[key] !== expected) {
      throw incidentError(
        'TikTok bootstrap recovery request does not match the exact incident',
        'TIKTOK_BOOTSTRAP_RECOVERY_IDENTITY_MISMATCH',
        { fieldName: key },
      );
    }
  }
  return values;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseObject(value, fieldName) {
  if (value === null || value === undefined || value === '') return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError();
    return parsed;
  } catch (cause) {
    throw incidentError(
      `Invalid incident ${fieldName}`,
      'TIKTOK_BOOTSTRAP_RECOVERY_STATE_INVALID',
      {
        fieldName,
        cause: sanitizeOperationalText(cause instanceof Error ? cause.message : String(cause)),
      },
    );
  }
}

function incidentError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: {
      causeMessage: sanitizeOperationalText(cause instanceof Error ? cause.message : String(cause)),
    },
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1 TikTok recovery store requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`D1 TikTok recovery store ${fieldName} must be a non-negative safe integer`);
  }
  return number;
}
