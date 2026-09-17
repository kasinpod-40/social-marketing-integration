const generation = 1789579848000;
const metricDate = '2026-09-16';
const targets = Object.freeze({
  k2: Object.freeze({
    dlqId: 'terminal:c446a414f013a252e3814503312f227c',
    operationId: 'meta-ads-chemistry_k2-scheduled-20260916',
    workKey: 'meta_ads:chemistry_k2:meta-ads-chemistry_k2-scheduled-20260916',
  }),
  k3: Object.freeze({
    dlqId: 'terminal:9b3fa65525294529df0037ced7a76c1f',
    operationId: 'meta-ads-chemistry_k3-scheduled-20260916',
    workKey: 'meta_ads:chemistry_k3:meta-ads-chemistry_k3-scheduled-20260916',
  }),
});

export const META_ADS_EXACT_RECOVERY = Object.freeze({
  accountId: '154f6bf72740d29d7453cec7fb800d32',
  worker: 'social-mkt-sync-worker',
  workerVersion: '29e2caf4-8ac0-4877-8cba-01c2e520a54d',
  database: 'social-mkt-state-prod',
  queue: 'social-mkt-sync-jobs',
  generation,
  metricDate,
  targets,
});

export function readMetaRecoveryTarget(key) {
  if (!Object.hasOwn(targets, key)) throw new Error('Specify only k2 or k3');
  return Object.freeze({ ...targets[key], key,
    generation, metricDate, reference: `meta-ads-20260916-${key}-exact-resume-1` });
}

/** Only the two observed 2/1504044 incidents may be resumed, one at a time. */
export function buildMetaRecoveryEvidenceSql(target, now) {
  assertTarget(target);
  const at = assertNow(now);
  return `SELECT d.dlq_id,d.status AS dlq_status,d.job_type,d.error_code,d.replay_payload_json,
    m.operation_id,m.original_work_key,m.generation,m.original_requested_at,
    m.main_queue_attempts,m.recovery_status,q.main_queue_attempts AS recorded_attempts,
    w.lifecycle_status,w.terminal_reason,w.completed_at,w.cursor_key,
    (SELECT COUNT(*) FROM sync_work_phases p WHERE p.work_key=w.work_key
      AND p.phase='meta_end_to_end_source_staging_v1' AND p.complete=0
      AND json_extract(p.state_json,'$.stage')='daily') AS source_phase_count,
    (SELECT COUNT(*) FROM sync_runs r WHERE r.sync_run_id='meta:' || w.work_key
      AND r.status='failed' AND r.error_code='META_PERMANENT_API_ERROR'
      AND json_extract(r.details_json,'$.errorDetails.operation')='meta_ads.performance.daily'
      AND json_extract(r.details_json,'$.errorDetails.status')=400
      AND json_extract(r.details_json,'$.errorDetails.graphCode')=2
      AND json_extract(r.details_json,'$.errorDetails.graphSubcode')=1504044) AS exact_failure_count,
    (SELECT COUNT(*) FROM sync_locks l WHERE l.lock_key=w.cursor_key AND l.expires_at>${at}) AS active_lock_count,
    (SELECT COUNT(*) FROM sync_generation_fences f WHERE f.cursor_key=w.cursor_key
      AND (f.generation<>${generation} OR f.work_key<>w.work_key)) AS changed_fence_count,
    (SELECT COUNT(*) FROM sync_work_runs n WHERE n.cursor_key=w.cursor_key
      AND n.generation>${generation}) AS newer_work_count,
    (SELECT COUNT(*) FROM sync_work_runs o WHERE o.requested_at>=1789578000000
      AND o.requested_at<1789664400000 AND o.work_type<>'meta.ads.sync'
      AND o.lifecycle_status='active') AS other_channel_active_count
  FROM dead_letter_jobs d
  JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
  JOIN sync_work_runs w ON w.work_key=m.original_work_key
  JOIN queue_operation_attempts q ON q.operation_id=m.operation_id
  WHERE d.dlq_id='${target.dlqId}'`;
}

