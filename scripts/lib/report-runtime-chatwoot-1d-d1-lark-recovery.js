import { closeoutFailure } from './report-runtime-closeout-reviewed-process.js';
import { CHATWOOT_1D_EXACT_INCIDENT } from './report-runtime-chatwoot-1d-incident-continuation.js';

export const CHATWOOT_1D_D1_LARK_RECOVERY_CONTRACT =
  'report_runtime_chatwoot_1d_d1_complete_lark_incomplete_recovery_v1';
export const CHATWOOT_1D_D1_LARK_RECOVERY_CONFIRMATION =
  'RECOVER_EXACT_CHATWOOT_1D_D1_COMPLETE_LARK_INCOMPLETE';

export function assertChatwoot1dD1LarkRecoveryPrestate(
  input = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  if (d1.report_id !== incident.reportId
    || Number(d1.materialization_count ?? 0) !== 1
    || d1.sync_status !== incident.failedSync.status
    || Number(d1.successful_sync_count ?? 0) !== 0
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(d1.new_dlq_count ?? 0) !== 1
    || !hasText(d1.payload_checksum)
    || Number(lark.snapshots ?? 0) !== 0
    || Number(lark.metrics ?? 0) !== 0
    || Number(lark.topContent ?? 0) !== 0
    || Number(lark.topAds ?? 0) !== 0
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) {
    throw recoveryFailure(
      'Chatwoot 1D target is not the exact D1-complete / Lark-incomplete incident state',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_PRESTATE_MISMATCH',
      {
        reportIdMatched: d1.report_id === incident.reportId,
        materializationCount: Number(d1.materialization_count ?? 0),
        syncStatus: d1.sync_status ?? null,
        successfulSyncCount: Number(d1.successful_sync_count ?? 0),
        activeLockCount: Number(d1.active_lock_count ?? 0),
        newDlqCount: Number(d1.new_dlq_count ?? 0),
        payloadChecksumPresent: hasText(d1.payload_checksum),
        larkSnapshots: Number(lark.snapshots ?? 0),
        larkMetrics: Number(lark.metrics ?? 0),
        larkTopContent: Number(lark.topContent ?? 0),
        larkTopAds: Number(lark.topAds ?? 0),
        duplicateMetricKeys: Number(lark.duplicateMetricKeys ?? 0),
      },
    );
  }
  return true;
}

export function assertChatwoot1dD1LarkRecoveryWriteResult(
  result = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const rows = result.rows ?? {};
  if (Number(rows.snapshots ?? -1) !== 1
    || Number(rows.metrics ?? -1) !== incident.expectedMetricCount
    || Number(rows.topContent ?? -1) !== 0
    || Number(rows.topAds ?? -1) !== 0) {
    throw recoveryFailure(
      'Shared Lark writer did not emit the exact Chatwoot 1D row contract',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_WRITE_RESULT_INVALID',
      {
        snapshots: Number(rows.snapshots ?? -1),
        metrics: Number(rows.metrics ?? -1),
        topContent: Number(rows.topContent ?? -1),
        topAds: Number(rows.topAds ?? -1),
      },
    );
  }
  return true;
}

export function assertChatwoot1dD1LarkRecoveredState(
  input = {},
  incident = CHATWOOT_1D_EXACT_INCIDENT,
) {
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  if (d1.report_id !== incident.reportId
    || Number(d1.materialization_count ?? 0) !== 1
    || d1.sync_status !== incident.failedSync.status
    || Number(d1.successful_sync_count ?? 0) !== 0
    || Number(d1.active_lock_count ?? 0) !== 0
    || Number(lark.snapshots ?? 0) !== 1
    || Number(lark.metrics ?? 0) !== incident.expectedMetricCount
    || Number(lark.topContent ?? 0) !== 0
    || Number(lark.topAds ?? 0) !== 0
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) {
    throw recoveryFailure(
      'Chatwoot 1D direct Lark recovery did not reach the exact materialized state',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_RESULT_MISMATCH',
      {
        reportIdMatched: d1.report_id === incident.reportId,
        materializationCount: Number(d1.materialization_count ?? 0),
        syncStatus: d1.sync_status ?? null,
        successfulSyncCount: Number(d1.successful_sync_count ?? 0),
        activeLockCount: Number(d1.active_lock_count ?? 0),
        larkSnapshots: Number(lark.snapshots ?? 0),
        larkMetrics: Number(lark.metrics ?? 0),
        larkTopContent: Number(lark.topContent ?? 0),
        larkTopAds: Number(lark.topAds ?? 0),
        duplicateMetricKeys: Number(lark.duplicateMetricKeys ?? 0),
      },
    );
  }
  return true;
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function recoveryFailure(message, code, details = {}) {
  return closeoutFailure(message, code, details);
}
