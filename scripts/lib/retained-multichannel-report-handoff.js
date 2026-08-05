import {
  getReportPlatformContract,
} from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  getReportLiveClosureDescriptor,
} from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  sanitizeReportLiveClosureEvidence,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
} from './report-runtime-closeout-channel-binding.js';
import {
  assertReviewedChannelCloseoutHandoff,
} from './report-runtime-closeout-reviewed-binding.js';
import {
  assertReportRuntimeFinalizerEvidence,
} from './report-runtime-closeout-operator.js';
import {
  selectAllReadyReportChannels,
} from './report-all-ready-channels.js';

export const RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONTRACT =
  'multichannel_report_live_closure_handoff_v1';
export const RETAINED_MULTICHANNEL_REPORT_HANDOFF_BUILDER_CONTRACT =
  'retained_multichannel_report_handoff_builder_v1';
export const META_REMOTE_LOCK_RELEASE_AUDIT_HEAD =
  'd69aa6c08bd6b87b6ab28d3fc33398f22eb18033';
export const RETAINED_MULTICHANNEL_REPORT_HANDOFF_OUTPUT =
  'outputs/report-all-ready-channels/retained-all-channel-handoff.json';

const CLOSEOUT_OPERATOR = 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs';
const COMMIT_SHA = /^[0-9a-f]{40}$/iu;
const NOTIFICATION_BASELINE_TRUE_FLAG_COUNTS = Object.freeze({ inactive: 0, active: 3 });

export function buildRetainedMultichannelReportHandoff(input = {}) {
  const repository = normalizeRepository(input.repository);
  const finalizer = requireObject(input.finalizer, 'finalizer');
  assertReportRuntimeFinalizerEvidence(finalizer);
  if (finalizer.repository?.head !== repository.head) throw builderError(
    'Finalizer evidence must match the exact reviewed main Head',
    'RETAINED_REPORT_HANDOFF_FINALIZER_HEAD_MISMATCH',
    { finalizerHead: finalizer.repository?.head ?? null, repositoryHead: repository.head },
  );
  const notificationRuntime = normalizeNotificationRuntime(finalizer);

  const metaAuditHead = requireCommitSha(input.metaAuditHead, 'metaAuditHead');
  if (metaAuditHead !== META_REMOTE_LOCK_RELEASE_AUDIT_HEAD) throw builderError(
    'Meta Remote lock release authority does not match merged PR #421',
    'RETAINED_REPORT_HANDOFF_META_AUTHORITY_INVALID',
    { metaAuditHead },
  );

  const readinessByPlatform = requireObject(input.readinessByPlatform, 'readinessByPlatform');
  const channelReadiness = {};
  const closeoutAuthorities = {};
  for (const platformScope of REPORT_RUNTIME_REVIEWED_CHANNELS) {
    const contract = getReportPlatformContract(platformScope);
    if (contract.sourceStatus === 'planned') continue;
    const readiness = requireObject(
      readinessByPlatform[platformScope],
      `readinessByPlatform.${platformScope}`,
    );
    assertNotificationReadinessBaseline(readiness, notificationRuntime, platformScope);
    channelReadiness[platformScope] = readiness;
    closeoutAuthorities[platformScope] = Object.freeze({
      operator: CLOSEOUT_OPERATOR,
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope,
      capability: contract.capability,
    });
  }

  const handoff = {
    contractVersion: RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONTRACT,
    builderContractVersion: RETAINED_MULTICHANNEL_REPORT_HANDOFF_BUILDER_CONTRACT,
    liveMaterializationAuthorized: true,
    metaRemoteLock: {
      released: true,
      auditHead: metaAuditHead,
    },
    repository,
    finalizer: {
      contractVersion: finalizer.contractVersion,
      repositoryHead: finalizer.repository.head,
      notificationRuntimeState: notificationRuntime.state,
      notificationRuntimeSettingsPreserved: true,
      notificationRuntimeWorkerBaselinePreserved: true,
      notificationAdmissionEnabled: false,
    },
    channelReadiness,
    closeoutAuthorities,
    notificationAdmissionEnabled: false,
    schedulesEnabled: false,
    production: 'BLOCKED',
  };

  for (const [platformScope, authority] of Object.entries(closeoutAuthorities)) {
    const contract = getReportPlatformContract(platformScope);
    const descriptor = getReportLiveClosureDescriptor(platformScope, contract.capability);
    assertReviewedChannelCloseoutHandoff(
      { ...handoff, closeoutAuthority: authority },
      { descriptor, repository },
    );
  }

  const selection = selectAllReadyReportChannels({ handoff });
  const expectedReadyCount = REPORT_RUNTIME_REVIEWED_CHANNELS
    .filter((platformScope) => getReportPlatformContract(platformScope).sourceStatus !== 'planned')
    .length;
  const planned = selection.waiting.filter((row) => row.reasonCode === 'REPORT_SOURCE_PLANNED');
  if (selection.readyCount !== expectedReadyCount
    || selection.waitingCount !== REPORT_RUNTIME_REVIEWED_CHANNELS.length - expectedReadyCount
    || planned.length !== selection.waitingCount) throw builderError(
    'Retained handoff must authorize every reviewed non-planned channel and only skip planned sources',
    'RETAINED_REPORT_HANDOFF_SELECTION_INVALID',
    {
      readyCount: selection.readyCount,
      waitingCount: selection.waitingCount,
      expectedReadyCount,
    },
  );

  const sanitized = sanitizeReportLiveClosureEvidence(handoff);
  if (JSON.stringify(sanitized) !== JSON.stringify(handoff)) throw builderError(
    'Retained handoff contains blocked credential or infrastructure identity fields',
    'RETAINED_REPORT_HANDOFF_NOT_SANITIZED',
  );

  return Object.freeze({
    handoff: Object.freeze(handoff),
    selection,
  });
}

