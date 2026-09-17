export const YOUTUBE_ACCOUNT_DAILY_RECOVERY = Object.freeze({
  accountId: '154f6bf72740d29d7453cec7fb800d32',
  worker: 'social-mkt-sync-worker',
  workerVersion: 'db3b806b-885f-41db-bed7-d37eebe4d606',
  database: 'social-mkt-state-prod',
  queue: 'social-mkt-sync-jobs',
  tableId: 'tbl7rAIECdX34Ec1',
  dlqId: 'terminal:f02838b98d5b6909aaf1bbe34fcd960f',
  operationId: 'youtube-scheduled-20260917',
  workKey: 'youtube:youtube-scheduled-20260917',
  generation: 1789583448000,
  metricDate: '2026-09-16',
  recoveryReference: 'youtube-20260917-account-daily-fallback-resume-1',
});

const t = YOUTUBE_ACCOUNT_DAILY_RECOVERY;

/** Read-only, exact-incident authority; never reads the protected unrelated terminal. */
export function buildYouTubeRecoveryEvidenceSql(now) {
  const at = requireTimestamp(now);
  return `SELECT d.dlq_id,d.status AS dlq_status,d.job_type,d.error_code,d.payload_json,
    m.operation_id,m.original_work_key,m.generation,m.original_requested_at,
    m.main_queue_attempts,m.recovery_status,
    q.main_queue_attempts AS recorded_attempts,
    (SELECT COUNT(*) FROM sync_runs WHERE platform='youtube' AND status='failed'
      AND error_message='YouTube sync requires tables.mktAccountDaily'
      AND started_at BETWEEN ${t.generation} AND ${t.generation + 120000}) AS source_failure_count,
    (SELECT COUNT(*) FROM sync_work_runs WHERE work_key='${t.workKey}') AS exact_work_count,
    (SELECT COUNT(*) FROM sync_locks WHERE lock_key LIKE '%youtube%' AND expires_at>${at}) AS active_lock_count,
    (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id LIKE 'youtube-scheduled-%'
      AND generation>${t.generation}) AS newer_operation_count,
    (SELECT COUNT(*) FROM organic_account_daily_facts WHERE platform='youtube'
      AND account_key='chemistry_k' AND metric_date='${t.metricDate}') AS target_fact_count
  FROM dead_letter_jobs d
  LEFT JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
  LEFT JOIN queue_operation_attempts q ON q.operation_id=m.operation_id
  WHERE d.dlq_id='${t.dlqId}'`;
}

export function assertYouTubeRecoveryEvidence(row) {
  const expected = {
    dlq_id: t.dlqId,
    dlq_status: 'open',
    job_type: 'youtube.channel.organic.sync',
    error_code: 'PERMANENT_QUEUE_FAILURE',
    operation_id: t.operationId,
    original_work_key: t.workKey,
    generation: t.generation,
    original_requested_at: t.generation,
    main_queue_attempts: 1,
    recovery_status: 'not_started',
    recorded_attempts: 1,
    source_failure_count: 1,
    exact_work_count: 0,
    active_lock_count: 0,
    newer_operation_count: 0,
    target_fact_count: 0,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (row?.[key] !== value) throw recoveryError(`Exact YouTube recovery fence failed: ${key}`);
  }
  let payload;
  try { payload = JSON.parse(row.payload_json); } catch { throw recoveryError('Exact YouTube payload is not JSON'); }
  if (payload?.schemaVersion !== 1
    || payload?.type !== expected.job_type
    || payload?.trigger !== 'scheduled'
    || payload?.syncMode !== 'auto'
    || payload?.metricDate !== t.metricDate
    || payload?.operationId !== t.operationId
    || payload?.workKey !== t.workKey
    || payload?.generation !== t.generation
    || payload?.originalRequestedAt !== t.generation
    || Date.parse(payload?.requestedAt) !== t.generation) {
    throw recoveryError('Exact YouTube Queue payload identity changed');
  }
  return Object.freeze({ payload: Object.freeze(payload), operationId: t.operationId, metricDate: t.metricDate });
}

export function buildYouTubeRecoveryClaimSql(now) {
  const at = requireTimestamp(now);
  return `UPDATE dead_letter_operation_metadata SET recovery_status='in_progress',
    recovery_reference='${t.recoveryReference}',recovery_started_at=${at},updated_at=${at}
  WHERE dlq_id='${t.dlqId}' AND operation_id='${t.operationId}'
    AND original_work_key='${t.workKey}' AND generation=${t.generation}
    AND original_requested_at=${t.generation} AND recovery_status='not_started'
    AND EXISTS(SELECT 1 FROM dead_letter_jobs WHERE dlq_id='${t.dlqId}' AND status='open')
    AND NOT EXISTS(SELECT 1 FROM sync_work_runs WHERE work_key='${t.workKey}')
    AND NOT EXISTS(SELECT 1 FROM sync_locks WHERE lock_key LIKE '%youtube%' AND expires_at>${at})
    AND NOT EXISTS(SELECT 1 FROM queue_operation_attempts WHERE operation_id LIKE 'youtube-scheduled-%'
      AND generation>${t.generation})
    AND NOT EXISTS(SELECT 1 FROM organic_account_daily_facts WHERE platform='youtube'
      AND account_key='chemistry_k' AND metric_date='${t.metricDate}')
  RETURNING dlq_id,recovery_status,recovery_reference`;
}

export function buildYouTubeRecoveryMarkSql(now) {
  const at = requireTimestamp(now);
  return [
    `UPDATE dead_letter_jobs SET status='redriven',redrive_requested_at=${at},
      redrive_reference='${t.recoveryReference}',redriven_at=${at},updated_at=${at}
      WHERE dlq_id='${t.dlqId}' AND status='open'
      AND EXISTS(SELECT 1 FROM dead_letter_operation_metadata WHERE dlq_id='${t.dlqId}'
        AND recovery_status='in_progress' AND recovery_reference='${t.recoveryReference}')
      RETURNING dlq_id,status,redrive_reference`,
    `UPDATE dead_letter_operation_metadata SET recovery_status='completed',
      recovery_completed_at=${at},updated_at=${at}
      WHERE dlq_id='${t.dlqId}' AND recovery_status='in_progress'
        AND recovery_reference='${t.recoveryReference}'
        AND EXISTS(SELECT 1 FROM dead_letter_jobs WHERE dlq_id='${t.dlqId}'
          AND status='redriven' AND redrive_reference='${t.recoveryReference}')
      RETURNING dlq_id,recovery_status,recovery_reference`,
  ];
}

function requireTimestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw recoveryError('Recovery timestamp invalid');
  return value;
}

function recoveryError(message) {
  const error = new Error(message);
  error.code = 'YOUTUBE_ACCOUNT_DAILY_RECOVERY_FENCE_FAILED';
  return error;
}
