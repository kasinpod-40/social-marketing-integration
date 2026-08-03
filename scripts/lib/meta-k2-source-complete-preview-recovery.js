import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { normalizeMetaD1OnlySnapshot } from './meta-d1-only-rollout-operator.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_K2_SOURCE_COMPLETE_PREVIEW_MODE_ENV =
  'MKT_META_K2_SOURCE_COMPLETE_PREVIEW_MODE';
export const META_K2_SOURCE_COMPLETE_PREVIEW_MODE =
  'SOURCE_COMPLETE_PRE_D1_FAILED';
export const META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_K2_SOURCE_COMPLETE_PREVIEW_RECOVERY',
  value: 'RECOVER_AND_COMPLETE_EXACT_META_K2_SOURCE_COMPLETE_PRE_D1',
});
export const META_K2_SOURCE_COMPLETE_RECOVERY_ROOT =
  'exact-source-complete-pre-d1-recovery-v1';
export const META_K2_SOURCE_COMPLETE_RECOVERY_CONTRACT_VERSION =
  'meta_k2_source_complete_preview_recovery_v1';

const OUTER_FILE = 'meta-k2-partial-staging-preview-recovery.mjs';
const FINALIZER_FILE = 'meta-k2-partial-staging-preview-finalizer.mjs';
const FINALIZER_BOOTSTRAP_FILE =
  'meta-k2-source-complete-preview-finalizer-bootstrap.mjs';
const EXPECTED_GIT_BLOB_SHA = Object.freeze({
  [OUTER_FILE]: 'cb6143a5ad22212eaf9e1513e103c320b20c9abe',
  [FINALIZER_FILE]: 'a2c4078e8cde29c2fbda10213b12b72573622ee1',
});
const EXPECTED_ZERO_COUNTS = Object.freeze({
  organicState: 0,
  organicObservations: 0,
  accountDaily: 0,
  adsEntities: 0,
  adsDaily: 0,
});
const EXPECTED_ENTITY_ONLY_COUNTS = Object.freeze({
  organicState: 0,
  organicObservations: 0,
  accountDaily: 0,
  adsEntities: 26,
  adsDaily: 0,
});
const EXPECTED = Object.freeze({
  syncRunStatus: 'failed',
  syncRunStartedAt: 1785728496842,
  syncRunFinishedAt: 1785728534358,
  syncRunErrorCode: 'UNHANDLED_SYNC_ERROR',
  syncRunRecordsWritten: 0,
  syncRunUpdatedAt: 1785728534358,
  workStatus: 'active',
  workLifecycleStatus: 'active',
  workCompletedAt: null,
  sourceComplete: true,
  sourceUpdatedAt: 1785728527046,
  sourceStage: 'complete',
  sourceUnitCount: 43,
  sourceRowCount: 4104,
  sourcePageNumber: 0,
  sourceContentIndex: 0,
  d1PhaseComplete: false,
  d1PhaseUpdatedAt: null,
  larkPhaseCount: 0,
  completionPhaseCount: 0,
  activeLockCount: 0,
  queueOperationAttempts: 1,
  mainQueueAttempts: 29,
  queueOperationUpdatedAt: 1785667099928,
  coverageRunCount: 0,
  coverageEntityCount: 0,
  invalidCoverageCount: 0,
});
const MINIMUM_STABLE_WINDOW_MS = 20_000;

