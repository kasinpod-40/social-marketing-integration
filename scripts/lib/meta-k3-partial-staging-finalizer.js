import { createHash } from 'node:crypto';

import {
  META_K3_EXACT_LARK_TABLE_KEYS,
  META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_MODE,
  META_K3_EXACT_RECOVERY_MODE_ENV,
  META_K3_EXACT_RECOVERY_PHASE_ENV,
  META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
  buildMetaD1OnlyConfigWindow,
  createMetaD1OnlyEvidence,
  normalizeMetaD1OnlySnapshot,
} from './meta-d1-only-rollout-operator.js';
import {
  buildMetaLarkConfigWindow,
  classifyMetaLarkCompletion,
  normalizeMetaLarkSnapshot,
} from './meta-lark-parity-rollout-operator.js';

export const META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION =
  'meta_k3_partial_staging_finalizer_v2';
export const META_K3_PARTIAL_STAGING_FINALIZER_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_K3_PARTIAL_STAGING_RECOVERY',
  value: 'RECOVER_AND_COMPLETE_EXACT_META_K3_PARTIAL_STAGING',
});
export const META_K3_RETAINED_OPERATION_HEAD =
  '6d82a50bc6d051cc39307254543619fcd29211b4';
export const META_K3_PARTIAL_STAGING_FINALIZER_DECISION =
  'META_HISTORY_2026_TARGET_COMPLETED_SAFE';
export const META_K3_PARTIAL_STAGING_FINALIZER_PHASES = Object.freeze([
  'retained-evidence-admission',
  'read-only-stability',
  'backup',
  'deploy-d1-continuation',
  'verify-d1-continuation',
  'continue-d1',
  'verify-d1',
  'verify-d1-idempotency',
  'restore-after-d1',
  'verify-restore-after-d1',
  'lark-preflight',
  'deploy-lark-continuation',
  'verify-lark-continuation',
  'continue-lark',
  'verify-lark',
  'verify-lark-idempotency',
  'restore-after-lark',
  'verify-restore-after-lark',
  'summary',
]);

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export function parseMetaK3PartialStagingFinalizerArgs(args = []) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw finalizerError(
      'Unsupported Meta K3 partial-staging finalizer argument',
      'META_K3_PARTIAL_STAGING_FINALIZER_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return Object.freeze({ execute: args.includes('--execute') });
}

