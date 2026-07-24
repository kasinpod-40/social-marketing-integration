export const TIKTOK_RECOVERY_COMPLETION_CLOSURE = Object.freeze({
  requestedAt: 1784829780000,
  operationId: 'f59b852f00634005c7ff4da51afee964',
  workKey: 'tiktok:f59b852f00634005c7ff4da51afee964',
  cursorKey: 'integration_workspace:tiktok:chemistry_k:organic_history_bootstrap',
  generation: 1784829780000,
  originalDlqId: 'dlq:8d1b9077657385a417cb32a0ed3114cb',
  originalDlqMessageId: '8d1b9077657385a417cb32a0ed3114cb',
  failedRecoveryDlqId: 'dlq:06f7660b796808ebca3b8cd2e7780894',
  failedRecoveryMessageId: '06f7660b796808ebca3b8cd2e7780894',
  terminalDlqId: 'terminal:a90a4dbf2f281124d40601f2f7799a90',
  terminalMessageId: 'a90a4dbf2f281124d40601f2f7799a90',
  recoveryReference: 'recovery:dlq:8d1b9077657385a417cb32a0ed3114cb:tiktok:f59b852f00634005c7ff4da51afee964',
  closureReference: 'closure:terminal:a90a4dbf2f281124d40601f2f7799a90:tiktok:f59b852f00634005c7ff4da51afee964',
  coverageRunId: 'coverage:tiktok:d398495edc3b070b815f99559ecce1a2f24f4c9ac4e0335810e287636fc2f2e0',
  completedAt: 1784880407927,
  terminalAt: 1784880409999,
  expectedRows: 2021,
  expectedMainQueueAttemptsBeforeReplay: 9,
  databaseName: 'social-mkt-state-dev',
  queueName: 'social-mkt-sync-jobs',
  workerName: 'social-mkt-sync-worker',
});

export const TIKTOK_RECOVERY_COMPLETION_CLOSURE_PHASES = Object.freeze([
  'plan',
  'deploy',
  'repair',
  'verify',
  'replay',
  'replay-verify',
]);

export const TIKTOK_RECOVERY_COMPLETION_CLOSURE_CONFIRMATIONS = Object.freeze({
  deploy: Object.freeze({
    envName: 'CONFIRM_TIKTOK_COMPLETION_CLOSURE_DEPLOY',
    value: 'DEPLOY_TIKTOK_COMPLETION_CLOSURE_HOTFIX_SCHEDULES_FALSE',
  }),
  repair: Object.freeze({
    envName: 'CONFIRM_TIKTOK_COMPLETION_CLOSURE_REPAIR',
    value: 'REPAIR_EXACT_COMPLETED_TIKTOK_RECOVERY_CLOSURE',
  }),
  replay: Object.freeze({
    envName: 'CONFIRM_TIKTOK_COMPLETION_CLOSURE_REPLAY',
    value: 'REPLAY_EXACT_COMPLETED_TIKTOK_RECOVERY_ONCE',
  }),
});

export function parseTikTokRecoveryCompletionClosureArgs(argv = []) {
  let phase = 'plan';
  let execute = false;
  for (const value of argv) {
    if (value === '--execute') {
      execute = true;
      continue;
    }
    if (value.startsWith('--phase=')) {
      phase = value.slice('--phase='.length).trim();
      continue;
    }
    throw new TypeError(`Unknown TikTok completion-closure argument: ${value}`);
  }
  if (!TIKTOK_RECOVERY_COMPLETION_CLOSURE_PHASES.includes(phase)) {
    throw new TypeError(`Unsupported TikTok completion-closure phase: ${phase}`);
  }
  return Object.freeze({ phase, execute });
}

