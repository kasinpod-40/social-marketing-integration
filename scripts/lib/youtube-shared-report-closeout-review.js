import {
  REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  buildReportRuntimeCloseoutCandidates,
} from './report-runtime-closeout-operator.js';
import {
  assertYouTubeReportRuntimeCloseoutPreflight,
  resolveReviewedReportRuntimeCloseoutTarget,
} from './report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimeOrganicPreflightSql,
  buildReviewedReportRuntimeMultiwindowPlan,
} from './report-runtime-closeout-reviewed-binding.js';
import {
  REPORT_LIVE_CLOSURE_WINDOWS,
  getReportLiveClosureDescriptor,
} from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  assertReviewedReportLiveClosureHandoff,
  sanitizeReportLiveClosureEvidence,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';

export const YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONTRACT =
  'youtube_shared_report_closeout_review_v2';

const REVIEWED_ACTIONS = new Set([
  'create_materialization',
  'refresh_or_repair_materialization',
  'reuse_or_idempotent_verify',
]);

export function reviewYouTubeSharedReportCloseoutOperator(input = {}) {
  const handoff = requireObject(input.handoff, 'handoff');
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const repository = requireObject(handoff.repository, 'handoff.repository');
  assertReviewedReportLiveClosureHandoff(handoff, { descriptor, repository });

  const readiness = requireObject(handoff.youtubeReadiness, 'handoff.youtubeReadiness');
  const evidence = requireObject(readiness.evidence, 'handoff.youtubeReadiness.evidence');
  const source = requireObject(evidence.source, 'handoff.youtubeReadiness.evidence.source');
  const runtime = requireObject(evidence.runtime, 'handoff.youtubeReadiness.evidence.runtime');
  const assessment = requireObject(readiness.assessment, 'handoff.youtubeReadiness.assessment');
  const reviewedWindows = normalizeReviewedWindows(assessment.windows);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const periodEnd = requireDate(source.watermarkDate, 'source.watermarkDate');
  const sourceWatermark = optionalText(source.sourceWatermark);
  const blockers = [];

  if (!sourceWatermark) blockers.push(blocker(
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_SOURCE_WATERMARK_MISSING',
    'The retained collector evidence must contain exact Coverage source_watermark.',
  ));

  const target = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'youtube',
  });
  if (target.platformScope !== 'youtube'
    || target.capability !== 'organic'
    || target.formulaVersion !== descriptor.formulaVersion
    || target.reviewedHandoffRequired !== true
    || target.multiwindowRequired !== true) blockers.push(blocker(
    'REPORT_RUNTIME_CLOSEOUT_YOUTUBE_TARGET_SELECTOR_INVALID',
    'The shared target selector does not expose the reviewed YouTube Organic contract.',
  ));

  const preflightSql = buildReportRuntimeOrganicPreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  });
  if (!preflightSql.includes("platform = 'youtube'")
    || !preflightSql.includes("dataset_key = 'organic_content_cumulative'")) blockers.push(blocker(
    'REPORT_RUNTIME_CLOSEOUT_YOUTUBE_D1_PREFLIGHT_INVALID',
    'The shared Organic preflight is not bound to YouTube Coverage and facts.',
  ));

  const expectedCoverageCount = target.requiredCoverageDatasetKeys.length;
  const preflight = Object.freeze({
    coverage_status: normalizeCoverageStatus(source.contentCoverageStatus),
    coverage_required_count: expectedCoverageCount,
    coverage_watermark_count: sourceWatermark ? expectedCoverageCount : 0,
    source_scope: 'content',
    source_watermark: sourceWatermark ?? '',
    period_end: periodEnd,
    content_state_count: nonNegativeInteger(source.contentStateCount, 'source.contentStateCount'),
    observation_count: nonNegativeInteger(source.observationCount, 'source.observationCount'),
    active_report_work_count: nonNegativeInteger(
      runtime.activeReportWorkCount,
      'runtime.activeReportWorkCount',
    ),
    active_report_locks: nonNegativeInteger(runtime.activeReportLockCount, 'runtime.activeReportLockCount'),
    open_report_dlq: nonNegativeInteger(runtime.openReportDlqCount, 'runtime.openReportDlqCount'),
    open_report_critical_alerts: nonNegativeInteger(
      runtime.openReportCriticalAlertCount,
      'runtime.openReportCriticalAlertCount',
    ),
  });
  if (sourceWatermark) assertYouTubeReportRuntimeCloseoutPreflight(preflight);

  const candidates = sourceWatermark
    ? Object.freeze(buildReportRuntimeCloseoutCandidates({
      requestedAt,
      periodEnd,
      sourceWatermark,
      timeZone: requireExact(
        source.reportingTimezone ?? 'Asia/Bangkok',
        'Asia/Bangkok',
        'source.reportingTimezone',
      ),
      platformScope: 'youtube',
      accountKey: target.accountKey,
      formulaVersion: descriptor.formulaVersion,
    }).filter((candidate) => REPORT_LIVE_CLOSURE_WINDOWS.includes(candidate.windowDays)))
    : Object.freeze([]);

  let executionPlan = Object.freeze([]);
  if (candidates.length === REPORT_LIVE_CLOSURE_WINDOWS.length) {
    const existingReportIds = candidates
      .filter((candidate) => reviewedWindows.find((row) => row.windowDays === candidate.windowDays)?.action
        !== 'create_materialization')
      .map((candidate) => candidate.reportId);
    executionPlan = buildReviewedReportRuntimeMultiwindowPlan({
      candidates,
      existingReportIds,
      reviewedHandoff: handoff,
    });
  }

  const exactPlan = executionPlan.length === REPORT_LIVE_CLOSURE_WINDOWS.length
    && executionPlan.every((row, index) => row.windowDays === REPORT_LIVE_CLOSURE_WINDOWS[index]);
  if (sourceWatermark && !exactPlan) blockers.push(blocker(
    'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_PLAN_INVALID',
    'The shared operator did not build the exact reviewed 1/3/7/30 execution plan.',
  ));

  const result = {
    ok: true,
    contractVersion: YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONTRACT,
    sharedOperatorContractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    platformScope: 'youtube',
    capability: 'organic',
    contractCompatible: sourceWatermark !== null
      && reviewedWindows.length === REPORT_LIVE_CLOSURE_WINDOWS.length
      && candidates.length === REPORT_LIVE_CLOSURE_WINDOWS.length,
    executableReady: blockers.length === 0,
    reviewStatus: blockers.length === 0
      ? 'READY_FOR_RETAINED_HANDOFF_EXECUTION'
      : 'OPERATOR_EXTENSION_REQUIRED',
    existingAuthorities: Object.freeze({
      activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
      requiredLarkOutputs: Object.freeze(Object.keys(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES)),
      identityAuthority: 'buildReportRuntimeCloseoutCandidates',
      d1PreflightAuthority: 'buildReportRuntimeOrganicPreflightSql',
      handoffAuthority: 'loadReviewedReportRuntimeCloseoutHandoff',
      multiwindowAuthority: 'buildReviewedReportRuntimeMultiwindowPlan',
      metricIntegrityAuthority: 'assertReportRuntimeMetricIntegrity',
      replayAuthority: 'assertReportRuntimeCloseoutReplay',
      restoreAuthority: 'reviewed multiwindow executor finally',
    }),
    reviewedWindows,
    candidateWindows: Object.freeze(candidates.map((candidate) => Object.freeze({
      windowDays: candidate.windowDays,
      reportSettingKey: candidate.reportSettingKey,
      reportId: candidate.reportId,
    }))),
    executionPlan: Object.freeze(executionPlan.map((row) => Object.freeze({
      windowDays: row.windowDays,
      action: row.action,
      operation: row.operation,
      reportSettingKey: row.reportSettingKey,
      reportId: row.reportId,
    }))),
    blockers: Object.freeze(blockers),
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  };
  return Object.freeze(sanitizeReportLiveClosureEvidence(result));
}

