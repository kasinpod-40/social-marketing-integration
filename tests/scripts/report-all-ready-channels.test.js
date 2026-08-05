import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_ALL_READY_CHANNELS_CONFIRMATION,
  selectAllReadyReportChannels,
} from '../../scripts/lib/report-all-ready-channels.js';
import {
  parseReportAllReadyArgs,
  runAllReadyChannelReports,
} from '../../scripts/report-all-ready-channels-terminal.mjs';

const WINDOWS = [1, 3, 7, 30];

function readiness(platformScope, capability, ready = true) {
  return {
    ok: ready,
    contractVersion: 'report_channel_remote_readiness_reviewed_terminal_v1',
    evidence: {
      target: {
        customerProfile: 'integration_workspace',
        accountKey: 'chemistry_k',
        platformScope,
        capability,
      },
      source: { sourceWatermark: `${platformScope}-watermark` },
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

function authority(platformScope, capability) {
  return {
    operator: 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs',
    contractVersion: 'report_runtime_closeout_uat_v1',
    platformScope,
    capability,
  };
}

function handoff() {
  return {
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    channelReadiness: {
      facebook: readiness('facebook', 'organic'),
      meta_ads: readiness('meta_ads', 'paid_ads'),
      google_ads: readiness('google_ads', 'paid_ads', false),
      tiktok_ads: readiness('tiktok_ads', 'paid_ads'),
    },
    closeoutAuthorities: {
      facebook: authority('facebook', 'organic'),
      meta_ads: authority('meta_ads', 'paid_ads'),
      google_ads: authority('google_ads', 'paid_ads'),
      tiktok_ads: authority('tiktok_ads', 'paid_ads'),
    },
  };
}

test('run-all parser is plan-only by default and rejects unknown arguments', () => {
  assert.deepEqual(parseReportAllReadyArgs([]), { execute: false });
  assert.deepEqual(parseReportAllReadyArgs(['--execute']), { execute: true });
  assert.throws(() => parseReportAllReadyArgs(['--platform=facebook']));
});

test('selection runs ready channels and skips missing, not-ready and planned sources', () => {
  const selected = selectAllReadyReportChannels({ handoff: handoff() });
  assert.deepEqual(selected.ready.map((row) => row.platformScope), ['facebook', 'meta_ads']);
  assert.equal(selected.readyCount, 2);
  assert.equal(selected.waitingCount, 6);
  assert.equal(selected.waiting.find((row) => row.platformScope === 'google_ads').reasonCode,
    'REPORT_READINESS_NOT_READY');
  assert.equal(selected.waiting.find((row) => row.platformScope === 'tiktok_ads').reasonCode,
    'REPORT_SOURCE_PLANNED');
  assert.equal(selected.waiting.find((row) => row.platformScope === 'youtube').reasonCode,
    'REPORT_READINESS_MISSING');
});

test('selection fails closed on readiness target or authority drift', () => {
  const value = handoff();
  value.channelReadiness.meta_ads = readiness('google_ads', 'paid_ads');
  value.closeoutAuthorities.facebook = authority('facebook', 'paid_ads');
  const selected = selectAllReadyReportChannels({ handoff: value });
  assert.equal(selected.waiting.find((row) => row.platformScope === 'meta_ads').reasonCode,
    'REPORT_READINESS_TARGET_INVALID');
  assert.equal(selected.waiting.find((row) => row.platformScope === 'facebook').reasonCode,
    'REPORT_CLOSEOUT_AUTHORITY_INVALID');
});

test('one execution invokes each ready channel sequentially and retains waiting evidence', async () => {
  const calls = [];
  const result = await runAllReadyChannelReports({
    env: { CONFIRM_REPORT_ALL_READY_CHANNELS: REPORT_ALL_READY_CHANNELS_CONFIRMATION },
    argv: ['--execute'],
    handoff: handoff(),
    executeChannel: async ({ channel, authority: selectedAuthority }) => {
      calls.push({ platformScope: channel.platformScope, authority: selectedAuthority.platformScope });
      return { ok: true, status: 'CLOSED' };
    },
  });
  assert.deepEqual(calls, [
    { platformScope: 'facebook', authority: 'facebook' },
    { platformScope: 'meta_ads', authority: 'meta_ads' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.completedCount, 2);
  assert.equal(result.waitingCount, 6);
  assert.equal(result.completionMaxPolls, 120);
  assert.deepEqual(result.completed.map((row) => row.platformScope), ['facebook', 'meta_ads']);
});

test('plan lists all reviewed channels and the bounded queue completion barrier without remote action', async () => {
  const plan = await runAllReadyChannelReports({ argv: [], env: {} });
  assert.equal(plan.planOnly, true);
  assert.equal(plan.reviewedChannels.length, 8);
  assert.deepEqual(plan.windows, WINDOWS);
  assert.equal(plan.behavior.queueCompletionBarrier,
    'hold_reviewed_active_worker_for_up_to_120_polls');
  assert.equal(plan.remoteWriteCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
});