export function assertMetaK2SourceCompletePreviewConfirmation(env = {}) {
  const expected = META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw recoveryError(
      `Meta K2 source-complete Preview recovery requires ${expected.envName}=${expected.value}`,
      'META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function validateMetaK2ExactSourceCompleteFailureStability(
  beforeInput = {},
  afterInput = {},
) {
  const before = classifyExactSourceCompleteBoundary(beforeInput);
  const after = classifyExactSourceCompleteBoundary(afterInput);
  const elapsedMs = after.snapshot.observedAt - before.snapshot.observedAt;
  const stableBefore = { ...before.snapshot, observedAt: 0 };
  const stableAfter = { ...after.snapshot, observedAt: 0 };
  const stable = stableJson(stableBefore) === stableJson(stableAfter);
  const sameBoundary = before.boundary !== null && before.boundary === after.boundary;
  if (!before.accepted
    || !after.accepted
    || !sameBoundary
    || elapsedMs < MINIMUM_STABLE_WINDOW_MS
    || !stable) {
    throw recoveryError(
      'Meta K2 exact source-complete boundary changed during the stability window',
      'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED',
      {
        elapsedMs,
        minimumStableWindowMs: MINIMUM_STABLE_WINDOW_MS,
        beforeBoundary: before.boundary,
        afterBoundary: after.boundary,
        beforeFailedChecks: before.failedChecks,
        afterFailedChecks: after.failedChecks,
        stable,
      },
    );
  }
  const partialResume = after.boundary === 'd1_partial_entities_complete';
  return deepFreeze({
    accepted: true,
    decision: partialResume
      ? 'META_K2_D1_PARTIAL_ENTITIES_STABLE_SAFE_TO_RESUME_EXACT_OPERATION'
      : 'META_K2_SOURCE_COMPLETE_FAILED_STABLE_SAFE_TO_PREPARE_PREVIEW_RECOVERY',
    contractVersion: META_K2_SOURCE_COMPLETE_RECOVERY_CONTRACT_VERSION,
    boundary: after.boundary,
    elapsedMs,
    providerReplayAuthorized: false,
    queueSendAuthorized: false,
    lifecycleSqlRepairAuthorized: false,
    existingBusinessFactsRetained: partialResume,
    snapshot: after.snapshot,
  });
}

export function transformMetaK2SourceCompleteController(url, sourceInput) {
  const source = requireText(sourceInput, 'source');
  const fileName = basename(new URL(url).pathname);
  if (![OUTER_FILE, FINALIZER_FILE].includes(fileName)) {
    return Object.freeze({ changed: false, source });
  }
  const observedBlobSha = gitBlobSha(source);
  if (observedBlobSha !== EXPECTED_GIT_BLOB_SHA[fileName]) {
    throw recoveryError(
      `Meta K2 source-complete compatibility source drifted: ${fileName}`,
      'META_K2_SOURCE_COMPLETE_CONTROLLER_SOURCE_DRIFT',
      { fileName, observedBlobSha },
    );
  }
  const transformed = fileName === OUTER_FILE
    ? transformOuter(source)
    : transformFinalizer(source);
  return Object.freeze({
    changed: true,
    fileName,
    originalGitBlobSha: observedBlobSha,
    transformedSha256: sha256(transformed),
    source: transformed,
  });
}

function classifyExactSourceCompleteBoundary(snapshotInput) {
  const snapshot = normalizeMetaD1OnlySnapshot(snapshotInput);
  const commonChecks = {
    workStatus: snapshot.workStatus === EXPECTED.workStatus,
    workLifecycleStatus:
      snapshot.workLifecycleStatus === EXPECTED.workLifecycleStatus,
    workCompletedAt: snapshot.workCompletedAt === EXPECTED.workCompletedAt,
    sourceComplete: snapshot.sourceStaging.complete === EXPECTED.sourceComplete,
    sourceUpdatedAt: snapshot.sourceStaging.updatedAt === EXPECTED.sourceUpdatedAt,
    sourceStage: snapshot.sourceStaging.stage === EXPECTED.sourceStage,
    sourceUnitCount: snapshot.sourceStaging.unitCount === EXPECTED.sourceUnitCount,
    sourceRowCount: snapshot.sourceStaging.rowCount === EXPECTED.sourceRowCount,
    sourcePageNumber: snapshot.sourceStaging.pageNumber === EXPECTED.sourcePageNumber,
    sourceContentIndex:
      snapshot.sourceStaging.contentIndex === EXPECTED.sourceContentIndex,
    d1PhaseComplete: snapshot.d1PhaseComplete === EXPECTED.d1PhaseComplete,
    d1PhaseUpdatedAt: snapshot.d1PhaseUpdatedAt === EXPECTED.d1PhaseUpdatedAt,
    larkPhaseCount: snapshot.larkPhaseCount === EXPECTED.larkPhaseCount,
    completionPhaseCount:
      snapshot.completionPhaseCount === EXPECTED.completionPhaseCount,
    activeLockCount: snapshot.activeLockCount === EXPECTED.activeLockCount,
    queueOperationAttempts:
      snapshot.queueOperationAttempts === EXPECTED.queueOperationAttempts,
    mainQueueAttempts: snapshot.mainQueueAttempts === EXPECTED.mainQueueAttempts,
    queueOperationUpdatedAt:
      snapshot.queueOperationUpdatedAt === EXPECTED.queueOperationUpdatedAt,
    coverageRunCount: snapshot.coverageRunCount === EXPECTED.coverageRunCount,
    coverageEntityCount:
      snapshot.coverageEntityCount === EXPECTED.coverageEntityCount,
    invalidCoverageCount:
      snapshot.invalidCoverageCount === EXPECTED.invalidCoverageCount,
    sourceStale:
      snapshot.observedAt - (snapshot.sourceStaging.updatedAt ?? 0) >= 16 * 60 * 1000,
  };
  const originalChecks = {
    syncRunStatus: snapshot.syncRunStatus === EXPECTED.syncRunStatus,
    syncRunStartedAt: snapshot.syncRunStartedAt === EXPECTED.syncRunStartedAt,
    syncRunFinishedAt: snapshot.syncRunFinishedAt === EXPECTED.syncRunFinishedAt,
    syncRunErrorCode: snapshot.syncRunErrorCode === EXPECTED.syncRunErrorCode,
    syncRunRecordsWritten:
      snapshot.syncRunRecordsWritten === EXPECTED.syncRunRecordsWritten,
    syncRunUpdatedAt: snapshot.syncRunUpdatedAt === EXPECTED.syncRunUpdatedAt,
    targetCounts: stableJson(snapshot.targetCounts) === stableJson(EXPECTED_ZERO_COUNTS),
    operationCounts:
      stableJson(snapshot.operationCounts) === stableJson(EXPECTED_ZERO_COUNTS),
  };
  const partialChecks = {
    syncRunStatus: snapshot.syncRunStatus === 'running',
    syncRunStartedAt: Number.isSafeInteger(snapshot.syncRunStartedAt),
    syncRunFinishedAt: snapshot.syncRunFinishedAt === null,
    syncRunErrorCode: snapshot.syncRunErrorCode === null,
    syncRunRecordsWritten: snapshot.syncRunRecordsWritten === 0,
    syncRunUpdatedAt: Number.isSafeInteger(snapshot.syncRunUpdatedAt),
    targetCounts:
      stableJson(snapshot.targetCounts) === stableJson(EXPECTED_ENTITY_ONLY_COUNTS),
    operationCounts:
      stableJson(snapshot.operationCounts) === stableJson(EXPECTED_ENTITY_ONLY_COUNTS),
  };
  const commonAccepted = Object.values(commonChecks).every(Boolean);
  const originalAccepted = commonAccepted && Object.values(originalChecks).every(Boolean);
  const partialAccepted = commonAccepted && Object.values(partialChecks).every(Boolean);
  const boundary = originalAccepted
    ? 'source_complete_pre_d1_failed'
    : partialAccepted
      ? 'd1_partial_entities_complete'
      : null;
  const selectedChecks = originalAccepted
    ? { ...commonChecks, ...originalChecks }
    : partialAccepted
      ? { ...commonChecks, ...partialChecks }
      : { ...commonChecks, ...originalChecks };
  const failedChecks = Object.entries(selectedChecks)
    .filter(([, accepted]) => !accepted)
    .map(([name]) => name);
  return deepFreeze({
    accepted: boundary !== null,
    boundary,
    failedChecks,
    snapshot,
  });
}

function transformOuter(sourceInput) {
  let source = sourceInput;
  source = replaceExactlyOnce(
    source,
    `'meta-k2-partial-staging-preview-finalizer.mjs'`,
    `'${FINALIZER_BOOTSTRAP_FILE}'`,
    'outer finalizer path',
  );
  source = replaceExactlyOnce(
    source,
    `'exact-partial-staging-recovery-v1'`,
    `'${META_K2_SOURCE_COMPLETE_RECOVERY_ROOT}'`,
    'outer recovery root',
  );
  const archivePattern = /  currentStage = 'archive-retryable-failure';[\s\S]*?\n  currentStage = 'run-preview-finalizer';/u;
  const matches = source.match(archivePattern);
  if (!matches) {
    throw recoveryError(
      'Meta K2 source-complete outer archive anchor is missing',
      'META_K2_SOURCE_COMPLETE_CONTROLLER_ANCHOR_INVALID',
      { anchor: 'outer archive block' },
    );
  }
  source = source.replace(archivePattern, [
    "  currentStage = 'source-complete-recovery-boundary';",
    '  process.stdout.write(`${JSON.stringify({',
    '    ok: true,',
    "    stage: 'source-complete-recovery-boundary',",
    "    boundary: 'source_complete_or_exact_d1_partial',",
    '    archived: false,',
    '    retainedWithoutDeletion: true,',
    '    remoteMutationCount: 0,',
    '    workerVersionUploadCount: 0,',
    '    workerDeploymentCount: 0,',
    '    queueMessageCount: 0,',
    '    lifecycleSqlRepairCount: 0,',
    '    scheduleEnabled: false,',
    "    production: 'BLOCKED',",
    '  }, null, 2)}\\n`);',
    "  currentStage = 'run-preview-finalizer';",
  ].join('\n'));
  return source;
}

function transformFinalizer(sourceInput) {
  let source = sourceInput;
  source = replaceExactlyOnce(
    source,
    [
      'import {',
      '  compareMetaD1OnlyDirectContinuationSnapshots,',
      '  validateMetaK2ExactPartialStagingStability,',
      "} from './lib/meta-d1-only-partial-staging-recovery.js';",
    ].join('\n'),
    [
      'import {',
      '  compareMetaD1OnlyDirectContinuationSnapshots,',
      "} from './lib/meta-d1-only-partial-staging-recovery.js';",
      'import {',
      '  validateMetaK2ExactSourceCompleteFailureStability,',
      "} from './lib/meta-k2-source-complete-preview-recovery.js';",
    ].join('\n'),
    'finalizer validator import',
  );
  source = replaceExactlyOnce(
    source,
    `'exact-partial-staging-recovery-v1'`,
    `'${META_K2_SOURCE_COMPLETE_RECOVERY_ROOT}'`,
    'finalizer recovery root',
  );
  source = replaceExactlyOnce(
    source,
    '    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: META_K2_EXACT_RECOVERY_MODE,',
    "    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',",
    'finalizer target recovery mode',
  );
  source = replaceExactlyOnce(
    source,
    '  const stability = validateMetaK2ExactPartialStagingStability(',
    '  const stability = validateMetaK2ExactSourceCompleteFailureStability(',
    'finalizer stability validator',
  );
  source = replaceExactlyOnce(
    source,
    '  const timer = setTimeout(() => controller.abort(), 120_000);',
    '  const timer = setTimeout(() => controller.abort(), 300_000);',
    'exact continuation timeout',
  );
  return source;
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const last = source.lastIndexOf(search);
  if (first < 0 || first !== last) {
    throw recoveryError(
      `Meta K2 source-complete controller anchor is invalid: ${label}`,
      'META_K2_SOURCE_COMPLETE_CONTROLLER_ANCHOR_INVALID',
      { label, occurrenceCount: first < 0 ? 0 : 2 },
    );
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function gitBlobSha(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
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

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw recoveryError(
      `${fieldName} is required`,
      'META_K2_SOURCE_COMPLETE_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function recoveryError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