function normalizeReviewedWindows(value) {
  if (!Array.isArray(value)) throw reviewError(
    'Reviewed readiness windows must be an array',
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field: 'assessment.windows' },
  );
  const indexed = new Map();
  for (const row of value) {
    const windowDays = positiveInteger(row?.windowDays, 'assessment.windows.windowDays');
    if (!REPORT_LIVE_CLOSURE_WINDOWS.includes(windowDays)
      || indexed.has(windowDays)
      || !REVIEWED_ACTIONS.has(row?.action)) throw reviewError(
      'Reviewed readiness windows must contain exact 1/3/7/30 actions',
      'YOUTUBE_SHARED_REPORT_CLOSEOUT_WINDOWS_INVALID',
      { windowDays, action: row?.action ?? null },
    );
    indexed.set(windowDays, Object.freeze({ windowDays, action: row.action }));
  }
  const ordered = REPORT_LIVE_CLOSURE_WINDOWS.map((windowDays) => indexed.get(windowDays));
  if (ordered.some((row) => !row)) throw reviewError(
    'Reviewed readiness windows must contain exact 1/3/7/30 actions',
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_WINDOWS_INVALID',
  );
  return Object.freeze(ordered);
}

function blocker(code, message) { return Object.freeze({ code, message }); }
function normalizeCoverageStatus(value) {
  const normalized = optionalText(value)?.toLowerCase() ?? null;
  return normalized === 'completed' ? 'complete' : normalized;
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireExact(value, expected, field) {
  const text = optionalText(value);
  if (text !== expected) throw reviewError(
    `${field} must equal ${expected}`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field, expected, observed: text },
  );
  return text;
}
function requireDate(value, field) {
  const text = optionalText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw reviewError(
    `${field} must be YYYY-MM-DD`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return text;
}
function requireTimestamp(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw reviewError(
    `${field} must be an epoch millisecond`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return number;
}
function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw reviewError(
    `${field} must be a non-negative integer`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return number;
}
function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw reviewError(
    `${field} must be a positive integer`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return number;
}
function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw reviewError(
    `${field} must be an object`,
    'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_INPUT_INVALID',
    { field },
  );
  return value;
}
function reviewError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeSharedReportCloseoutReviewError';
  error.code = code;
  error.details = details;
  return error;
}
