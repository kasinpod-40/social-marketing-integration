import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_CHANNEL_REMOTE_READINESS_WINDOWS,
  assessReportChannelRemoteReadiness,
  buildReportChannelWindowAssessment,
  parseReportChannelReadinessArgs,
} from '../../scripts/lib/report-channel-remote-readiness.js';

const HEAD = 'a'.repeat(40);

function readyWindow(windowDays) {
  return buildReportChannelWindowAssessment({
    windowDays,
    d1MaterializationCount: 0,
    larkSnapshotCount: 0,
    larkMetricCount: 0,
    larkTopContentCount: 0,
    duplicateMetricKeys: 0,
    integrityOk: false,
  });
}

function readyInput() {
  return {
    repository: { branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD },
    runtime: {
      allExecutionFlagsFalse: true,
      pendingMigrationCount: 0,
      activeReportWorkCount: 0,
      activeReportLockCount: 0,
      openReportDlqCount: 0,
      openReportCriticalAlertCount: 0,
    },
    source: {
      ready: true,
      sourceWatermark: 'coverage-watermark',
      watermarkDate: '2026-08-01',
    },
    lark: { tablesReady: true, stableKeysReady: true },
    windows: REPORT_CHANNEL_REMOTE_READINESS_WINDOWS.map(readyWindow),
  };
}

test('readiness parser remains plan-only by default and requires an explicit platform value', () => {
  assert.deepEqual(parseReportChannelReadinessArgs([]), { execute: false, platformScope: null });
  assert.deepEqual(parseReportChannelReadinessArgs(['--platform=facebook', '--execute']), {
    execute: true,
    platformScope: 'facebook',
  });
  assert.throws(() => parseReportChannelReadinessArgs(['--write']));
});

test('window assessment selects create, verify and repair without channel branches', () => {
  assert.equal(readyWindow(1).action, 'create_materialization');
  assert.equal(buildReportChannelWindowAssessment({
    windowDays: 3,
    d1MaterializationCount: 1,
    larkSnapshotCount: 1,
    larkMetricCount: 12,
    larkTopContentCount: 3,
    duplicateMetricKeys: 0,
    integrityOk: true,
  }).action, 'reuse_or_idempotent_verify');
  assert.equal(buildReportChannelWindowAssessment({
    windowDays: 7,
    d1MaterializationCount: 1,
    larkSnapshotCount: 0,
    larkMetricCount: 0,
    larkTopContentCount: 0,
    duplicateMetricKeys: 0,
    integrityOk: false,
  }).action, 'refresh_or_repair_materialization');
  const blocked = buildReportChannelWindowAssessment({
    windowDays: 30,
    d1MaterializationCount: 2,
    larkSnapshotCount: 1,
    larkMetricCount: 10,
    larkTopContentCount: 0,
    duplicateMetricKeys: 0,
    integrityOk: false,
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blocker.code, 'REPORT_CHANNEL_REMOTE_READINESS_WINDOW_PRESTATE_INVALID');
});

test('ready assessment requires repository, safe runtime, source, Lark and exact 1/3/7/30', () => {
  const ready = assessReportChannelRemoteReadiness(readyInput());
  assert.equal(ready.readyForLive, true);
  assert.deepEqual(ready.windows.map((row) => row.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(ready.windows.map((row) => row.action), [
    'create_materialization',
    'create_materialization',
    'create_materialization',
    'create_materialization',
  ]);

  const blocked = assessReportChannelRemoteReadiness({
    ...readyInput(),
    runtime: { ...readyInput().runtime, activeReportWorkCount: 1 },
  });
  assert.equal(blocked.readyForLive, false);
  assert.equal(blocked.runtimeReady, false);
  assert.equal(blocked.blockers.some(
    (row) => row.code === 'REPORT_CHANNEL_REMOTE_READINESS_RUNTIME_NOT_SAFE',
  ), true);
});