export function assertMetaRecoveryEvidence(row, target) {
  assertTarget(target);
  const required = {
    dlq_id: target.dlqId, dlq_status: 'open', job_type: 'meta.ads.sync',
    error_code: 'META_PERMANENT_API_ERROR', operation_id: target.operationId,
    original_work_key: target.workKey, generation, original_requested_at: generation,
    main_queue_attempts: 2, recovery_status: 'not_started', recorded_attempts: 2,
    lifecycle_status: 'terminal', terminal_reason: 'QUEUE_PERMANENT_FAILURE',
    completed_at: null, source_phase_count: 1, exact_failure_count: 1,
    active_lock_count: 0, changed_fence_count: 0, newer_work_count: 0,
    other_channel_active_count: 0,
  };
  for (const [key, value] of Object.entries(required)) {
    if (row?.[key] !== value) throw new Error(`Meta exact recovery fence failed: ${key}`);
  }
  let payload;
  try { payload = JSON.parse(row.replay_payload_json); } catch { throw new Error('Replay payload is not JSON'); }
  if (payload?.schemaVersion !== 1 || payload?.type !== 'meta.ads.sync'
    || payload?.trigger !== 'scheduled' || payload?.connectorKey !== 'meta_ads'
    || payload?.operationId !== target.operationId || payload?.workKey !== target.workKey
    || payload?.generation !== generation || payload?.originalRequestedAt !== generation
    || Date.parse(payload?.requestedAt) !== generation
    || payload?.periodStart !== metricDate || payload?.periodEnd !== metricDate
    || payload?.sourceMode !== 'daily_activity_scoped_creatives_v1'
    || payload?.d1Only !== false || payload?.dryRun !== false
    || payload?.sourceAccountKey !== `chemistry_${target.key}`) {
    throw new Error('Meta Queue replay payload identity changed');
  }
  return Object.freeze({ payload: Object.freeze(payload), cursorKey: row.cursor_key });
}

/** A CAS claim makes an uncertain send fail closed; never resend by rerunning this operator. */
export function buildMetaRecoveryClaimSql(target, now) {
  assertTarget(target);
  const at = assertNow(now);
  return `UPDATE dead_letter_operation_metadata SET recovery_status='in_progress',
    recovery_reference='${target.reference}',recovery_started_at=${at},updated_at=${at}
    WHERE dlq_id='${target.dlqId}' AND operation_id='${target.operationId}'
      AND original_work_key='${target.workKey}' AND generation=${generation}
      AND original_requested_at=${generation} AND main_queue_attempts=2
      AND recovery_status='not_started'
      AND EXISTS(SELECT 1 FROM dead_letter_jobs d WHERE d.dlq_id='${target.dlqId}'
        AND d.status='open' AND d.error_code='META_PERMANENT_API_ERROR')
      AND EXISTS(SELECT 1 FROM sync_runs r WHERE r.sync_run_id='meta:${target.workKey}'
        AND r.status='failed' AND r.error_code='META_PERMANENT_API_ERROR'
        AND json_extract(r.details_json,'$.errorDetails.operation')='meta_ads.performance.daily'
        AND json_extract(r.details_json,'$.errorDetails.status')=400
        AND json_extract(r.details_json,'$.errorDetails.graphCode')=2
        AND json_extract(r.details_json,'$.errorDetails.graphSubcode')=1504044)
      AND EXISTS(SELECT 1 FROM sync_work_runs w WHERE w.work_key='${target.workKey}'
        AND w.generation=${generation} AND w.lifecycle_status='terminal'
        AND w.terminal_reason='QUEUE_PERMANENT_FAILURE' AND w.completed_at IS NULL
        AND EXISTS(SELECT 1 FROM sync_work_phases p WHERE p.work_key=w.work_key
          AND p.phase='meta_end_to_end_source_staging_v1' AND p.complete=0
          AND json_extract(p.state_json,'$.stage')='daily')
        AND NOT EXISTS(SELECT 1 FROM sync_locks l WHERE l.lock_key=w.cursor_key AND l.expires_at>${at})
        AND NOT EXISTS(SELECT 1 FROM sync_work_runs n WHERE n.cursor_key=w.cursor_key
          AND n.generation>${generation})
        AND EXISTS(SELECT 1 FROM sync_generation_fences f WHERE f.cursor_key=w.cursor_key
          AND f.generation=${generation} AND f.work_key=w.work_key))
      AND NOT EXISTS(SELECT 1 FROM sync_work_runs o WHERE o.requested_at>=1789578000000
        AND o.requested_at<1789664400000 AND o.work_type<>'meta.ads.sync'
        AND o.lifecycle_status='active')
    RETURNING dlq_id,recovery_status,recovery_reference`;
}

