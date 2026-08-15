export const TIKTOK_RESOLVED_GENERATION_ALERT_CLOSEOUT_VERSION =
  'tiktok-resolved-generation-alert-closeout-v2';

export const TIKTOK_RESOLVED_GENERATION_ALERT = Object.freeze({
  alertId: '1a2a3464-c5ce-4e7a-bfa9-ec34738ea3a7',
  syncRunId: 'tiktok-post-lark:watermark:352a8b99fc69a8cc87d1126fc0885d832154e98a82c8baa32443073c04c3144d',
  workKey: 'tiktok:watermark:352a8b99fc69a8cc87d1126fc0885d832154e98a82c8baa32443073c04c3144d',
  generation: 1786692041000,
  recordsWritten: 1588,
  newerGenerations: Object.freeze([
    Object.freeze({
      syncRunId: 'tiktok-post-lark:watermark:b3677fbd2cba7a3e1853fa7689e4c17a8eb912b8f287d59f36271a8ae9fd45fd',
      workKey: 'tiktok:watermark:b3677fbd2cba7a3e1853fa7689e4c17a8eb912b8f287d59f36271a8ae9fd45fd',
      generation: 1786726826000,
      recordsWritten: 1039,
    }),
    Object.freeze({
      syncRunId: 'tiktok-post-lark:watermark:e3244f5ce64885a699ce544f7e2b7ffc8cf3d9714e1504e6597ff44ca2e59f04',
      workKey: 'tiktok:watermark:e3244f5ce64885a699ce544f7e2b7ffc8cf3d9714e1504e6597ff44ca2e59f04',
      generation: 1786777526000,
      recordsWritten: 651,
    }),
  ]),
  closureReference: 'resolved-by-new-generation:tiktok:2026-08-15:v1',
});

export const TIKTOK_RESOLVED_GENERATION_ALERTS = Object.freeze({
  current: TIKTOK_RESOLVED_GENERATION_ALERT,
  legacy: Object.freeze({
    alertId: '2bec4508-234b-4962-9c89-1037a5f2487d',
    syncRunId: 'tiktok-post-lark:watermark:67d86415c7a81f7ca30faf5753a6958d3b077d22fced23a1e4aae832dc180c05',
    workKey: 'tiktok:watermark:67d86415c7a81f7ca30faf5753a6958d3b077d22fced23a1e4aae832dc180c05',
    generation: 1786467646000,
    recordsWritten: 1038,
    newerGenerations: TIKTOK_RESOLVED_GENERATION_ALERT.newerGenerations,
    closureReference: 'resolved-by-new-generation:tiktok:2026-08-15:legacy-v1',
  }),
});

export const TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION =
  'RESOLVE_EXACT_TIKTOK_PARTIAL_WRITE_BY_VERIFIED_GENERATIONS';

