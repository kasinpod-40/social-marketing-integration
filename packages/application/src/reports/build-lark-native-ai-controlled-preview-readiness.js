import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_OUTPUT_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_PLAN_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_PROMPT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE,
} from '../../../config/src/lark-native-ai-controlled-preview-contract.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';
import { buildLarkNativeAiOfflineBundle } from './build-lark-native-ai-offline-bundle.js';
import {
  buildLarkNativeAiOfflinePrompt,
  renderLarkNativeAiOfflinePreview,
} from './render-lark-native-ai-offline-preview.js';
import { validateLarkNativeAiOfflineOutput } from './validate-lark-native-ai-offline-output.js';
import {
  buildLarkNativeAiControlledPreviewRows,
  validateLarkNativeAiControlledPreviewRows,
} from './build-lark-native-ai-controlled-preview-rows.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const TIKTOK_HIGH_COVERAGE_PARTIAL_MIN_RATE = 0.99;
const TIKTOK_PARTIAL_RATE_TOLERANCE = 0.0001;
const TIKTOK_CURRENT_TOTAL_METRIC_KEYS = Object.freeze([
  'tiktok:latest_total_views',
  'tiktok:latest_total_likes',
  'tiktok:latest_total_comments',
  'tiktok:latest_total_shares',
  'tiktok:latest_total_engagement',
  'tiktok:latest_engagement_rate',
]);
const TIKTOK_PERIOD_DELTA_METRIC_KEYS = Object.freeze([
  'tiktok:period_views',
  'tiktok:period_likes',
  'tiktok:period_comments',
  'tiktok:period_shares',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
]);
const TIKTOK_DATA_QUALITY_METRIC_KEYS = Object.freeze([
  'tiktok:new_content_count',
  'tiktok:tracked_content_count',
  'tiktok:baseline_covered_content_count',
  'tiktok:baseline_missing_content_count',
  'tiktok:baseline_coverage_rate',
]);
const TIKTOK_PERIOD_DELTA_METRIC_KEY_SET = new Set(TIKTOK_PERIOD_DELTA_METRIC_KEYS);

