import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReportPlatformContract,
} from '../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
} from '../../scripts/lib/report-runtime-closeout-channel-binding.js';
import {
  REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
} from '../../scripts/lib/report-runtime-finalizer-environment.js';
import {
  META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  buildRetainedMultichannelReportHandoff,
} from '../../scripts/lib/retained-multichannel-report-handoff.js';
import {
  BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONFIRMATION,
  parseRetainedHandoffBuilderArgs,
  runRetainedHandoffBuilder,
} from '../../scripts/build-retained-multichannel-report-handoff.mjs';

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
    gates: Array.from({ length: 6 }, (_, index) => ({
      command: `gate-${index}`,
      status: 'pass',
    })),
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

function readiness(platformScope, ready = true) {
  const contract = getReportPlatformContract(platformScope);
  return {
    ok: ready,
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
      source: {
        sourceWatermark: `${platformScope}-watermark`,
      },
    },
    assessment: {
      readyForLive: ready,
      repositoryReady: true,
      sourceReady: ready,
      blockerCount: ready ? 0 : 1,
      windows: WINDOWS.map((windowDays) => ({
        windowDays,
        action: 'create_materialization',
        ready: true,
      })),
    },
  };
}

function readinessByPlatform() {
  return Object.fromEntries(REPORT_RUNTIME_REVIEWED_CHANNELS
    .filter((platformScope) => getReportPlatformContract(platformScope).sourceStatus !== 'planned')
    .map((platformScope) => [platformScope, readiness(platformScope)]));
}

test('builder creates one sanitized exact-head handoff for every non-planned channel', () => {
  const result = buildRetainedMultichannelReportHandoff({
    repository: repository(),
    finalizer: finalizer(),
    readinessByPlatform: readinessByPlatform(),
    metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
  });

  assert.equal(result.handoff.liveMaterializationAuthorized, true);
  assert.equal(result.handoff.metaRemoteLock.released, true);
  assert.equal(result.handoff.repository.head, HEAD);
  assert.equal(result.handoff.notificationAdmissionEnabled, false);
  assert.equal(result.handoff.schedulesEnabled, false);
  assert.deepEqual(result.selection.ready.map((row) => row.platformScope), [
    'facebook',
    'instagram',
    'youtube',
    'meta_ads',
    'google_ads',
    'woocommerce',
    'chatwoot',
  ]);
  assert.deepEqual(result.selection.waiting, [{
    platformScope: 'tiktok_ads',
    capability: 'paid_ads',
    sourceStatus: 'planned',
    reasonCode: 'REPORT_SOURCE_PLANNED',
  }]);
});

test('builder rejects stale Finalizer and not-ready channel evidence', () => {
  const staleFinalizer = finalizer();
  staleFinalizer.repository.head = 'b'.repeat(40);
  assert.throws(
    () => buildRetainedMultichannelReportHandoff({
      repository: repository(),
      finalizer: staleFinalizer,
      readinessByPlatform: readinessByPlatform(),
      metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
    }),
    { code: 'RETAINED_REPORT_HANDOFF_FINALIZER_HEAD_MISMATCH' },
  );

  const channelEvidence = readinessByPlatform();
  channelEvidence.meta_ads = readiness('meta_ads', false);
  assert.throws(
    () => buildRetainedMultichannelReportHandoff({
      repository: repository(),
      finalizer: finalizer(),
      readinessByPlatform: channelEvidence,
      metaAuditHead: META_REMOTE_LOCK_RELEASE_AUDIT_HEAD,
    }),
  );
});

test('builder rejects any Meta lock authority other than merged PR 421', () => {
  assert.throws(
    () => buildRetainedMultichannelReportHandoff({
      repository: repository(),
      finalizer: finalizer(),
      readinessByPlatform: readinessByPlatform(),
      metaAuditHead: 'c'.repeat(40),
    }),
    { code: 'RETAINED_REPORT_HANDOFF_META_AUTHORITY_INVALID' },
  );
});

test('terminal is plan-only by default and requires exact confirmation for execution', async () => {
  assert.deepEqual(parseRetainedHandoffBuilderArgs([]), { execute: false });
  assert.deepEqual(parseRetainedHandoffBuilderArgs(['--execute']), { execute: true });
  assert.throws(() => parseRetainedHandoffBuilderArgs(['--apply']));

  const plan = await runRetainedHandoffBuilder({ argv: [], env: {} });
  assert.equal(plan.planOnly, true);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.queueActionCount, 0);

  await assert.rejects(
    runRetainedHandoffBuilder({ argv: ['--execute'], env: {} }),
    { code: 'RETAINED_REPORT_HANDOFF_CONFIRMATION_REQUIRED' },
  );
  assert.equal(
    BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF_CONFIRMATION,
    'BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF',
  );
});