export function assertMetaK3PartialStagingFinalizerConfirmation(env = {}) {
  const expected = META_K3_PARTIAL_STAGING_FINALIZER_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value
    || env?.[META_K3_EXACT_RECOVERY_MODE_ENV] !== META_K3_EXACT_RECOVERY_MODE) {
    throw finalizerError(
      'Meta K3 partial-staging finalizer requires exact confirmations',
      'META_K3_PARTIAL_STAGING_FINALIZER_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function validateMetaK3ReviewedRepositoryState(input = {}) {
  const repositoryHead = fullSha(input.repositoryHead, 'repositoryHead');
  const retainedHead = fullSha(input.retainedHead, 'retainedHead');
  const accepted = input.branch === 'integration/all-meta-end-to-end-completion-v1'
    && repositoryHead === fullSha(input.reviewedHead, 'reviewedHead')
    && repositoryHead === fullSha(input.originReviewedHead, 'originReviewedHead')
    && retainedHead === META_K3_RETAINED_OPERATION_HEAD
    && input.retainedHeadIsAncestor === true
    && input.reviewBaseIsAncestor === true
    && input.clean === true;
  if (!accepted) {
    throw finalizerError(
      'Meta K3 recovery requires the exact clean reviewed PR Head and retained ancestry',
      'META_K3_PARTIAL_STAGING_REPOSITORY_INVALID',
    );
  }
  return deepFreeze({
    accepted: true,
    repositoryHead,
    retainedHead,
    continuedExactOperationAcrossReviewedHead: repositoryHead !== retainedHead,
  });
}

export function validateMetaK3RetainedEvidence(input = {}) {
  const attempt = object(input.sendAttempt, 'sendAttempt');
  const send = validateD1Evidence(input.send, 'send-one-d1-only');
  const restore = validateD1Evidence(input.restore, 'restore-all-false');
  const verifyRestore = validateD1Evidence(input.verifyRestore, 'verify-restore');
  for (const evidence of [send, restore, verifyRestore]) {
    exact(evidence.operationId, EXACT.operationId, `${evidence.phase}.operationId`);
  }
  exact(attempt.operationId, EXACT.operationId, 'sendAttempt.operationId');
  exact(attempt.workKey, EXACT.workKey, 'sendAttempt.workKey');
  if (restore.previousEvidenceSha256 !== send.evidenceSha256
    || verifyRestore.previousEvidenceSha256 !== restore.evidenceSha256
    || send.data?.accepted !== true
    || Number(send.data?.queueSendCommandCount) !== 1
    || send.data?.automaticResend !== false
    || restore.data?.mode !== 'safe'
    || verifyRestore.data?.mode !== 'safe'
    || !Array.isArray(verifyRestore.data?.expectedTrueFlags)
    || verifyRestore.data.expectedTrueFlags.length !== 0) {
    throw finalizerError(
      'Retained Meta K3 Queue acceptance or all-false restore evidence is invalid',
      'META_K3_RETAINED_EVIDENCE_INVALID',
    );
  }
  return deepFreeze({
    accepted: true,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    originalRequestedAt: new Date(timestamp(
      attempt.generation ?? attempt.originalRequestedAt,
      'sendAttempt.generation',
    )).toISOString(),
    queueSendCommandCount: 1,
    automaticResend: false,
    retainedEvidenceSha256: verifyRestore.evidenceSha256,
    retainedRestoreVersionId: optionalText(
      verifyRestore.data?.activeVersion ?? restore.data?.deploymentVersionId,
    ),
  });
}

export function buildMetaK3ExactContinuationConfig(safeText, target = {}, input = {}) {
  const phase = choice(input.phase, ['d1', 'lark'], 'phase');
  const tokenSha256 = fingerprint(input.tokenSha256, 'tokenSha256');
  const attestation = fingerprint(input.attestation, 'attestation');
  const base = phase === 'd1'
    ? buildMetaD1OnlyConfigWindow(safeText, target)
    : buildMetaLarkConfigWindow(safeText, target);
  const values = {
    [META_K3_EXACT_RECOVERY_MODE_ENV]: META_K3_EXACT_RECOVERY_MODE,
    [META_K3_EXACT_RECOVERY_PHASE_ENV]: phase,
    [META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV]: tokenSha256,
    [META_K3_EXACT_RECOVERY_ATTESTATION_ENV]: attestation,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_WORK_KEY: EXACT.workKey,
    MKT_META_D1_ONLY_SYNC_RUN_ID: EXACT.syncRunId,
    MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY: EXACT.sourceAccountKey,
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(
      timestamp(target.originalRequestedAt, 'target.originalRequestedAt'),
    ),
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: String(EXACT.mainQueueAttempts),
  };
  let activeText = base.activeText;
  for (const [key, value] of Object.entries(values)) {
    activeText = upsertJsoncString(activeText, key, value);
  }
  const observedTrueFlags = trueFlags(activeText);
  if (stableJson(observedTrueFlags) !== stableJson(base.activeTrueFlags)) {
    throw finalizerError(
      'Meta K3 continuation config contains unapproved enabled flags',
      'META_K3_PARTIAL_STAGING_CONFIG_FLAGS_INVALID',
      { phase, observedTrueFlags, expectedTrueFlags: base.activeTrueFlags },
    );
  }
  return deepFreeze({
    phase,
    safeText: base.safeText,
    activeText,
    safeSha256: base.safeSha256,
    activeSha256: sha256(activeText),
    safeTrueFlags: base.safeTrueFlags,
    activeTrueFlags: base.activeTrueFlags,
    bindingFingerprint: base.bindingFingerprint,
    routeVariableFingerprint: sha256(stableJson(values)),
  });
}

export function validateMetaK3ExactPartialStagingStability(beforeInput = {}, afterInput = {}) {
  const before = classifyExactPartialSnapshot(beforeInput);
  const after = classifyExactPartialSnapshot(afterInput);
  const elapsedMs = after.snapshot.observedAt - before.snapshot.observedAt;
  const stableBefore = { ...before.snapshot, observedAt: 0 };
  const stableAfter = { ...after.snapshot, observedAt: 0 };
  if (!before.accepted
    || !after.accepted
    || elapsedMs < 30_000
    || stableJson(stableBefore) !== stableJson(stableAfter)) {
    throw finalizerError(
      'Meta K3 exact partial staging changed during the stability window',
      'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
      { elapsedMs },
    );
  }
  return deepFreeze({
    accepted: true,
    decision: 'META_K3_PARTIAL_STAGING_STABLE_SAFE_TO_PREPARE_RECOVERY',
    contractVersion: 'meta_k3_partial_staging_recovery_v1',
    elapsedMs,
    orphanedRunningRecovery: after.orphanedRunningRecovery,
    successfulInvocationRecovery: after.successfulInvocationRecovery,
    snapshot: after.snapshot,
  });
}

export function validateMetaK3ContinuationHttpResponse(value = {}, input = {}) {
  const phase = choice(input.phase, ['d1', 'lark'], 'phase');
  const accepted = value.ok === true
    && value.stage === 'meta-exact-operation-continuation'
    && value.phase === phase
    && value.target === EXACT.targetKey
    && value.operationId === EXACT.operationId
    && value.workKey === EXACT.workKey
    && value.syncRunId === EXACT.syncRunId
    && Number(value.directUseCaseInvocationCount) === 1
    && Number(value.queueMessageCount) === 0
    && Number(value.queueOperationAttemptMutationCount) === 0
    && value.d1WriteEnabled === true
    && value.larkWriteEnabled === (phase === 'lark')
    && value.scheduleEnabled === false
    && value.production === false;
  if (!accepted) {
    throw finalizerError(
      'Meta K3 continuation response is not accepted',
      'META_K3_PARTIAL_STAGING_HTTP_RESPONSE_INVALID',
      { phase },
    );
  }
  return deepFreeze({
    accepted: true,
    phase,
    status: text(value.status, 'status'),
    continuationSuppressed: value.continuationSuppressed === true,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
  });
}

export function compareMetaK3DirectLarkSnapshots(
  beforeInput = {},
  afterInput = {},
  target = {},
  options = {},
) {
  const before = normalizeMetaLarkSnapshot(beforeInput);
  const after = normalizeMetaLarkSnapshot(afterInput);
  assertLarkNoD1OrQueueDrift(before, after);
  const classified = classifyMetaLarkCompletion(after, target);
  if (!classified.complete) {
    throw finalizerError(
      'Meta K3 direct Lark continuation is incomplete',
      'META_K3_DIRECT_LARK_INCOMPLETE',
    );
  }
  const tableKeys = after.larkResults.map((entry) => entry?.tableKey);
  if (stableJson(tableKeys) !== stableJson(META_K3_EXACT_LARK_TABLE_KEYS)) {
    throw finalizerError(
      'Meta K3 Lark results exceed the Account/Campaign/AdSet/Ad scope',
      'META_K3_DIRECT_LARK_SCOPE_INVALID',
      { tableKeys },
    );
  }
  const rerun = options.rerun === true;
  if (rerun && stableJson(larkDurableSignature(before)) !== stableJson(larkDurableSignature(after))) {
    throw finalizerError(
      'Meta K3 direct Lark idempotent rerun changed completed state',
      'META_K3_DIRECT_LARK_RERUN_DRIFT',
    );
  }
  return deepFreeze({
    accepted: true,
    rerun,
    queueAttemptsUnchanged: true,
    d1CountDrift: false,
    coverageCountDrift: false,
    larkTableKeys: tableKeys,
    snapshot: after,
  });
}

export function createMetaK3RecoveryEvidence(input = {}) {
  const unsigned = {
    phase: choice(input.phase, META_K3_PARTIAL_STAGING_FINALIZER_PHASES, 'phase'),
    status: 'passed',
    capturedAt: new Date(input.capturedAt ?? Date.now()).toISOString(),
    contractVersion: META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    repositoryHead: fullSha(input.repositoryHead, 'repositoryHead'),
    retainedOperationHead: META_K3_RETAINED_OPERATION_HEAD,
    targetKey: EXACT.targetKey,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    syncRunId: EXACT.syncRunId,
    previousEvidenceSha256: input.previousEvidenceSha256
      ? fingerprint(input.previousEvidenceSha256, 'previousEvidenceSha256')
      : null,
    data: sanitize(input.data ?? {}),
    queueSendAllowed: false,
    lifecycleSqlRepairAllowed: false,
    providerReplayAllowed: false,
    scheduleActivationAllowed: false,
    productionAllowed: false,
  };
  return deepFreeze({ ...unsigned, evidenceSha256: sha256(stableJson(unsigned)) });
}

export function validateMetaK3RecoveryEvidenceSequence(evidence = [], retainedAnchorSha256) {
  const anchor = fingerprint(retainedAnchorSha256, 'retainedAnchorSha256');
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw finalizerError(
      'Meta K3 recovery evidence is empty',
      'META_K3_PARTIAL_STAGING_EVIDENCE_MISSING',
    );
  }
  let previousSha256 = anchor;
  let previousIndex = -1;
  for (const item of evidence) {
    const index = META_K3_PARTIAL_STAGING_FINALIZER_PHASES.indexOf(item?.phase);
    const unsigned = { ...item };
    delete unsigned.evidenceSha256;
    const accepted = item?.contractVersion === META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION
      && item?.repositoryHead && FULL_SHA.test(item.repositoryHead)
      && item?.retainedOperationHead === META_K3_RETAINED_OPERATION_HEAD
      && item?.targetKey === EXACT.targetKey
      && item?.operationId === EXACT.operationId
      && item?.workKey === EXACT.workKey
      && item?.syncRunId === EXACT.syncRunId
      && item?.previousEvidenceSha256 === previousSha256
      && index > previousIndex
      && item?.evidenceSha256 === sha256(stableJson(unsigned))
      && item?.queueSendAllowed === false
      && item?.lifecycleSqlRepairAllowed === false
      && item?.providerReplayAllowed === false
      && item?.scheduleActivationAllowed === false
      && item?.productionAllowed === false;
    if (!accepted) {
      throw finalizerError(
        'Meta K3 recovery evidence chain is invalid',
        'META_K3_PARTIAL_STAGING_EVIDENCE_INVALID',
      );
    }
    previousSha256 = item.evidenceSha256;
    previousIndex = index;
  }
  return deepFreeze({
    accepted: true,
    retainedAnchorSha256: anchor,
    evidenceChainHeadSha256: previousSha256,
    evidence: [...evidence],
  });
}