export async function buildLarkNativeAiControlledPreviewReadiness(input = {}) {
  const offlineInput = requireObject(input.offlineInput ?? input.offline_input, 'offlineInput');
  const bundle = await buildLarkNativeAiOfflineBundle(offlineInput);
  const prompt = buildLarkNativeAiOfflinePrompt(bundle);
  const referenceOutput = renderLarkNativeAiOfflinePreview(bundle);
  const validation = validateLarkNativeAiOfflineOutput(bundle, referenceOutput);
  const repository = normalizeRepository(input.repository);
  const schemaAuthority = normalizeSchemaAuthority(input.schemaAuthority ?? input.schema_authority);
  const remoteAuthority = normalizeRemoteAuthority(input.remoteAuthority ?? input.remote_authority);
  const approval = normalizeApproval(input.approval, repository.exactHeadSha);

  const promptBytes = bytes(prompt);
  const referenceOutputBytes = bytes(stableStringify(referenceOutput));
  const promptSha256 = await sha256Hex(prompt);
  const referenceOutputSha256 = await sha256Hex(stableStringify(referenceOutput));
  const runIdentity = Object.freeze({
    customerKey: bundle.customer.customerKey,
    scope: 'all_channels',
    windowDays: bundle.window.windowDays,
    periodStart: bundle.window.periodStart,
    periodEnd: bundle.window.periodEnd,
    comparisonMode: bundle.window.comparisonMode,
    promptVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_PROMPT_VERSION,
    outputSchemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_OUTPUT_SCHEMA_VERSION,
  });
  const previewRunKey = await sha256Hex(stableStringify(runIdentity));
  const rows = await buildLarkNativeAiControlledPreviewRows(bundle, previewRunKey);
  const goldenDataset = inspectGoldenDataset(bundle);
  const blockers = [
    ...inspectRepository(repository),
    ...inspectSchema(schemaAuthority),
    ...inspectRemote(remoteAuthority),
    ...goldenDataset.blockers,
    ...inspectPrompt(prompt, promptBytes),
    ...inspectReferenceOutput(validation, referenceOutputBytes),
    ...validateLarkNativeAiControlledPreviewRows(rows),
    ...inspectApproval(approval, repository),
  ];
  const evidenceChecksum = await sha256Hex(stableStringify({
    bundleId: bundle.bundleId,
    promptSha256,
    referenceOutputSha256,
    schemaEvidenceSha256: schemaAuthority.evidenceSha256,
    remoteEvidenceSha256: remoteAuthority.evidenceSha256,
    goldenDatasetAuthority: goldenDataset.authority,
  }));
  const dedupeKey = await sha256Hex(stableStringify({ previewRunKey, evidenceChecksum }));
  const status = resolveStatus(blockers, remoteAuthority, approval);
  const planCore = {
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_PLAN_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_CONTRACT_VERSION,
    mode: 'controlled_preview_readiness',
    status,
    nextAction: nextAction(status),
    repository,
    schemaAuthority,
    remoteAuthority,
    approval,
    runIdentity,
    previewRunKey,
    bundleId: bundle.bundleId,
    evidenceChecksum,
    dedupeKey,
    goldenDatasetAuthority: goldenDataset.authority,
    promptPackage: Object.freeze({
      promptVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_PROMPT_VERSION,
      promptSha256,
      promptBytes,
      prompt,
      outputSchemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_OUTPUT_SCHEMA_VERSION,
      referenceOutputSha256,
      referenceOutputBytes,
      referenceOutput,
    }),
    larkPlan: Object.freeze({
      targetTable: LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE,
      requiredFields: LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS,
      rowCount: rows.length,
      expectedRowCount: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS.expectedRowCountPerWindow,
      operationsEvidenceIncludedInExecutive: true,
      rows,
    }),
    blockers: Object.freeze(blockers.map(Object.freeze)),
    safety: Object.freeze({
      executorImplemented: false,
      executionAuthorized: false,
      aiCallCount: 0,
      larkRecordReadCount: 0,
      larkRecordWriteCount: 0,
      remoteD1ActionCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      providerActionCount: 0,
      automationCount: 0,
      notificationCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }),
  };
  const planId = await sha256Hex(stableStringify({
    ...planCore,
    promptPackage: {
      ...planCore.promptPackage,
      prompt: null,
      referenceOutput: null,
    },
  }));
  return deepFreeze({ ...planCore, planId });
}

function inspectRepository(value) {
  const blockers = [];
  if (value.branch !== 'main') blockers.push(blocker('REPOSITORY_MAIN_REQUIRED', 'repository.branch'));
  if (!value.clean) blockers.push(blocker('REPOSITORY_CLEAN_REQUIRED', 'repository.clean'));
  if (!value.exactHeadSha) blockers.push(blocker('REPOSITORY_EXACT_HEAD_REQUIRED', 'repository.exactHeadSha'));
  return blockers;
}

function inspectSchema(value) {
  const blockers = [];
  if (!value.present) return [blocker('SCHEMA_AUTHORITY_REQUIRED', 'schemaAuthority')];
  if (!value.validated || !value.frozen) blockers.push(blocker('SCHEMA_AUTHORITY_NOT_VALIDATED', 'schemaAuthority'));
  if (value.targetTable !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE) {
    blockers.push(blocker('SCHEMA_TARGET_TABLE_MISMATCH', 'schemaAuthority.targetTable'));
  }
  if (value.status !== 'zero_drift'
    || value.requiredViewCount !== 6
    || value.exactViewFilterCount !== 6
    || value.remainingLogicalActionCount !== 0) {
    blockers.push(blocker('SCHEMA_ZERO_DRIFT_REQUIRED', 'schemaAuthority'));
  }
  if (!value.evidenceSha256) blockers.push(blocker('SCHEMA_EVIDENCE_CHECKSUM_REQUIRED', 'schemaAuthority'));
  return blockers;
}

function inspectRemote(value) {
  const blockers = [];
  if (!value.present) return [blocker('REMOTE_AUTHORITY_REQUIRED', 'remoteAuthority')];
  if (!value.validated || !value.frozen) blockers.push(blocker('REMOTE_AUTHORITY_NOT_VALIDATED', 'remoteAuthority'));
  if (!value.workerFlagsAllFalse) blockers.push(blocker('REMOTE_WORKER_NOT_SAFE', 'remoteAuthority'));
  if (!value.previewUrlsDisabled) blockers.push(blocker('REMOTE_PREVIEW_URLS_NOT_DISABLED', 'remoteAuthority'));
  if (!value.productionBlocked || value.scheduleEnabled) blockers.push(blocker('REMOTE_RUNTIME_UNSAFE', 'remoteAuthority'));
  if (!value.evidenceSha256) blockers.push(blocker('REMOTE_EVIDENCE_CHECKSUM_REQUIRED', 'remoteAuthority'));
  return blockers;
}

