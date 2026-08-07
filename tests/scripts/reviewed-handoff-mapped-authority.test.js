import test from 'node:test';
import assert from 'node:assert/strict';
import { getReportPlatformContract } from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import { getReportLiveClosureDescriptor } from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import { REPORT_RUNTIME_REVIEWED_CHANNELS } from '../../scripts/lib/report-runtime-closeout-channel-binding.js';
import { REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT } from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
} from '../../scripts/lib/report-runtime-finalizer-environment.js';
import {
  assertReviewedChannelCloseoutHandoff,
} from '../../scripts/lib/report-runtime-closeout-reviewed-binding.js';
import {
  META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  buildRetainedMultichannelReportHandoff,
} from '../../scripts/lib/retained-multichannel-report-handoff.js';

const HEAD = 'a'.repeat(40);
const WINDOWS = [1, 3, 7, 30];

function repository() {
  return {
    branch: 'main',
    head: HEAD,
    reviewedHead: HEAD,
    originMainHead: HEAD,
    clean: true,
  };
}

function finalizer() {
  return {
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', head: HEAD, clean: true },
    gates: Array.from({ length: 6 }, (_, index) => ({ command: `gate-${index}`, status: 'pass' })),
    schema: {
      readbackActions: 0,
      conflicts: 0,
      privateEnvironmentContractVersion: REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
      privateEnvironmentUpdateCount: REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.length,
    },
    settings: {
      canonicalActive: REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
      activeLegacySettings: 0,
      readbackCreates: 0,
      readbackUpdates: 0,
      notificationRuntimeState: 'active',
    },
    runtime: {
      reportD1ReadEnabled: false,
      presetMaterializationEnabled: false,
      aiSummaryEnabled: false,
      notificationRuntimeSettingsPreserved: true,
      notificationRuntimeWorkerBaselinePreserved: true,
      notificationAdmissionEnabled: false,
      schedulesEnabled: false,
    },
  };
}

function readiness(platformScope) {
  const contract = getReportPlatformContract(platformScope);
  return {
    ok: true,
    contractVersion: 'report_channel_remote_readiness_reviewed_terminal_v1',
    evidence: {
      target: {
        environment: 'development',
        customerProfile: 'integration_workspace',
        accountKey: 'chemistry_k',
        accountId: 'chemistry_k',
        platformScope,
        capability: contract.capability,
      },
      repository: repository(),
      runtime: {
        executionBaselineVerified: true,
        notificationRuntimeState: 'active',
        baselineTrueFlagCount: 3,
      },
      source: { sourceWatermark: `${platformScope}-watermark` },
    },
    assessment: {
      readyForLive: true,
      repositoryReady: true,
      sourceReady: true,
      blockerCount: 0,
      windows: WINDOWS.map((windowDays) => ({
        windowDays,
        action: platformScope === 'chatwoot' && windowDays === 1
          ? 'reuse_or_idempotent_verify'
          : 'create_materialization',
        ready: true,
      })),
    },
  };
}

test('builder output validates mapped per-channel closeout authorities without legacy injection', () => {
  const readinessByPlatform = Object.fromEntries(REPORT_RUNTIME_REVIEWED_CHANNELS
    .filter((platformScope) => getReportPlatformContract(platformScope).sourceStatus !== 'planned')
    .map((platformScope) => [platformScope, readiness(platformScope)]));
  const built = buildRetainedMultichannelReportHandoff({
    repository: repository(),
    finalizer: finalizer(),
    readinessByPlatform,
    metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  });

  assert.equal(built.handoff.closeoutAuthority, undefined);
  assert.ok(built.handoff.closeoutAuthorities.chatwoot);

  for (const platformScope of Object.keys(readinessByPlatform)) {
    const contract = getReportPlatformContract(platformScope);
    const descriptor = getReportLiveClosureDescriptor(platformScope, contract.capability);
    assert.equal(assertReviewedChannelCloseoutHandoff(
      built.handoff,
      { descriptor, repository: repository() },
    ), true);
  }
});

test('legacy single-channel closeoutAuthority remains accepted as fallback', () => {
  const platformScope = 'chatwoot';
  const contract = getReportPlatformContract(platformScope);
  const descriptor = getReportLiveClosureDescriptor(platformScope, contract.capability);
  const readinessByPlatform = Object.fromEntries(REPORT_RUNTIME_REVIEWED_CHANNELS
    .filter((scope) => getReportPlatformContract(scope).sourceStatus !== 'planned')
    .map((scope) => [scope, readiness(scope)]));
  const built = buildRetainedMultichannelReportHandoff({
    repository: repository(),
    finalizer: finalizer(),
    readinessByPlatform,
    metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  });
  const legacy = {
    ...built.handoff,
    closeoutAuthorities: undefined,
    closeoutAuthority: built.handoff.closeoutAuthorities.chatwoot,
  };
  assert.equal(assertReviewedChannelCloseoutHandoff(
    legacy,
    { descriptor, repository: repository() },
  ), true);
});
