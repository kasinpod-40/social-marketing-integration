import { getReportPlatformContract } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  resolveReportRuntimeCloseoutTarget as resolveLegacyTarget,
} from './report-runtime-closeout-operator.js';

export const REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS = Object.freeze([1, 3, 7, 30]);

const MULTIWINDOW_ACTIONS = new Set([
  'create_materialization',
  'refresh_or_repair_materialization',
  'reuse_or_idempotent_verify',
]);

export function resolveReviewedReportRuntimeCloseoutTarget(env = {}) {
  const platformScope = String(env.MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE ?? 'tiktok')
    .trim().toLowerCase();
  if (platformScope !== 'youtube') return resolveLegacyTarget(env);
  const contract = getReportPlatformContract('youtube');
  return Object.freeze({
    platformScope: contract.platformScope,
    accountKey: 'chemistry_k',
    formulaVersion: contract.formulaVersion,
    capability: contract.capability,
    activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    outputDirectory: 'outputs/youtube-report-runtime-closeout',
    reviewedHandoffRequired: true,
    multiwindowRequired: true,
  });
}

export function assertYouTubeReportRuntimeCloseoutPreflight(row = {}) {
  if (!['complete', 'partial', 'revisable', 'no_data_confirmed'].includes(String(row.coverage_status))
    || typeof row.source_watermark !== 'string'
    || row.source_watermark.trim() === ''
    || !/^\d{4}-\d{2}-\d{2}$/u.test(String(row.period_end ?? ''))
    || Number(row.content_state_count ?? 0) <= 0
    || Number(row.observation_count ?? 0) <= 0
    || Number(row.active_report_locks ?? 0) !== 0
    || Number(row.open_report_dlq ?? 0) !== 0) throw bindingError(
    'YouTube D1 historical facts are not ready for Report closeout materialization',
    'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY',
    {
      platformScope: 'youtube',
      coverageStatus: row.coverage_status ?? null,
      contentStateCount: Number(row.content_state_count ?? 0),
      observationCount: Number(row.observation_count ?? 0),
      activeReportLocks: Number(row.active_report_locks ?? 0),
      openReportDlq: Number(row.open_report_dlq ?? 0),
    },
  );
  return true;
}

export function buildReportRuntimeMultiwindowExecutionPlan(
  candidates,
  existingReportIds = [],
  reviewedWindows = [],
) {
  if (!Array.isArray(candidates) || !Array.isArray(reviewedWindows)) throw bindingError(
    'Report multiwindow execution requires exact candidates and reviewed actions',
    'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_CANDIDATE_INVALID',
  );
  const candidatesByWindow = new Map();
  for (const row of candidates) {
    const windowDays = Number(row?.windowDays);
    if (!REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS.includes(windowDays)) continue;
    if (candidatesByWindow.has(windowDays)) throw bindingError(
      'Report multiwindow execution received duplicate candidate windows',
      'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_CANDIDATE_INVALID',
      { windowDays },
    );
    candidatesByWindow.set(windowDays, row);
  }
  const actionsByWindow = new Map();
  for (const row of reviewedWindows) {
    const windowDays = Number(row?.windowDays);
    if (!REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS.includes(windowDays)
      || actionsByWindow.has(windowDays)
      || !MULTIWINDOW_ACTIONS.has(row?.action)) throw bindingError(
      'Report multiwindow execution requires one reviewed action for each window',
      'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_ACTION_INVALID',
      { windowDays, action: row?.action ?? null },
    );
    actionsByWindow.set(windowDays, row.action);
  }
  const ordered = REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS;
  if (ordered.some((windowDays) => !candidatesByWindow.has(windowDays) || !actionsByWindow.has(windowDays))) {
    throw bindingError(
      'Report multiwindow execution requires exact 1/3/7/30 candidates and actions',
      'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_ACTION_INVALID',
    );
  }
  const existing = new Set(existingReportIds.map(String));
  return Object.freeze(ordered.map((windowDays) => {
    const candidate = candidatesByWindow.get(windowDays);
    const action = actionsByWindow.get(windowDays);
    const exists = existing.has(candidate.reportId);
    if ((action === 'create_materialization' && exists)
      || (action !== 'create_materialization' && !exists)) throw bindingError(
      `Reviewed Report target prestate is invalid: ${windowDays}D`,
      'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_PRESTATE_INVALID',
      { windowDays, action, exists },
    );
    const operation = action === 'create_materialization'
      ? 'fresh'
      : action === 'refresh_or_repair_materialization'
        ? 'refresh'
        : 'verify';
    return Object.freeze({ ...candidate, action, operation });
  }));
}

function bindingError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutChannelBindingError';
  error.code = code;
  error.details = details;
  return error;
}