function inspectGoldenDataset(bundle) {
  const tiktok = bundle.channels.find(({ platform }) => platform === 'tiktok');
  if (!tiktok) return Object.freeze({
    blockers: Object.freeze([blocker('GOLDEN_DATASET_TIKTOK_MISSING', 'tiktok')]),
    authority: emptyGoldenDatasetAuthority('missing'),
  });

  const authority = classifyTikTokGoldenDataset(tiktok);
  const blockers = [];
  if (!authority.previewEligible) {
    blockers.push(blocker('GOLDEN_DATASET_TIKTOK_NOT_COMPLETE', 'tiktok'));
  }
  if (!tiktok.summaryMetrics.some((metric) => metric.observed
    && metric.availabilityStatus === 'available'
    && metric.currentValue !== null)) {
    blockers.push(blocker('GOLDEN_DATASET_TIKTOK_METRIC_MISSING', 'tiktok.summaryMetrics'));
  }
  return Object.freeze({
    blockers: Object.freeze(blockers),
    authority,
  });
}

function classifyTikTokGoldenDataset(tiktok) {
  const complete = tiktok.availabilityStatus === 'complete'
    && tiktok.coverageStatus === 'complete'
    && tiktok.freshness.status === 'fresh';
  if (complete) return goldenDatasetAuthority({
    admissionClass: 'complete',
    previewEligible: true,
    currentTotalsReady: true,
    comparisonReady: true,
    periodDeltasSuppressed: false,
  });

  if (tiktok.availabilityStatus !== 'partial'
    || tiktok.coverageStatus !== 'partial'
    || tiktok.freshness.status !== 'fresh'
    || tiktok.dataQualityIssues.some(({ severity }) => severity === 'critical')) {
    return emptyGoldenDatasetAuthority('blocked');
  }

  const byKey = new Map(tiktok.summaryMetrics.map((metric) => [metric.metricKey, metric]));
  const currentTotals = exactMetrics(byKey, TIKTOK_CURRENT_TOTAL_METRIC_KEYS);
  const periodDeltas = exactMetrics(byKey, TIKTOK_PERIOD_DELTA_METRIC_KEYS);
  const dataQuality = exactMetrics(byKey, TIKTOK_DATA_QUALITY_METRIC_KEYS);
  if (!currentTotals || !periodDeltas || !dataQuality) return emptyGoldenDatasetAuthority('blocked');

  if (!currentTotals.every(isAvailableObservedMetric)) return emptyGoldenDatasetAuthority('blocked');
  if (!dataQuality.every(isAvailableObservedMetric)) return emptyGoldenDatasetAuthority('blocked');
  if (!periodDeltas.every((metric) => metric.availabilityStatus === 'baseline_incomplete'
    && metric.currentValue === null
    && metric.observed === false)) {
    return emptyGoldenDatasetAuthority('blocked');
  }

  for (const metric of tiktok.summaryMetrics) {
    if (metric.availabilityStatus === 'available') {
      if (!isAvailableObservedMetric(metric)) return emptyGoldenDatasetAuthority('blocked');
      continue;
    }
    if (!TIKTOK_PERIOD_DELTA_METRIC_KEY_SET.has(metric.metricKey)
      || metric.availabilityStatus !== 'baseline_incomplete'
      || metric.currentValue !== null
      || metric.observed !== false) {
      return emptyGoldenDatasetAuthority('blocked');
    }
  }

  const newContent = metricValue(byKey, 'tiktok:new_content_count');
  const tracked = metricValue(byKey, 'tiktok:tracked_content_count');
  const covered = metricValue(byKey, 'tiktok:baseline_covered_content_count');
  const missing = metricValue(byKey, 'tiktok:baseline_missing_content_count');
  const coverageRate = metricValue(byKey, 'tiktok:baseline_coverage_rate');
  if (![newContent, tracked, covered, missing].every(isNonNegativeInteger)
    || tracked <= 0
    || missing <= 0
    || tracked !== covered + missing
    || !Number.isFinite(coverageRate)
    || coverageRate <= 0
    || coverageRate >= 1) {
    return emptyGoldenDatasetAuthority('blocked');
  }
  const reconciledRate = covered / tracked;
  if (Math.abs(coverageRate - reconciledRate) > TIKTOK_PARTIAL_RATE_TOLERANCE) {
    return emptyGoldenDatasetAuthority('blocked');
  }

  const highCoverage = coverageRate >= TIKTOK_HIGH_COVERAGE_PARTIAL_MIN_RATE;
  const currentTotalsOnly = !highCoverage && newContent > 0 && covered > 0;
  if (!highCoverage && !currentTotalsOnly) return emptyGoldenDatasetAuthority('blocked');

  return goldenDatasetAuthority({
    admissionClass: highCoverage
      ? 'baseline_partial_high_coverage'
      : 'current_totals_only_low_baseline',
    previewEligible: true,
    currentTotalsReady: true,
    comparisonReady: false,
    periodDeltasSuppressed: true,
    baselineCoverageRate: coverageRate,
    trackedContentCount: tracked,
    coveredContentCount: covered,
    missingContentCount: missing,
    newContentCount: newContent,
  });
}