export function createMetaK3CanonicalD1Summary(input = {}) {
  const target = object(input.target, 'target');
  const recovery = object(input.recovery, 'recovery');
  const summary = createMetaD1OnlyEvidence({
    phase: 'summary',
    repositoryHead: fullSha(target.repositoryHead, 'target.repositoryHead'),
    targetFingerprint: fingerprint(target.targetFingerprint, 'target.targetFingerprint'),
    targetKey: EXACT.targetKey,
    operationId: EXACT.operationId,
    previousEvidenceSha256: fingerprint(
      recovery.evidenceChainHeadSha256,
      'recovery.evidenceChainHeadSha256',
    ),
    data: {
      accepted: true,
      targetKey: EXACT.targetKey,
      operationId: EXACT.operationId,
      d1OnlyVerified: true,
      idempotentRerunVerified: true,
      restoredAllFalse: true,
      queueSendCommandCount: 0,
      queueAttemptsUnchanged: true,
      larkMutationCount: 0,
      scheduleActivationCount: 0,
      recoveryContractVersion: META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
      retainedOperationHead: META_K3_RETAINED_OPERATION_HEAD,
      retainedEvidenceSha256: recovery.retainedAnchorSha256,
      evidenceChainHeadSha256: recovery.evidenceChainHeadSha256,
      nextGate: 'exact_queue_free_lark_continuation',
    },
    remoteMutationPerformed: false,
    businessWritesAllowed: false,
  });
  if (summary.contractVersion !== META_D1_ONLY_OPERATOR_CONTRACT_VERSION) {
    throw finalizerError(
      'Meta K3 canonical D1 summary contract is invalid',
      'META_K3_CANONICAL_D1_SUMMARY_INVALID',
    );
  }
  return summary;
}

