import { getReportPlatformContract } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import { getReportLiveClosureDescriptor } from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  resolveReportRuntimeCloseoutTarget as resolveLegacyTarget,
} from './report-runtime-closeout-operator.js';

export const REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS = Object.freeze([1, 3, 7, 30]);
export const REPORT_RUNTIME_REVIEWED_CHANNELS = Object.freeze([
  'facebook',
  'instagram',
  'youtube',
  'woocommerce',
  'chatwoot',
]);

const REVIEWED_CHANNEL_SET = new Set(REPORT_RUNTIME_REVIEWED_CHANNELS);
const MULTIWINDOW_ACTIONS = new Set([
  'create_materialization',
  'refresh_or_repair_materialization',
  'reuse_or_idempotent_verify',
]);
const COVERAGE_STATUSES = new Set(['complete', 'partial', 'revisable', 'no_data_confirmed']);
const COMMERCE_COVERAGE_SCOPES = new Set(['full_inventory', 'recent_window', 'report_range']);

export function resolveReviewedReportRuntimeCloseoutTarget(env = {}) {
  const platformScope = String(env.MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE ?? 'youtube')
    .trim().toLowerCase();
  if (platformScope === 'tiktok') return resolveLegacyTarget(env);
  if (!REVIEWED_CHANNEL_SET.has(platformScope)) throw bindingError(
    `Unsupported reviewed Report closeout platform: ${platformScope}`,
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_PLATFORM_UNSUPPORTED',
    { platformScope, supportedPlatforms: REPORT_RUNTIME_REVIEWED_CHANNELS },
  );
  const contract = getReportPlatformContract(platformScope);
  const descriptor = getReportLiveClosureDescriptor(contract.platformScope, contract.capability);
  return Object.freeze({
    platformScope: contract.platformScope,
    accountKey: 'chemistry_k',
    formulaVersion: contract.formulaVersion,
    capability: contract.capability,
    datasetKey: contract.datasetKey,
    activeTrueFlags: descriptor.safeRuntimeFlags,
    requiredLarkOutputs: descriptor.requiredLarkOutputs,
    outputDirectory: `outputs/${contract.platformScope}-report-runtime-closeout`,
    reviewedHandoffRequired: true,
    multiwindowRequired: true,
  });
}

export function assertReviewedReportRuntimeCloseoutPreflight(row = {}, target = {}) {
  const platformScope = requireReviewedPlatform(target.platformScope);
  const capability = getReportPlatformContract(platformScope).capability;
  const coverageStatus = String(row.coverage_status ?? '').trim().toLowerCase();
  const coveredEmpty = coverageStatus === 'no_data_confirmed';
  const commonReady = COVERAGE_STATUSES.has(coverageStatus)
    && typeof row.source_watermark === 'string'
    && row.source_watermark.trim() !== ''
    && /^\d{4}-\d{2}-\d{2}$/u.test(String(row.period_end ?? ''))
    && Number(row.active_report_work_count ?? 0) === 0
    && Number(row.active_report_locks ?? 0) === 0
    && Number(row.open_report_dlq ?? 0) === 0
    && Number(row.open_report_critical_alerts ?? 0) === 0;

  let sourceReady = false;
  if (capability === 'organic') {
    sourceReady = coveredEmpty || (
      Number(row.content_state_count ?? 0) > 0
      && Number(row.observation_count ?? 0) > 0
    );
  } else if (capability === 'commerce') {
    sourceReady = COMMERCE_COVERAGE_SCOPES.has(String(row.coverage_scope_mode ?? ''))
      && (coveredEmpty || (
        Number(row.daily_fact_count ?? 0) > 0
        && Number(row.order_state_count ?? 0) > 0
      ));
  } else if (capability === 'customer_service') {
    sourceReady = coveredEmpty || (
      Number(row.conversation_fact_count ?? 0) > 0
      && Number(row.account_fact_count ?? 0) > 0
    );
  }

  if (!commonReady || !sourceReady) throw bindingError(
    `${platformScope} D1 facts are not ready for Report closeout materialization`,
    'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY',
    {
      platformScope,
      capability,
      coverageStatus: coverageStatus || null,
      coverageScopeMode: row.coverage_scope_mode ?? null,
      contentStateCount: Number(row.content_state_count ?? 0),
      observationCount: Number(row.observation_count ?? 0),
      dailyFactCount: Number(row.daily_fact_count ?? 0),
      orderStateCount: Number(row.order_state_count ?? 0),
      conversationFactCount: Number(row.conversation_fact_count ?? 0),
      accountFactCount: Number(row.account_fact_count ?? 0),
      activeReportWorkCount: Number(row.active_report_work_count ?? 0),
      activeReportLocks: Number(row.active_report_locks ?? 0),
      openReportDlq: Number(row.open_report_dlq ?? 0),
      openReportCriticalAlerts: Number(row.open_report_critical_alerts ?? 0),
    },
  );
  return true;
}

/** Backward-compatible alias retained for existing YouTube-focused tests and evidence. */
export function assertYouTubeReportRuntimeCloseoutPreflight(row = {}) {
  return assertReviewedReportRuntimeCloseoutPreflight(row, { platformScope: 'youtube' });
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

function requireReviewedPlatform(value) {
  const platformScope = String(value ?? '').trim().toLowerCase();
  if (!REVIEWED_CHANNEL_SET.has(platformScope)) throw bindingError(
    'Reviewed Report closeout target is unsupported',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_PLATFORM_UNSUPPORTED',
    { platformScope },
  );
  return platformScope;
}

function bindingError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutChannelBindingError';
  error.code = code;
  error.details = details;
  return error;
}