export function assertTikTokResolvedGenerationAlertConfirmation(value) {
  if (value !== TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION) {
    throw closeoutError(
      'Exact TikTok alert closeout confirmation is missing',
      'TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildTikTokResolvedGenerationAlertEvidenceSql(incident = TIKTOK_RESOLVED_GENERATION_ALERT) {
  const [newerOne, newerTwo] = incident.newerGenerations;
  return compactSql(`
    SELECT
      (SELECT status FROM system_alerts WHERE alert_id='${incident.alertId}') AS alert_status,
      (SELECT platform FROM system_alerts WHERE alert_id='${incident.alertId}') AS alert_platform,
      (SELECT alert_type FROM system_alerts WHERE alert_id='${incident.alertId}') AS alert_type,
      (SELECT error_code FROM system_alerts WHERE alert_id='${incident.alertId}') AS alert_error_code,
      (SELECT sync_run_id FROM system_alerts WHERE alert_id='${incident.alertId}') AS alert_sync_run_id,
      (SELECT json_extract(details_json,'$.closure.reference') FROM system_alerts WHERE alert_id='${incident.alertId}') AS closure_reference,
      (SELECT status FROM sync_runs WHERE sync_run_id='${incident.syncRunId}') AS incident_sync_status,
      (SELECT records_written FROM sync_runs WHERE sync_run_id='${incident.syncRunId}') AS incident_records_written,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${incident.workKey}') AS incident_work_status,
      (SELECT generation FROM sync_work_runs WHERE work_key='${incident.workKey}') AS incident_generation,
      (SELECT status FROM sync_runs WHERE sync_run_id='${newerOne.syncRunId}') AS newer_one_sync_status,
      (SELECT records_written FROM sync_runs WHERE sync_run_id='${newerOne.syncRunId}') AS newer_one_records_written,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${newerOne.workKey}') AS newer_one_work_status,
      (SELECT generation FROM sync_work_runs WHERE work_key='${newerOne.workKey}') AS newer_one_generation,
      (SELECT status FROM sync_runs WHERE sync_run_id='${newerTwo.syncRunId}') AS newer_two_sync_status,
      (SELECT records_written FROM sync_runs WHERE sync_run_id='${newerTwo.syncRunId}') AS newer_two_records_written,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${newerTwo.workKey}') AS newer_two_work_status,
      (SELECT generation FROM sync_work_runs WHERE work_key='${newerTwo.workKey}') AS newer_two_generation,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at>unixepoch('now')*1000 AND lock_key LIKE '%tiktok%') AS active_tiktok_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE status='open' AND created_at>1786692041000 AND (job_type LIKE 'tiktok.%' OR error_code LIKE 'TIKTOK_%')) AS current_tiktok_dlq;
  `);
}

export function validateTikTokResolvedGenerationAlertEvidence(row = {}, incident = TIKTOK_RESOLVED_GENERATION_ALERT) {
  const [newerOne, newerTwo] = incident.newerGenerations;
  const expected = {
    alert_platform: 'tiktok',
    alert_type: 'sync_partial_write',
    alert_error_code: 'SYNC_PARTIAL_WRITE',
    alert_sync_run_id: incident.syncRunId,
    incident_sync_status: 'success',
    incident_records_written: incident.recordsWritten,
    incident_work_status: 'completed',
    incident_generation: incident.generation,
    newer_one_sync_status: 'success',
    newer_one_records_written: newerOne.recordsWritten,
    newer_one_work_status: 'completed',
    newer_one_generation: newerOne.generation,
    newer_two_sync_status: 'success',
    newer_two_records_written: newerTwo.recordsWritten,
    newer_two_work_status: 'completed',
    newer_two_generation: newerTwo.generation,
    active_tiktok_locks: 0,
    current_tiktok_dlq: 0,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (normalize(row[field]) !== normalize(value)) {
      throw closeoutError(
        `TikTok resolved-generation evidence mismatch: ${field}`,
        'TIKTOK_RESOLVED_GENERATION_ALERT_EVIDENCE_MISMATCH',
        { field, expected: value, actual: row[field] ?? null },
      );
    }
  }
  if (row.alert_status === 'resolved') {
    if (row.closure_reference !== incident.closureReference) {
      throw closeoutError(
        'Resolved TikTok alert has an unexpected closure reference',
        'TIKTOK_RESOLVED_GENERATION_ALERT_CLOSURE_DRIFT',
      );
    }
    return Object.freeze({ alreadyResolved: true });
  }
  if (row.alert_status !== 'open') {
    throw closeoutError(
      'TikTok alert is not open or already resolved by this contract',
      'TIKTOK_RESOLVED_GENERATION_ALERT_STATUS_INVALID',
      { status: row.alert_status ?? null },
    );
  }
  return Object.freeze({ alreadyResolved: false });
}

export function buildTikTokResolvedGenerationAlertClosureSql(now = Date.now(), incident = TIKTOK_RESOLVED_GENERATION_ALERT) {
  const updatedAt = requireTimestamp(now);
  const [newerOne, newerTwo] = incident.newerGenerations;
  return compactSql(`
    UPDATE system_alerts
    SET status='resolved',
        details_json=json_set(
          details_json,
          '$.closure.classification','resolved_by_new_generation',
          '$.closure.reference','${incident.closureReference}',
          '$.closure.resolvedAt',${updatedAt},
          '$.closure.newerGenerationCount',${incident.newerGenerations.length}
        ),
        updated_at=${updatedAt}
    WHERE alert_id='${incident.alertId}'
      AND platform='tiktok'
      AND alert_type='sync_partial_write'
      AND error_code='SYNC_PARTIAL_WRITE'
      AND sync_run_id='${incident.syncRunId}'
      AND status='open'
      AND EXISTS (
        SELECT 1 FROM sync_runs
        WHERE sync_run_id='${incident.syncRunId}'
          AND status='success'
          AND records_written=${incident.recordsWritten}
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_runs
        WHERE work_key='${incident.workKey}'
          AND lifecycle_status='completed'
          AND generation=${incident.generation}
      )
      AND EXISTS (
        SELECT 1 FROM sync_runs
        WHERE sync_run_id='${newerOne.syncRunId}'
          AND status='success'
          AND records_written=${newerOne.recordsWritten}
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_runs
        WHERE work_key='${newerOne.workKey}'
          AND lifecycle_status='completed'
          AND generation=${newerOne.generation}
      )
      AND EXISTS (
        SELECT 1 FROM sync_runs
        WHERE sync_run_id='${newerTwo.syncRunId}'
          AND status='success'
          AND records_written=${newerTwo.recordsWritten}
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_runs
        WHERE work_key='${newerTwo.workKey}'
          AND lifecycle_status='completed'
          AND generation=${newerTwo.generation}
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks
        WHERE expires_at>unixepoch('now')*1000 AND lock_key LIKE '%tiktok%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM dead_letter_jobs
        WHERE status='open'
          AND created_at>1786692041000
          AND (job_type LIKE 'tiktok.%' OR error_code LIKE 'TIKTOK_%')
      );
    SELECT changes() AS resolved_alert_rows;
  `);
}

export function validateTikTokResolvedGenerationAlertClosureRow(row = {}) {
  if (Number(row.resolved_alert_rows) !== 1) {
    throw closeoutError(
      'Exact TikTok alert closeout did not update one row',
      'TIKTOK_RESOLVED_GENERATION_ALERT_UPDATE_MISMATCH',
      { resolvedAlertRows: Number(row.resolved_alert_rows ?? 0) },
    );
  }
  return Object.freeze({ resolvedAlertRows: 1 });
}

function requireTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('now must be a positive epoch');
  return number;
}

function normalize(value) {
  return typeof value === 'number' ? value : String(value ?? '');
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function closeoutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokResolvedGenerationAlertCloseoutError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