export function buildMetaRecoveryReactivateSql(target, now) {
  assertTarget(target);
  const at = assertNow(now);
  return `UPDATE sync_work_runs SET lifecycle_status='active',terminal_reason=NULL,
    abandoned_at=NULL,expires_at=NULL,audit_reference='${target.reference}',updated_at=${at}
    WHERE work_key='${target.workKey}' AND generation=${generation}
      AND requested_at=${generation} AND lifecycle_status='terminal'
      AND terminal_reason='QUEUE_PERMANENT_FAILURE' AND completed_at IS NULL
      AND EXISTS(SELECT 1 FROM dead_letter_operation_metadata m
        WHERE m.dlq_id='${target.dlqId}' AND m.operation_id='${target.operationId}'
        AND m.recovery_status='in_progress' AND m.recovery_reference='${target.reference}')
      AND NOT EXISTS(SELECT 1 FROM sync_locks l WHERE l.lock_key=sync_work_runs.cursor_key
        AND l.expires_at>${at})
      AND EXISTS(SELECT 1 FROM sync_generation_fences f WHERE f.cursor_key=sync_work_runs.cursor_key
        AND f.generation=${generation} AND f.work_key=sync_work_runs.work_key)
      AND NOT EXISTS(SELECT 1 FROM sync_work_runs n WHERE n.cursor_key=sync_work_runs.cursor_key
        AND n.generation>${generation})
    RETURNING work_key,lifecycle_status,audit_reference`;
}

export function buildMetaRecoveryMarkSql(target, now) {
  assertTarget(target);
  const at = assertNow(now);
  return [
    `UPDATE dead_letter_jobs SET status='redriven',redrive_requested_at=${at},
      redrive_reference='${target.reference}',redriven_at=${at},updated_at=${at}
      WHERE dlq_id='${target.dlqId}' AND status='open'
        AND EXISTS(SELECT 1 FROM dead_letter_operation_metadata m WHERE m.dlq_id='${target.dlqId}'
          AND m.recovery_status='in_progress' AND m.recovery_reference='${target.reference}')
      RETURNING dlq_id,status,redrive_reference`,
    `UPDATE dead_letter_operation_metadata SET recovery_status='completed',
      recovery_completed_at=${at},updated_at=${at}
      WHERE dlq_id='${target.dlqId}' AND recovery_status='in_progress'
        AND recovery_reference='${target.reference}'
        AND EXISTS(SELECT 1 FROM dead_letter_jobs d WHERE d.dlq_id='${target.dlqId}'
          AND d.status='redriven' AND d.redrive_reference='${target.reference}')
      RETURNING dlq_id,recovery_status,recovery_reference`,
  ];
}

function assertTarget(target) {
  if (!target || !Object.values(targets).some((item) => item.dlqId === target.dlqId
    && item.workKey === target.workKey && item.operationId === target.operationId)
    || target.reference !== `meta-ads-20260916-${target.key}-exact-resume-1`) {
    throw new Error('Unknown Meta recovery target');
  }
}

function assertNow(now) {
  if (!Number.isSafeInteger(now) || now <= generation) throw new Error('Invalid recovery timestamp');
  return now;
}