function classifyExactPartialSnapshot(snapshotInput) {
  const snapshot = normalizeMetaD1OnlySnapshot(snapshotInput);
  const latestActivityAt = Math.max(
    snapshot.sourceStaging.updatedAt ?? 0,
    snapshot.syncRunUpdatedAt ?? 0,
    snapshot.queueOperationUpdatedAt ?? 0,
  );
  const successfulInvocationRecovery = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === null;
  const orphanedRunningRecovery = snapshot.syncRunStatus === 'running'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt === null
    && snapshot.syncRunErrorCode === null;
  const checks = {
    sourceStage: snapshot.sourceStaging.stage === EXACT.sourceStage,
    sourceUnitCount: snapshot.sourceStaging.unitCount === EXACT.sourceUnitCount,
    sourceRowCount: snapshot.sourceStaging.rowCount === EXACT.sourceRowCount,
    sourcePageNumber: snapshot.sourceStaging.pageNumber === EXACT.sourcePageNumber,
    sourceContentIndex: snapshot.sourceStaging.contentIndex === EXACT.sourceContentIndex,
    queueOperationAttempts: snapshot.queueOperationAttempts === EXACT.queueOperationAttempts,
    mainQueueAttempts: snapshot.mainQueueAttempts === EXACT.mainQueueAttempts,
    activeLocks: snapshot.activeLockCount === 0,
    d1NotStarted: snapshot.d1PhaseComplete === false && snapshot.d1PhaseUpdatedAt === null,
    coverageNotStarted: snapshot.coverageRunCount === 0
      && snapshot.coverageEntityCount === 0
      && snapshot.invalidCoverageCount === 0,
    larkNotStarted: snapshot.larkPhaseCount === 0,
    completionNotStarted: snapshot.completionPhaseCount === 0,
    operationWritesZero: Object.values(snapshot.operationCounts).every((value) => value === 0),
  };
  const failed = Object.entries(checks)
    .filter(([, accepted]) => !accepted)
    .map(([name]) => name);
  const accepted = (successfulInvocationRecovery || orphanedRunningRecovery)
    && snapshot.syncRunRecordsWritten === 0
    && snapshot.workStatus === 'active'
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.workCompletedAt === null
    && snapshot.sourceStaging.complete === false
    && latestActivityAt > 0
    && snapshot.observedAt - latestActivityAt >= 16 * 60 * 1000
    && failed.length === 0;
  return deepFreeze({
    accepted,
    successfulInvocationRecovery,
    orphanedRunningRecovery,
    latestActivityAt,
    snapshot,
    failed,
  });
}