function normalizeNotificationRuntime(finalizer) {
  const state = finalizer.settings?.notificationRuntimeState;
  const expectedTrueFlagCount = NOTIFICATION_BASELINE_TRUE_FLAG_COUNTS[state];
  if (expectedTrueFlagCount === undefined
    || finalizer.runtime?.notificationRuntimeSettingsPreserved !== true
    || finalizer.runtime?.notificationRuntimeWorkerBaselinePreserved !== true
    || finalizer.runtime?.notificationAdmissionEnabled !== false) throw builderError(
    'Finalizer must preserve the exact Notification Runtime baseline with Admission disabled',
    'RETAINED_REPORT_HANDOFF_NOTIFICATION_FINALIZER_INVALID',
    {
      state: state ?? null,
      settingsPreserved: finalizer.runtime?.notificationRuntimeSettingsPreserved === true,
      workerBaselinePreserved:
        finalizer.runtime?.notificationRuntimeWorkerBaselinePreserved === true,
      notificationAdmissionEnabled:
        finalizer.runtime?.notificationAdmissionEnabled ?? null,
    },
  );
  return Object.freeze({ state, expectedTrueFlagCount });
}

function assertNotificationReadinessBaseline(readiness, notificationRuntime, platformScope) {
  const runtime = readiness.evidence?.runtime ?? {};
  if (runtime.executionBaselineVerified !== true
    || runtime.notificationRuntimeState !== notificationRuntime.state
    || Number(runtime.baselineTrueFlagCount) !== notificationRuntime.expectedTrueFlagCount) {
    throw builderError(
      `Readiness for ${platformScope} does not match the preserved Notification Runtime baseline`,
      'RETAINED_REPORT_HANDOFF_NOTIFICATION_READINESS_INVALID',
      {
        platformScope,
        executionBaselineVerified: runtime.executionBaselineVerified === true,
        expectedState: notificationRuntime.state,
        observedState: runtime.notificationRuntimeState ?? null,
        expectedTrueFlagCount: notificationRuntime.expectedTrueFlagCount,
        observedTrueFlagCount: Number(runtime.baselineTrueFlagCount ?? -1),
      },
    );
  }
}

function normalizeRepository(value) {
  const repository = requireObject(value, 'repository');
  const head = requireCommitSha(repository.head, 'repository.head');
  if (repository.branch !== 'main'
    || repository.clean !== true
    || repository.reviewedHead !== head
    || repository.originMainHead !== head) throw builderError(
    'Retained handoff requires a clean exact main checkout equal to origin/main',
    'RETAINED_REPORT_HANDOFF_REPOSITORY_INVALID',
    {
      branch: repository.branch ?? null,
      clean: repository.clean === true,
      head,
      reviewedHead: repository.reviewedHead ?? null,
      originMainHead: repository.originMainHead ?? null,
    },
  );
  return Object.freeze({
    branch: 'main',
    head,
    reviewedHead: head,
    originMainHead: head,
    clean: true,
  });
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw builderError(
    `${field} must be an object`,
    'RETAINED_REPORT_HANDOFF_INPUT_INVALID',
    { field },
  );
  return value;
}

function requireCommitSha(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!COMMIT_SHA.test(text)) throw builderError(
    `${field} must be a full commit SHA`,
    'RETAINED_REPORT_HANDOFF_INPUT_INVALID',
    { field },
  );
  return text;
}

function builderError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'RetainedMultichannelReportHandoffError';
  error.code = code;
  error.details = details;
  return error;
}
