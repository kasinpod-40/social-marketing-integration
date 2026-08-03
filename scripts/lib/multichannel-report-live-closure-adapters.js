import { getReportPlatformContract } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  REPORT_LIVE_CLOSURE_WINDOWS,
} from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  buildReportRuntimeCloseoutCandidates,
  safeReportRuntimeCloseoutEvidence,
} from './report-runtime-closeout-operator.js';

/**
 * Bind the generic planning framework to the merged reviewed authorities. This adapter does not
 * perform Provider, Queue, D1, Lark or Worker mutation. The public YouTube collector remains the
 * only source of Remote readiness evidence and the existing closeout candidate builder remains the
 * only Report identity authority.
 */
export function createReportLiveClosurePlanAdapters(input = {}) {
  const descriptor = requireObject(input.descriptor, 'descriptor');
  const target = requireObject(input.target, 'target');
  const reviewedReadiness = requireObject(input.reviewedReadiness, 'reviewedReadiness');
  const evidence = requireObject(reviewedReadiness.evidence, 'reviewedReadiness.evidence');
  const assessment = requireObject(reviewedReadiness.assessment, 'reviewedReadiness.assessment');
  const sourceContract = descriptor.structuralOnly ? null : getReportPlatformContract(descriptor.platform);
  if (sourceContract && sourceContract.capability !== descriptor.capability) throw bindingError(
    'Descriptor capability diverges from the shared Report platform registry',
    'REPORT_LIVE_CLOSURE_PLATFORM_CONTRACT_DRIFT',
  );
  if (evidence.target?.platformScope !== descriptor.platform
    || evidence.target?.customerProfile !== target.customerProfile
    || evidence.target?.accountKey !== target.customerKey) throw bindingError(
    'Reviewed readiness evidence target does not match the closure target',
    'REPORT_LIVE_CLOSURE_READINESS_TARGET_MISMATCH',
  );
  const candidateInput = Object.freeze({
    requestedAt: requireTimestamp(input.requestedAt, 'requestedAt'),
    periodEnd: requireDate(input.periodEnd, 'periodEnd'),
    sourceWatermark: requireText(input.sourceWatermark, 'sourceWatermark'),
    timeZone: requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone'),
    platformScope: descriptor.platform,
    accountKey: target.customerKey,
    formulaVersion: descriptor.formulaVersion,
  });

  return Object.freeze({
    repositoryGate: binding('repositoryGate', async () => Object.freeze({
      ok: true,
      branch: evidence.repository?.branch,
      head: evidence.repository?.head,
      reviewedHead: evidence.repository?.reviewedHead,
      clean: evidence.repository?.clean === true,
    })),
    runtimeGate: binding('runtimeGate', async () => Object.freeze({
      ok: true,
      allExecutionFlagsFalse: evidence.runtime?.allExecutionFlagsFalse === true,
      activeReportWorkCount: Number(evidence.runtime?.activeReportWorkCount ?? -1),
      activeReportLockCount: Number(evidence.runtime?.activeReportLockCount ?? -1),
      openReportDlqCount: Number(evidence.runtime?.openReportDlqCount ?? -1),
      openReportCriticalAlertCount: Number(evidence.runtime?.openReportCriticalAlertCount ?? -1),
    })),
    sourceReadiness: binding('sourceReadiness', async () => Object.freeze({
      ok: true,
      ready: assessment.sourceReady === true,
      platform: descriptor.platform,
      capability: descriptor.capability,
      sourceStatus: sourceContract?.sourceStatus ?? descriptor.sourceStatus,
      sourceEntityCount: Number(evidence.source?.contentEntityCount ?? 0),
      watermarkDate: evidence.source?.watermarkDate ?? null,
    })),
    coverageValidation: binding('coverageValidation', async () => Object.freeze({
      ok: true,
      status: normalizeCoverageStatus(evidence.source?.contentCoverageStatus),
      failureCount: Number(evidence.source?.failureCount ?? -1),
      authority: descriptor.coverageAuthority,
    })),
    identityPlanning: binding('identityPlanning', async () => Object.freeze({
      ok: true,
      candidates: Object.freeze(buildReportRuntimeCloseoutCandidates(candidateInput)
        .filter((candidate) => REPORT_LIVE_CLOSURE_WINDOWS.includes(candidate.windowDays))),
      authority: 'buildReportRuntimeCloseoutCandidates',
    })),
    materializationPlan: binding('materializationPlan', async () => Object.freeze({
      ok: true,
      windows: Object.freeze((assessment.windows ?? [])
        .filter((window) => REPORT_LIVE_CLOSURE_WINDOWS.includes(Number(window.windowDays)))
        .map((window) => Object.freeze({
          windowDays: Number(window.windowDays),
          action: window.action,
        }))),
      authority: 'report_materializations',
    })),
    sanitize: safeReportRuntimeCloseoutEvidence,
  });
}

function binding(key, run) {
  return Object.freeze({
    authority: REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES[key],
    run,
  });
}

function normalizeCoverageStatus(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'completed' ? 'complete' : normalized;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bindingError(
    `${field} must be an object`,
    'REPORT_LIVE_CLOSURE_BINDING_INPUT_INVALID',
    { field },
  );
  return value;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw bindingError(
    `${field} is required`,
    'REPORT_LIVE_CLOSURE_BINDING_INPUT_INVALID',
    { field },
  );
  return value.trim();
}
function requireDate(value, field) {
  const text = requireText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw bindingError(
    `${field} must be YYYY-MM-DD`,
    'REPORT_LIVE_CLOSURE_BINDING_INPUT_INVALID',
    { field },
  );
  return text;
}
function requireTimestamp(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw bindingError(
    `${field} must be an epoch millisecond`,
    'REPORT_LIVE_CLOSURE_BINDING_INPUT_INVALID',
    { field },
  );
  return number;
}
function bindingError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLiveClosureBindingError';
  error.code = code;
  error.details = details;
  return error;
}