function assertLarkNoD1OrQueueDrift(before, after) {
  if (after.queueOperationAttempts !== before.queueOperationAttempts
    || after.mainQueueAttempts !== before.mainQueueAttempts) {
    throw finalizerError(
      'Meta K3 direct Lark continuation changed Queue attempts',
      'META_K3_DIRECT_LARK_QUEUE_DRIFT',
    );
  }
  for (const key of Object.keys(before.targetCounts)) {
    if (after.targetCounts[key] !== before.targetCounts[key]) {
      throw finalizerError(
        'Meta K3 direct Lark continuation changed D1 Business counts',
        'META_K3_DIRECT_LARK_D1_COUNT_DRIFT',
        { key, before: before.targetCounts[key], after: after.targetCounts[key] },
      );
    }
  }
  if (after.coverageRunCount !== before.coverageRunCount
    || after.coverageEntityCount !== before.coverageEntityCount
    || after.invalidCoverageCount !== 0) {
    throw finalizerError(
      'Meta K3 direct Lark continuation changed Coverage',
      'META_K3_DIRECT_LARK_COVERAGE_DRIFT',
    );
  }
}

function larkDurableSignature(snapshot) {
  return {
    workStatus: snapshot.workStatus,
    workLifecycleStatus: snapshot.workLifecycleStatus,
    workCompletedAt: snapshot.workCompletedAt,
    d1PhaseComplete: snapshot.d1PhaseComplete,
    preflightPhaseComplete: snapshot.preflightPhaseComplete,
    preflightSummaries: snapshot.preflightSummaries,
    larkPhaseComplete: snapshot.larkPhaseComplete,
    larkResults: snapshot.larkResults,
    completionPhaseComplete: snapshot.completionPhaseComplete,
    completionReconciliation: snapshot.completionReconciliation,
    clearedPhaseCompletion: snapshot.clearedPhaseCompletion,
    completionOperationId: snapshot.completionOperationId,
    completionConnectorKey: snapshot.completionConnectorKey,
    activeLockCount: snapshot.activeLockCount,
    queueOperationAttempts: snapshot.queueOperationAttempts,
    mainQueueAttempts: snapshot.mainQueueAttempts,
    coverageRunCount: snapshot.coverageRunCount,
    invalidCoverageCount: snapshot.invalidCoverageCount,
    coverageEntityCount: snapshot.coverageEntityCount,
    targetCounts: snapshot.targetCounts,
  };
}