function goldenDatasetAuthority(input = {}) {
  return Object.freeze({
    platform: 'tiktok',
    admissionClass: input.admissionClass ?? 'blocked',
    previewEligible: input.previewEligible === true,
    currentTotalsReady: input.currentTotalsReady === true,
    comparisonReady: input.comparisonReady === true,
    periodDeltasSuppressed: input.periodDeltasSuppressed === true,
    baselineCoverageRate: finiteOrNull(input.baselineCoverageRate),
    trackedContentCount: integer(input.trackedContentCount),
    coveredContentCount: integer(input.coveredContentCount),
    missingContentCount: integer(input.missingContentCount),
    newContentCount: integer(input.newContentCount),
  });
}

function emptyGoldenDatasetAuthority(admissionClass) {
  return goldenDatasetAuthority({ admissionClass });
}

function exactMetrics(byKey, keys) {
  const metrics = keys.map((key) => byKey.get(key));
  return metrics.every(Boolean) ? metrics : null;
}

function isAvailableObservedMetric(metric) {
  return metric.availabilityStatus === 'available'
    && metric.observed === true
    && metric.currentValue !== null
    && Number.isFinite(metric.currentValue);
}

function metricValue(byKey, key) {
  return byKey.get(key)?.currentValue ?? null;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inspectPrompt(prompt, promptBytes) {
  const blockers = [];
  if (promptBytes > LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS.maxPromptBytes) {
    blockers.push(blocker('PROMPT_SIZE_LIMIT_EXCEEDED', 'prompt'));
  }
  if ((prompt.match(/<UNTRUSTED_REPORT_DATA>/gu) ?? []).length !== 1
    || (prompt.match(/<\/UNTRUSTED_REPORT_DATA>/gu) ?? []).length !== 1) {
    blockers.push(blocker('PROMPT_BOUNDARY_INVALID', 'prompt'));
  }
  return blockers;
}

function inspectReferenceOutput(validation, size) {
  const blockers = [];
  if (!validation?.ok) blockers.push(blocker('REFERENCE_OUTPUT_VALIDATION_FAILED', 'referenceOutput'));
  if (size > LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS.maxReferenceOutputBytes) {
    blockers.push(blocker('REFERENCE_OUTPUT_SIZE_LIMIT_EXCEEDED', 'referenceOutput'));
  }
  return blockers;
}

function inspectApproval(value, repository) {
  if (!value.present) return [];
  const blockers = [];
  if (!value.valid) blockers.push(blocker('APPROVAL_INVALID_CONTRACT', 'approval'));
  if (value.approvedHeadSha !== repository.exactHeadSha) {
    blockers.push(blocker('APPROVAL_INVALID_HEAD_MISMATCH', 'approval.approvedHeadSha'));
  }
  return blockers;
}

function resolveStatus(blockers, remote, approval) {
  if (blockers.length > 0) return 'blocked';
  if (!remote.metaRemoteLockReleased) return 'waiting_for_remote_lock';
  if (!approval.present || !approval.valid) return 'awaiting_explicit_preview_approval';
  return 'ready_for_controlled_preview';
}

function nextAction(status) {
  return {
    blocked: 'resolve_readiness_blockers',
    waiting_for_remote_lock: 'wait_for_meta_remote_lock_release',
    awaiting_explicit_preview_approval: 'obtain_exact_controlled_preview_approval',
    ready_for_controlled_preview: 'implement_and_review_separate_lark_native_ai_executor',
  }[status];
}

function normalizeRepository(value = {}) {
  return Object.freeze({
    branch: text(value.branch),
    clean: value.clean === true,
    exactHeadSha: sha(value.exactHeadSha ?? value.exact_head_sha, GIT_SHA),
  });
}

function normalizeSchemaAuthority(value) {
  if (!isObject(value)) return emptySchema();
  return Object.freeze({
    present: true,
    validated: (value.validationStatus ?? value.validation_status) === 'validated',
    frozen: value.frozen === true,
    targetTable: text(value.targetTable ?? value.target_table),
    status: text(value.status),
    requiredViewCount: integer(value.requiredViewCount ?? value.required_view_count),
    exactViewFilterCount: integer(value.exactViewFilterCount ?? value.exact_view_filter_count),
    remainingLogicalActionCount: integer(value.remainingLogicalActionCount ?? value.remaining_logical_action_count),
    evidenceSha256: sha(value.evidenceSha256 ?? value.evidence_sha256, SHA256),
  });
}

function normalizeRemoteAuthority(value) {
  if (!isObject(value)) return emptyRemote();
  return Object.freeze({
    present: true,
    source: text(value.source),
    validated: (value.validationStatus ?? value.validation_status) === 'validated',
    frozen: value.frozen === true,
    evidenceSha256: sha(value.evidenceSha256 ?? value.evidence_sha256, SHA256),
    capturedAt: integer(value.capturedAt ?? value.captured_at),
    metaRemoteLockReleased: value.metaRemoteLockReleased === true || value.meta_remote_lock_released === true,
    workerFlagsAllFalse: value.workerFlagsAllFalse === true || value.worker_flags_all_false === true,
    previewUrlsDisabled: value.previewUrlsDisabled === true || value.preview_urls_disabled === true,
    productionBlocked: value.productionBlocked === true || value.production_blocked === true,
    scheduleEnabled: value.scheduleEnabled === true || value.schedule_enabled === true,
  });
}

function normalizeApproval(value, exactHeadSha) {
  if (!isObject(value)) return Object.freeze({ present: false, valid: false, approvalId: null, approvedAt: null, approvedHeadSha: null });
  const approvalId = identity(value.approvalId ?? value.approval_id);
  const approvedAt = integer(value.approvedAt ?? value.approved_at);
  const approvedHeadSha = sha(value.approvedHeadSha ?? value.approved_head_sha, GIT_SHA);
  return Object.freeze({
    present: true,
    valid: text(value.confirmation) === LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE
      && Boolean(approvalId) && approvedAt !== null && approvedHeadSha === exactHeadSha,
    approvalId,
    approvedAt,
    approvedHeadSha,
  });
}

function emptySchema() {
  return Object.freeze({ present: false, validated: false, frozen: false, targetTable: null, status: null,
    requiredViewCount: null, exactViewFilterCount: null, remainingLogicalActionCount: null, evidenceSha256: null });
}
function emptyRemote() {
  return Object.freeze({ present: false, source: null, validated: false, frozen: false, evidenceSha256: null,
    capturedAt: null, metaRemoteLockReleased: false, workerFlagsAllFalse: false,
    previewUrlsDisabled: false, productionBlocked: true, scheduleEnabled: false });
}
function blocker(code, subject) { return Object.freeze({ code, subject }); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function integer(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null; }
function identity(value) { const item = text(value); return item && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/u.test(item) ? item : null; }
function sha(value, pattern) { const item = text(value); return item && pattern.test(item) ? item : null; }
function requireObject(value, label) { if (!isObject(value)) throw new TypeError(`${label} must be an object`); return value; }
function bytes(value) { return new TextEncoder().encode(value).byteLength; }
async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
