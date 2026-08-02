import { createHash } from 'node:crypto';
import {
  META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
  buildMetaD1OnlyConfigWindow,
  createMetaD1OnlyEvidence,
} from './meta-d1-only-rollout-operator.js';
import {
  buildMetaLarkConfigWindow,
  classifyMetaLarkCompletion,
  normalizeMetaLarkSnapshot,
} from './meta-lark-parity-rollout-operator.js';
import {
  META_K2_PARTIAL_STAGING_EXACT_IDENTITY,
} from './meta-d1-only-partial-staging-recovery.js';
import {
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV,
} from '../../apps/sync-worker/src/meta-d1-only-partial-staging-recovery-http.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION =
  'meta_k2_partial_staging_finalizer_v1';
export const META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_K2_PARTIAL_STAGING_RECOVERY',
  value: 'RECOVER_AND_COMPLETE_EXACT_META_K2_PARTIAL_STAGING',
});
export const META_K2_RETAINED_OPERATION_HEAD =
  '340f461d4155e17d98781caef375a37620f08533';
export const META_K2_PARTIAL_STAGING_FINALIZER_DECISION =
  'META_HISTORY_2026_TARGET_COMPLETED_SAFE';
export const META_K2_PARTIAL_STAGING_FINALIZER_PHASES = Object.freeze([
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
export const META_K2_EXACT_LARK_TABLE_KEYS = Object.freeze([
  'mktAdsAccounts',
  'mktAdsCampaigns',
  'mktAdsAdGroups',
  'mktAdsAds',
]);

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EXACT = META_K2_PARTIAL_STAGING_EXACT_IDENTITY;

export function parseMetaK2PartialStagingFinalizerArgs(args = []) {
  let execute = false;
  const unknown = [];
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else unknown.push(arg);
  }
  if (unknown.length > 0) {
    throw finalizerError(
      'Unsupported Meta K2 partial-staging finalizer argument',
      'META_K2_PARTIAL_STAGING_FINALIZER_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return Object.freeze({ execute });
}

export function assertMetaK2PartialStagingFinalizerConfirmation(env = {}) {
  const expected = META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value
    || env?.MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY
      !== META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE) {
    throw finalizerError(
      'Meta K2 partial-staging finalizer requires exact confirmations',
      'META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function validateMetaK2ReviewedRepositoryState(input = {}) {
  const repositoryHead = requireFullSha(input.repositoryHead, 'repositoryHead');
  const reviewedHead = requireFullSha(input.reviewedHead, 'reviewedHead');
  const retainedHead = requireFullSha(input.retainedHead, 'retainedHead');
  const valid = input.branch === 'integration/all-meta-end-to-end-completion-v1'
    && repositoryHead === reviewedHead
    && input.originReviewedHead === repositoryHead
    && retainedHead === META_K2_RETAINED_OPERATION_HEAD
    && input.retainedHeadIsAncestor === true
    && input.reviewBaseIsAncestor === true
    && input.clean === true;
  if (!valid) {
    throw finalizerError(
      'Meta K2 recovery requires the exact clean reviewed PR Head and retained operation ancestry',
      'META_K2_PARTIAL_STAGING_REPOSITORY_INVALID',
    );
  }
  return deepFreeze({
    accepted: true,
    repositoryHead,
    retainedHead,
    continuedExactOperationAcrossReviewedHead: repositoryHead !== retainedHead,
  });
}

export function validateMetaK2RetainedEvidence(input = {}) {
  const sendAttempt = requireObject(input.sendAttempt, 'sendAttempt');
  const send = validateEvidence(input.send, 'send-one-d1-only');
  const restore = validateEvidence(input.restore, 'restore-all-false');
  const verifyRestore = validateEvidence(input.verifyRestore, 'verify-restore');
  requireExact(send.operationId, EXACT.operationId, 'send.operationId');
  requireExact(restore.operationId, EXACT.operationId, 'restore.operationId');
  requireExact(verifyRestore.operationId, EXACT.operationId, 'verifyRestore.operationId');
  requireExact(sendAttempt.operationId, EXACT.operationId, 'sendAttempt.operationId');
  requireExact(sendAttempt.workKey, EXACT.workKey, 'sendAttempt.workKey');
  if (send.data?.accepted !== true
    || Number(send.data?.queueSendCommandCount) !== 1
    || send.data?.automaticResend !== false
    || restore.data?.mode !== 'safe'
    || verifyRestore.data?.mode !== 'safe'
    || !Array.isArray(verifyRestore.data?.expectedTrueFlags)
    || verifyRestore.data.expectedTrueFlags.length !== 0
    || verifyRestore.previousEvidenceSha256 !== restore.evidenceSha256) {
    throw finalizerError(
      'Retained Meta K2 Queue acceptance or all-false restore evidence is invalid',
      'META_K2_RETAINED_EVIDENCE_INVALID',
    );
  }
  return deepFreeze({
    accepted: true,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    queueSendCommandCount: 1,
    automaticResend: false,
    retainedEvidenceSha256: verifyRestore.evidenceSha256,
    retainedRestoreVersionId: optionalText(
      verifyRestore.data?.activeVersion ?? restore.data?.deploymentVersionId,
    ),
  });
}

export function buildMetaK2ExactContinuationConfig(safeText, target = {}, input = {}) {
  const phase = requireChoice(input.phase, ['d1', 'lark'], 'phase');
  const tokenSha256 = requireSha256(input.tokenSha256, 'tokenSha256');
  const attestation = requireSha256(input.attestation, 'attestation');
  const base = phase === 'd1'
    ? buildMetaD1OnlyConfigWindow(safeText, target)
    : buildMetaLarkConfigWindow(safeText, target);
  let activeText = base.activeText;
  const values = {
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY:
      META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE,
    [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV]: phase,
    [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV]: tokenSha256,
    [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV]: attestation,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_WORK_KEY: EXACT.workKey,
    MKT_META_D1_ONLY_SYNC_RUN_ID: EXACT.syncRunId,
    MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY: EXACT.sourceAccountKey,
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(
      requireTimestamp(target.originalRequestedAt, 'target.originalRequestedAt'),
    ),
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: String(EXACT.mainQueueAttempts),
  };
  for (const [key, value] of Object.entries(values)) {
    activeText = upsertJsoncString(activeText, key, value);
  }
  const observedTrueFlags = extractTrueFlags(activeText);
  if (JSON.stringify(observedTrueFlags) !== JSON.stringify(base.activeTrueFlags)) {
    throw finalizerError(
      'Meta K2 continuation config contains unapproved enabled flags',
      'META_K2_PARTIAL_STAGING_CONFIG_FLAGS_INVALID',
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

export function validateMetaK2ContinuationHttpResponse(value = {}, input = {}) {
  const phase = requireChoice(input.phase, ['d1', 'lark'], 'phase');
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
      'Meta K2 continuation response is not accepted',
      'META_K2_PARTIAL_STAGING_HTTP_RESPONSE_INVALID',
      { phase },
    );
  }
  return deepFreeze({
    accepted: true,
    phase,
    status: requireText(value.status, 'status'),
    continuationSuppressed: value.continuationSuppressed === true,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
  });
}

export function compareMetaK2DirectLarkSnapshots(beforeInput = {}, afterInput = {}, target = {}, options = {}) {
  const before = normalizeMetaLarkSnapshot(beforeInput);
  const after = normalizeMetaLarkSnapshot(afterInput);
  if (after.queueOperationAttempts !== before.queueOperationAttempts
    || after.mainQueueAttempts !== before.mainQueueAttempts) {
    throw finalizerError(
      'Meta K2 direct Lark continuation changed Queue attempts',
      'META_K2_DIRECT_LARK_QUEUE_DRIFT',
    );
  }
  for (const key of Object.keys(before.targetCounts)) {
    if (after.targetCounts[key] !== before.targetCounts[key]) {
      throw finalizerError(
        'Meta K2 direct Lark continuation changed D1 Business counts',
        'META_K2_DIRECT_LARK_D1_COUNT_DRIFT',
        { key, before: before.targetCounts[key], after: after.targetCounts[key] },
      );
    }
  }
  if (after.coverageRunCount !== before.coverageRunCount
    || after.coverageEntityCount !== before.coverageEntityCount
    || after.invalidCoverageCount !== 0) {
    throw finalizerError(
      'Meta K2 direct Lark continuation changed Coverage',
      'META_K2_DIRECT_LARK_COVERAGE_DRIFT',
    );
  }
  const classified = classifyMetaLarkCompletion(after, target);
  if (!classified.complete) {
    throw finalizerError(
      'Meta K2 direct Lark continuation is incomplete',
      'META_K2_DIRECT_LARK_INCOMPLETE',
    );
  }
  const observedKeys = after.larkResults.map((entry) => entry?.tableKey);
  if (JSON.stringify(observedKeys) !== JSON.stringify(META_K2_EXACT_LARK_TABLE_KEYS)) {
    throw finalizerError(
      'Meta K2 Lark results exceed the Account/Campaign/AdSet/Ad scope',
      'META_K2_DIRECT_LARK_SCOPE_INVALID',
      { observedKeys },
    );
  }
  const rerun = options.rerun === true;
  if (rerun && stableJson({ ...before, observedAt: 0 }) !== stableJson({ ...after, observedAt: 0 })) {
    throw finalizerError(
      'Meta K2 direct Lark idempotent rerun changed completed state',
      'META_K2_DIRECT_LARK_RERUN_DRIFT',
    );
  }
  return deepFreeze({
    accepted: true,
    rerun,
    queueAttemptsUnchanged: true,
    d1CountDrift: false,
    coverageCountDrift: false,
    larkTableKeys: observedKeys,
    snapshot: after,
  });
}

export function createMetaK2RecoveryEvidence(input = {}) {
  const unsigned = {
    phase: requireChoice(input.phase, META_K2_PARTIAL_STAGING_FINALIZER_PHASES, 'phase'),
    status: 'passed',
    capturedAt: new Date(input.capturedAt ?? Date.now()).toISOString(),
    contractVersion: META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    repositoryHead: requireFullSha(input.repositoryHead, 'repositoryHead'),
    retainedOperationHead: META_K2_RETAINED_OPERATION_HEAD,
    targetKey: EXACT.targetKey,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    syncRunId: EXACT.syncRunId,
    previousEvidenceSha256: input.previousEvidenceSha256
      ? requireSha256(input.previousEvidenceSha256, 'previousEvidenceSha256')
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

export function validateMetaK2RecoveryEvidenceSequence(evidence = [], retainedAnchorSha256) {
  const anchor = requireSha256(retainedAnchorSha256, 'retainedAnchorSha256');
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw finalizerError(
      'Meta K2 recovery evidence is empty',
      'META_K2_PARTIAL_STAGING_EVIDENCE_MISSING',
    );
  }
  let previousSha256 = anchor;
  let previousPhaseIndex = -1;
  for (const item of evidence) {
    const phaseIndex = META_K2_PARTIAL_STAGING_FINALIZER_PHASES.indexOf(item?.phase);
    const unsigned = { ...item };
    delete unsigned.evidenceSha256;
    if (item?.contractVersion !== META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION
      || item?.retainedOperationHead !== META_K2_RETAINED_OPERATION_HEAD
      || item?.targetKey !== EXACT.targetKey
      || item?.operationId !== EXACT.operationId
      || item?.workKey !== EXACT.workKey
      || item?.syncRunId !== EXACT.syncRunId
      || item?.previousEvidenceSha256 !== previousSha256
      || phaseIndex <= previousPhaseIndex
      || item?.evidenceSha256 !== sha256(stableJson(unsigned))
      || item?.queueSendAllowed !== false
      || item?.lifecycleSqlRepairAllowed !== false
      || item?.providerReplayAllowed !== false
      || item?.scheduleActivationAllowed !== false
      || item?.productionAllowed !== false) {
      throw finalizerError(
        'Meta K2 recovery evidence chain is invalid',
        'META_K2_PARTIAL_STAGING_EVIDENCE_INVALID',
      );
    }
    previousSha256 = item.evidenceSha256;
    previousPhaseIndex = phaseIndex;
  }
  return deepFreeze({
    accepted: true,
    retainedAnchorSha256: anchor,
    evidenceChainHeadSha256: previousSha256,
    evidence: [...evidence],
  });
}

export function createMetaK2CanonicalD1Summary(input = {}) {
  const target = requireObject(input.target, 'target');
  const recovery = requireObject(input.recovery, 'recovery');
  const evidence = createMetaD1OnlyEvidence({
    phase: 'summary',
    repositoryHead: requireFullSha(target.repositoryHead, 'target.repositoryHead'),
    targetFingerprint: requireSha256(target.targetFingerprint, 'target.targetFingerprint'),
    targetKey: EXACT.targetKey,
    operationId: EXACT.operationId,
    previousEvidenceSha256: requireSha256(
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
      recoveryContractVersion: META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
      retainedOperationHead: META_K2_RETAINED_OPERATION_HEAD,
      retainedEvidenceSha256: recovery.retainedAnchorSha256,
      evidenceChainHeadSha256: recovery.evidenceChainHeadSha256,
      nextGate: 'exact_queue_free_lark_continuation',
    },
    remoteMutationPerformed: false,
    providerRequestMode: null,
    businessWritesAllowed: false,
  });
  if (evidence.contractVersion !== META_D1_ONLY_OPERATOR_CONTRACT_VERSION) {
    throw finalizerError(
      'Meta K2 canonical D1 summary contract is invalid',
      'META_K2_CANONICAL_D1_SUMMARY_INVALID',
    );
  }
  return evidence;
}

function validateEvidence(input, expectedPhase) {
  const evidence = requireObject(input, expectedPhase);
  const unsigned = { ...evidence };
  delete unsigned.evidenceSha256;
  if (evidence.phase !== expectedPhase
    || evidence.status !== 'passed'
    || evidence.contractVersion !== META_D1_ONLY_OPERATOR_CONTRACT_VERSION
    || evidence.evidenceSha256 !== sha256(stableJson(unsigned))) {
    throw finalizerError(
      `Retained Meta evidence is invalid: ${expectedPhase}`,
      'META_K2_RETAINED_EVIDENCE_INVALID',
    );
  }
  return evidence;
}

function upsertJsoncString(text, key, value) {
  const escaped = escapeRegex(key);
  const pattern = new RegExp(`(["']?${escaped}["']?\\s*:\\s*)["'][^"']*["']`, 'u');
  if (pattern.test(text)) return text.replace(pattern, `$1${JSON.stringify(String(value))}`);
  const varsPattern = /(["']?vars["']?\s*:\s*\{)/u;
  if (!varsPattern.test(text)) {
    throw finalizerError(
      'Meta K2 Wrangler config has no vars object',
      'META_K2_PARTIAL_STAGING_CONFIG_VARS_MISSING',
    );
  }
  return text.replace(varsPattern, `$1\n    ${JSON.stringify(key)}: ${JSON.stringify(String(value))},`);
}

function extractTrueFlags(text) {
  return Object.freeze([
    ...text.matchAll(/["']?(MKT_[A-Z0-9_]+_ENABLED)["']?\s*:\s*(?:"true"|true)/gu),
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

function requireChoice(value, choices, fieldName) {
  const text = requireText(value, fieldName);
  if (!choices.includes(text)) {
    throw finalizerError(
      `${fieldName} is invalid`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!FULL_SHA.test(text)) {
    throw finalizerError(
      `${fieldName} must be a full SHA`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA256.test(text)) {
    throw finalizerError(
      `${fieldName} must be a SHA-256 digest`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw finalizerError(
      `${fieldName} must be a timestamp`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw finalizerError(
      `${fieldName} does not match the exact retained operation`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw finalizerError(
      `${fieldName} must be an object`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw finalizerError(
      `${fieldName} is required`,
      'META_K2_PARTIAL_STAGING_FINALIZER_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
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
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
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