export function assertTikTokRecoveryCompletionClosureConfirmation(phase, env = {}) {
  const contract = TIKTOK_RECOVERY_COMPLETION_CLOSURE_CONFIRMATIONS[phase];
  if (!contract) return true;
  if (env[contract.envName] !== contract.value) {
    throw closureError(
      `TikTok completion-closure phase ${phase} requires ${contract.envName}=${contract.value}`,
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function assertTikTokRecoveryCompletionClosureEnv(phase, env = {}) {
  const required = ['WRANGLER_CONFIG', 'MKT_D1_DATABASE_NAME'];
  if (phase === 'replay') {
    required.push('CLOUDFLARE_ACCOUNT_ID', 'CF_QUEUE_ID', 'CLOUDFLARE_API_TOKEN');
  }
  for (const name of required) {
    if (typeof env[name] !== 'string' || env[name].trim() === '') {
      throw closureError(
        `TikTok completion-closure operator requires ${name}`,
        'TIKTOK_RECOVERY_COMPLETION_CLOSURE_ENV_MISSING',
        { phase, envName: name },
      );
    }
  }
  if (env.MKT_D1_DATABASE_NAME !== TIKTOK_RECOVERY_COMPLETION_CLOSURE.databaseName) {
    throw closureError(
      'TikTok completion-closure D1 target mismatch',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_TARGET_MISMATCH',
      {
        expected: TIKTOK_RECOVERY_COMPLETION_CLOSURE.databaseName,
        actual: env.MKT_D1_DATABASE_NAME,
      },
    );
  }
  return Object.freeze({
    wranglerConfig: env.WRANGLER_CONFIG,
    databaseName: env.MKT_D1_DATABASE_NAME,
    accountId: optionalText(env.CLOUDFLARE_ACCOUNT_ID),
    queueId: optionalText(env.CF_QUEUE_ID),
  });
}

export function buildTikTokRecoveryCompletionClosureEvidenceSql() {
  const incident = TIKTOK_RECOVERY_COMPLETION_CLOSURE;
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM organic_content_observations WHERE observation_kind='initial') AS initial_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS data_coverage_entities,
      (SELECT COUNT(*) FROM (SELECT content_key FROM organic_content_state GROUP BY content_key HAVING COUNT(*) > 1)) AS state_duplicate_groups,
      (SELECT COUNT(*) FROM (SELECT observation_key FROM organic_content_observations GROUP BY observation_key HAVING COUNT(*) > 1)) AS observation_duplicate_groups,
      (SELECT cursor_key FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_cursor_key,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_status,
      (SELECT terminal_reason FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_terminal_reason,
      (SELECT audit_reference FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_audit_reference,
      (SELECT generation FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_generation,
      (SELECT requested_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_requested_at,
      (SELECT completed_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_completed_at,
      (SELECT abandoned_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_abandoned_at,
      (SELECT expires_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_expires_at,
      (SELECT json_extract(completion_json, '$.mode') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_mode,
      (SELECT json_extract(completion_json, '$.destinationMode') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_destination_mode,
      (SELECT json_extract(completion_json, '$.dryRun') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_dry_run,
      (SELECT json_extract(completion_json, '$.rawRecords') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_raw_records,
      (SELECT json_extract(completion_json, '$.nextSequence') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_next_sequence,
      (SELECT json_extract(completion_json, '$.continuationRequired') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_continuation_required,
      (SELECT json_extract(completion_json, '$.sourcePagination.durable') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_source_durable,
      (SELECT json_extract(completion_json, '$.sourcePagination.complete') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_source_complete,
      (SELECT json_extract(completion_json, '$.sourcePagination.records') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_source_records,
      (SELECT json_extract(completion_json, '$.d1.coverageRunId') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_coverage_run_id,
      (SELECT json_extract(completion_json, '$.d1.coverageStatus') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_coverage_status,
      (SELECT json_extract(completion_json, '$.d1.plannedStateRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_planned_state_rows,
      (SELECT json_extract(completion_json, '$.d1.plannedObservationRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_planned_observation_rows,
      (SELECT json_extract(completion_json, '$.d1.contentRowsDurable') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_content_rows_durable,
      (SELECT json_extract(completion_json, '$.d1.observationRowsDurable') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_observation_rows_durable,
      (SELECT json_extract(completion_json, '$.d1.coverageEntitiesWritten') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_coverage_entities_written,
      (SELECT json_extract(completion_json, '$.lark.contentWrites') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_lark_content_writes,
      (SELECT json_extract(completion_json, '$.lark.dailyWrites') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_lark_daily_writes,
      (SELECT json_extract(completion_json, '$.lark.blocked') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_lark_blocked,
      (SELECT json_extract(completion_json, '$.reconciliation.expectedEntities') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_expected_entities,
      (SELECT json_extract(completion_json, '$.reconciliation.observedEntities') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_observed_entities,
      (SELECT json_extract(completion_json, '$.reconciliation.expectedRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_expected_rows,
      (SELECT json_extract(completion_json, '$.reconciliation.observedRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_observed_rows,
      (SELECT json_extract(completion_json, '$.reconciliation.failedRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_failed_rows,
      (SELECT json_extract(completion_json, '$.reconciliation.skippedRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_skipped_rows,
      (SELECT json_extract(completion_json, '$.reconciliation.duplicateRows') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_duplicate_rows,
      (SELECT json_extract(completion_json, '$.reconciliation.status') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_reconciliation_status,
      (SELECT json_extract(completion_json, '$.resumableWork.generation') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_resumable_generation,
      (SELECT json_extract(completion_json, '$.resumableWork.complete') FROM sync_work_runs WHERE work_key='${incident.workKey}') AS completion_resumable_complete,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key='${incident.workKey}') AS phase_rows,
      (SELECT COUNT(*) FROM sync_work_units WHERE work_key='${incident.workKey}') AS unit_rows,
      (SELECT cursor_key FROM sync_generation_fences WHERE work_key='${incident.workKey}') AS fence_cursor_key,
      (SELECT generation FROM sync_generation_fences WHERE work_key='${incident.workKey}') AS fence_generation,
      (SELECT requested_at FROM sync_generation_fences WHERE work_key='${incident.workKey}') AS fence_requested_at,
      (SELECT expires_at FROM sync_locks WHERE lock_key='${incident.cursorKey}') AS lock_expires_at,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_message_id,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_error_code,
      (SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS original_recovery_status,
      (SELECT recovery_reference FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS original_recovery_reference,
      (SELECT audit_reference FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS original_recovery_audit_reference,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_dlq_message_id,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_dlq_error_code,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.terminalDlqId}') AS terminal_dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.terminalDlqId}') AS terminal_dlq_message_id,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.terminalDlqId}') AS terminal_dlq_error_code,
      (SELECT retry_count FROM dead_letter_jobs WHERE dlq_id='${incident.terminalDlqId}') AS terminal_dlq_retry_count,
      (SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id='${incident.terminalDlqId}') AS terminal_recovery_status,
      (SELECT recovery_reference FROM dead_letter_operation_metadata WHERE dlq_id='${incident.terminalDlqId}') AS terminal_recovery_reference,
      (SELECT audit_reference FROM dead_letter_operation_metadata WHERE dlq_id='${incident.terminalDlqId}') AS terminal_recovery_audit_reference,
      (SELECT main_queue_attempts FROM queue_operation_attempts WHERE operation_id='${incident.operationId}') AS main_queue_attempts,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE job_type='tiktok.creator.native.history.recover' AND dlq_id <> '${incident.terminalDlqId}' AND created_at > ${incident.terminalAt}) AS unexpected_terminal_failures,
      (SELECT status FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_status,
      (SELECT expected_entities FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_expected_entities,
      (SELECT observed_entities FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_observed_entities,
      (SELECT expected_rows FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_expected_rows,
      (SELECT observed_rows FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_observed_rows,
      (SELECT failed_rows FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_failed_rows,
      (SELECT completed_at FROM data_coverage_runs WHERE coverage_run_id='${incident.coverageRunId}') AS coverage_completed_at;
  `);
}

export function buildTikTokRecoveryCompletionClosureRepairSql(now = Date.now()) {
  const incident = TIKTOK_RECOVERY_COMPLETION_CLOSURE;
  const repairedAt = safeTimestamp(now, 'now');
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status='completed', terminal_reason=NULL, abandoned_at=NULL,
        audit_reference=NULL, updated_at=${repairedAt}
    WHERE work_key='${incident.workKey}'
      AND generation=${incident.generation}
      AND requested_at=${incident.requestedAt}
      AND completed_at=${incident.completedAt}
      AND lifecycle_status IN ('terminal', 'completed')
      AND json_extract(completion_json, '$.resumableWork.complete')=1
      AND json_extract(completion_json, '$.d1.coverageRunId')='${incident.coverageRunId}'
      AND json_extract(completion_json, '$.d1.coverageStatus')='complete'
      AND json_extract(completion_json, '$.d1.contentRowsDurable')=${incident.expectedRows}
      AND json_extract(completion_json, '$.d1.observationRowsDurable')=${incident.expectedRows}
      AND json_extract(completion_json, '$.d1.coverageEntitiesWritten')=${incident.expectedRows};
    SELECT changes() AS work_rows;

    UPDATE dead_letter_jobs
    SET status='redriven', redrive_requested_at=COALESCE(redrive_requested_at, ${repairedAt}),
        redrive_reference=COALESCE(redrive_reference, '${incident.recoveryReference}'),
        redriven_at=COALESCE(redriven_at, ${repairedAt}), updated_at=${repairedAt}
    WHERE dlq_id='${incident.originalDlqId}'
      AND message_id='${incident.originalDlqMessageId}'
      AND status IN ('open', 'redrive_pending', 'redriven');
    SELECT changes() AS original_dlq_rows;

    UPDATE dead_letter_operation_metadata
    SET recovery_status='completed',
        recovery_reference=COALESCE(recovery_reference, '${incident.recoveryReference}'),
        recovery_completed_at=COALESCE(recovery_completed_at, ${repairedAt}),
        audit_reference=COALESCE(audit_reference, '${incident.recoveryReference}'),
        updated_at=${repairedAt}
    WHERE dlq_id='${incident.originalDlqId}'
      AND operation_id='${incident.operationId}'
      AND original_work_key='${incident.workKey}'
      AND generation=${incident.generation}
      AND original_requested_at=${incident.requestedAt}
      AND recovery_status IN ('in_progress', 'completed');
    SELECT changes() AS original_metadata_rows;

    UPDATE dead_letter_jobs
    SET status='redriven', redrive_requested_at=COALESCE(redrive_requested_at, ${repairedAt}),
        redrive_reference=COALESCE(redrive_reference, '${incident.closureReference}'),
        redriven_at=COALESCE(redriven_at, ${repairedAt}), updated_at=${repairedAt}
    WHERE dlq_id='${incident.terminalDlqId}'
      AND message_id='${incident.terminalMessageId}'
      AND error_code='TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE'
      AND status IN ('open', 'redrive_pending', 'redriven');
    SELECT changes() AS terminal_dlq_rows;

    UPDATE dead_letter_operation_metadata
    SET recovery_status='completed',
        recovery_reference=COALESCE(recovery_reference, '${incident.closureReference}'),
        recovery_started_at=COALESCE(recovery_started_at, ${repairedAt}),
        recovery_completed_at=COALESCE(recovery_completed_at, ${repairedAt}),
        audit_reference=COALESCE(audit_reference, '${incident.closureReference}'),
        updated_at=${repairedAt}
    WHERE dlq_id='${incident.terminalDlqId}'
      AND operation_id='${incident.operationId}'
      AND original_work_key='${incident.workKey}'
      AND generation=${incident.generation}
      AND original_requested_at=${incident.requestedAt}
      AND recovery_status IN ('not_started', 'in_progress', 'completed');
    SELECT changes() AS terminal_metadata_rows;
  `);
}

export function validateTikTokRecoveryCompletionClosureRow(row, stage, now = Date.now()) {
  const incident = TIKTOK_RECOVERY_COMPLETION_CLOSURE;
  const common = {
    organic_content_state: incident.expectedRows,
    organic_content_observations: incident.expectedRows,
    initial_observations: incident.expectedRows,
    data_coverage_entities: incident.expectedRows,
    state_duplicate_groups: 0,
    observation_duplicate_groups: 0,
    work_cursor_key: incident.cursorKey,
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    work_completed_at: incident.completedAt,
    completion_mode: 'd1_only',
    completion_destination_mode: 'd1_only',
    completion_dry_run: 0,
    completion_raw_records: incident.expectedRows,
    completion_next_sequence: 5,
    completion_continuation_required: 0,
    completion_source_durable: 1,
    completion_source_complete: 1,
    completion_source_records: incident.expectedRows,
    completion_coverage_run_id: incident.coverageRunId,
    completion_coverage_status: 'complete',
    completion_planned_state_rows: incident.expectedRows,
    completion_planned_observation_rows: incident.expectedRows,
    completion_content_rows_durable: incident.expectedRows,
    completion_observation_rows_durable: incident.expectedRows,
    completion_coverage_entities_written: incident.expectedRows,
    completion_lark_content_writes: 0,
    completion_lark_daily_writes: 0,
    completion_lark_blocked: 1,
    completion_reconciliation_expected_entities: incident.expectedRows,
    completion_reconciliation_observed_entities: incident.expectedRows,
    completion_reconciliation_expected_rows: incident.expectedRows,
    completion_reconciliation_observed_rows: incident.expectedRows,
    completion_reconciliation_failed_rows: 0,
    completion_reconciliation_skipped_rows: 0,
    completion_reconciliation_duplicate_rows: 0,
    completion_reconciliation_status: 'complete',
    completion_resumable_generation: incident.generation,
    completion_resumable_complete: 1,
    phase_rows: 0,
    unit_rows: 0,
    fence_cursor_key: incident.cursorKey,
    fence_generation: incident.generation,
    fence_requested_at: incident.requestedAt,
    original_dlq_message_id: incident.originalDlqMessageId,
    original_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    failed_recovery_dlq_status: 'open',
    failed_recovery_dlq_message_id: incident.failedRecoveryMessageId,
    failed_recovery_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    terminal_dlq_message_id: incident.terminalMessageId,
    terminal_dlq_error_code: 'TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE',
    terminal_dlq_retry_count: incident.expectedMainQueueAttemptsBeforeReplay,
    unexpected_terminal_failures: 0,
    coverage_status: 'complete',
    coverage_expected_entities: incident.expectedRows,
    coverage_observed_entities: incident.expectedRows,
    coverage_expected_rows: incident.expectedRows,
    coverage_observed_rows: incident.expectedRows,
    coverage_failed_rows: 0,
  };
  assertRowMatches(row, common, stage);
  assertPositiveTimestamp(row?.coverage_completed_at, 'coverage_completed_at', stage);
  assertPositiveTimestamp(row?.work_expires_at, 'work_expires_at', stage);
  const lockExpiresAt = normalizeScalar(row?.lock_expires_at);
  if (lockExpiresAt !== null && (!Number.isSafeInteger(lockExpiresAt) || lockExpiresAt >= now)) {
    throw closureError(
      'TikTok completion-closure lock is not absent or expired',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_LOCK_ACTIVE',
      { stage, lockExpiresAt, now },
    );
  }
  const attempts = normalizeScalar(row?.main_queue_attempts);
  if (!Number.isSafeInteger(attempts) || attempts < incident.expectedMainQueueAttemptsBeforeReplay) {
    throw closureError(
      'TikTok completion-closure main Queue attempts are below the proven incident floor',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_MISMATCH',
      { stage, fieldName: 'main_queue_attempts', expectedMinimum: incident.expectedMainQueueAttemptsBeforeReplay, actual: attempts },
    );
  }

  if (stage === 'before_repair') {
    assertRowMatches(row, {
      work_status: 'terminal',
      work_terminal_reason: 'QUEUE_PERMANENT_FAILURE',
      work_audit_reference: incident.terminalDlqId,
      work_abandoned_at: incident.terminalAt,
      original_dlq_status: 'open',
      original_recovery_status: 'in_progress',
      original_recovery_reference: incident.recoveryReference,
      original_recovery_audit_reference: null,
      terminal_dlq_status: 'open',
      terminal_recovery_status: 'not_started',
      terminal_recovery_reference: null,
      terminal_recovery_audit_reference: null,
    }, stage);
  } else if (stage === 'final') {
    assertRowMatches(row, {
      work_status: 'completed',
      work_terminal_reason: null,
      work_audit_reference: null,
      work_abandoned_at: null,
      original_dlq_status: 'redriven',
      original_recovery_status: 'completed',
      original_recovery_reference: incident.recoveryReference,
      original_recovery_audit_reference: incident.recoveryReference,
      terminal_dlq_status: 'redriven',
      terminal_recovery_status: 'completed',
      terminal_recovery_reference: incident.closureReference,
      terminal_recovery_audit_reference: incident.closureReference,
    }, stage);
  } else {
    throw new TypeError(`Unsupported TikTok completion-closure validation stage: ${stage}`);
  }
  return Object.freeze({ ...row, lockExpiredOrAbsent: true });
}

export function validateTikTokRecoveryCompletionClosureRepairRows(rows) {
  const expected = {
    work_rows: 1,
    original_dlq_rows: 1,
    original_metadata_rows: 1,
    terminal_dlq_rows: 1,
    terminal_metadata_rows: 1,
  };
  for (const [fieldName, expectedValue] of Object.entries(expected)) {
    const row = rows.find((candidate) => Object.hasOwn(candidate ?? {}, fieldName));
    if (normalizeScalar(row?.[fieldName]) !== expectedValue) {
      throw closureError(
        'TikTok completion-closure guarded repair did not affect the exact expected row',
        'TIKTOK_RECOVERY_COMPLETION_CLOSURE_REPAIR_MISMATCH',
        { fieldName, expected: expectedValue, actual: row?.[fieldName] ?? null },
      );
    }
  }
  return Object.freeze({ ...expected });
}

export function validateTikTokRecoveryCompletionClosureReplay(before, after) {
  validateTikTokRecoveryCompletionClosureRow(before, 'final');
  validateTikTokRecoveryCompletionClosureRow(after, 'final');
  const stableFields = [
    'organic_content_state',
    'organic_content_observations',
    'initial_observations',
    'data_coverage_entities',
    'state_duplicate_groups',
    'observation_duplicate_groups',
    'work_generation',
    'work_requested_at',
    'work_completed_at',
    'completion_raw_records',
    'completion_next_sequence',
    'completion_content_rows_durable',
    'completion_observation_rows_durable',
    'completion_coverage_entities_written',
    'coverage_expected_entities',
    'coverage_observed_entities',
    'coverage_expected_rows',
    'coverage_observed_rows',
    'coverage_failed_rows',
    'coverage_completed_at',
  ];
  for (const fieldName of stableFields) {
    if (normalizeScalar(before?.[fieldName]) !== normalizeScalar(after?.[fieldName])) {
      throw closureError(
        'Exact TikTok completion replay changed durable business facts',
        'TIKTOK_RECOVERY_COMPLETION_CLOSURE_REPLAY_DRIFT',
        { fieldName, before: before?.[fieldName] ?? null, after: after?.[fieldName] ?? null },
      );
    }
  }
  return true;
}

function assertRowMatches(row, expected, stage) {
  for (const [fieldName, expectedValue] of Object.entries(expected)) {
    if (normalizeScalar(row?.[fieldName]) !== normalizeScalar(expectedValue)) {
      throw closureError(
        'TikTok completion-closure evidence mismatch',
        'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_MISMATCH',
        { stage, fieldName, expected: expectedValue, actual: row?.[fieldName] ?? null },
      );
    }
  }
}

function assertPositiveTimestamp(value, fieldName, stage) {
  const normalized = normalizeScalar(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw closureError(
      'TikTok completion-closure timestamp is missing',
      'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_MISMATCH',
      { stage, fieldName, actual: value ?? null },
    );
  }
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim();
  if (text === '') return '';
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`TikTok completion-closure ${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function closureError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokRecoveryCompletionClosureError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