function validateD1Evidence(input, phase) {
  const evidence = object(input, phase);
  const unsigned = { ...evidence };
  delete unsigned.evidenceSha256;
  if (evidence.phase !== phase
    || evidence.status !== 'passed'
    || evidence.contractVersion !== META_D1_ONLY_OPERATOR_CONTRACT_VERSION
    || evidence.evidenceSha256 !== sha256(stableJson(unsigned))) {
    throw finalizerError(
      `Retained Meta evidence is invalid: ${phase}`,
      'META_K3_RETAINED_EVIDENCE_INVALID',
    );
  }
  return evidence;
}

function upsertJsoncString(source, key, value) {
  const pattern = new RegExp(
    `(["']?${escapeRegex(key)}["']?\\s*:\\s*)["'][^"']*["']`,
    'u',
  );
  if (pattern.test(source)) return source.replace(pattern, `$1${JSON.stringify(String(value))}`);
  const vars = /(["']?vars["']?\s*:\s*\{)/u;
  if (!vars.test(source)) {
    throw finalizerError(
      'Meta K3 Wrangler config has no vars object',
      'META_K3_PARTIAL_STAGING_CONFIG_VARS_MISSING',
    );
  }
  return source.replace(vars, `$1\n    ${JSON.stringify(key)}: ${JSON.stringify(String(value))},`);
}

function trueFlags(source) {
  return Object.freeze([
    ...source.matchAll(/["']?(MKT_[A-Z0-9_]+_ENABLED)["']?\s*:\s*(?:"true"|true)/gu),
  ].map((match) => match[1]).sort());
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (typeof value !== 'object') {
    return /token|secret|authorization|password|cookie/iu.test(key) ? '[REDACTED]' : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function object(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw finalizerError(
      `${fieldName} must be an object`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function choice(value, choices, fieldName) {
  const result = text(value, fieldName);
  if (!choices.includes(result)) {
    throw finalizerError(
      `${fieldName} is invalid`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return result;
}

function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw finalizerError(
      `${fieldName} is required`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function fullSha(value, fieldName) {
  const result = text(value, fieldName);
  if (!FULL_SHA.test(result)) {
    throw finalizerError(
      `${fieldName} must be a full SHA`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return result;
}

function fingerprint(value, fieldName) {
  const result = text(value, fieldName).toLowerCase();
  if (!SHA256.test(result)) {
    throw finalizerError(
      `${fieldName} must be a SHA-256 digest`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return result;
}

function timestamp(value, fieldName) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(result) || result < Date.UTC(2000, 0, 1)) {
    throw finalizerError(
      `${fieldName} must be a timestamp`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return result;
}

function exact(value, expected, fieldName) {
  if (value !== expected) {
    throw finalizerError(
      `${fieldName} does not match the exact retained operation`,
      'META_K3_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function finalizerError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
