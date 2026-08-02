import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_ORGANIC_METRIC_COUNT,
  YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION,
  assertYouTubeReportReadinessConfirmation,
  parseYouTubeReportReadinessArgs,
} from '../../scripts/lib/youtube-report-live-readiness-audit.js';
import {
  assessYouTubeReportLiveReadiness,
} from '../../scripts/lib/youtube-report-live-readiness-reviewed-audit.js';

const REVIEWED_HEAD = 'a'.repeat(40);

function readyInput() {
  return {
    repository: {
      branch: 'main',
      head: REVIEWED_HEAD,
      reviewedHead: REVIEWED_HEAD,
      clean: true,
    },
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
      platformScope: 'youtube',
    },
    catalog: {
      connectorStatus: 'active',
      jobStatus: 'active',
      reportStatus: 'active',
      adapterCapability: 'organic',
      reportSettingsReady: true,
    },
    runtime: {
      allExecutionFlagsFalse: true,
      bindingsMatch: true,
      activeTrafficPercent: 100,
      pendingMigrationCount: 0,
      activeReportWorkCount: 0,
      activeReportLockCount: 0,
      openReportDlqCount: 0,
      openReportCriticalAlertCount: 0,
    },
    source: {
      contentCoverageStatus: 'completed',
      accountCoverageStatus: 'completed',
      failureCount: 0,
      contentEntityCount: 837,
      contentStateCount: 837,
      observationCount: 837,
      accountFactCount: 1,
      watermarkDate: '2026-07-31',
      reportingTimezone: 'Asia/Bangkok',
    },
    lark: {
      tablesReady: true,
      stableKeysReady: true,
      windowFieldId: 'fldMlTUP3Z',
      windowOptions: [1, 3, 7, 30],
    },
    windows: [
      windowState(1, { d1MaterializationCount: 0, larkSnapshotCount: 0 }),
      windowState(3),
      windowState(7, { parity: false, larkMetricCount: 16 }),
      windowState(30, { d1MaterializationCount: 0, larkSnapshotCount: 0, baselineComplete: false }),
    ],
  };
}

function windowState(windowDays, overrides = {}) {
  return {
    windowDays,
    d1MaterializationCount: 1,
    larkSnapshotCount: 1,
    d1MetricCount: YOUTUBE_ORGANIC_METRIC_COUNT,
    larkMetricCount: YOUTUBE_ORGANIC_METRIC_COUNT,
    d1TopContentCount: 5,
    larkTopContentCount: 5,
    baselineComplete: true,
    payloadValid: true,
    parity: true,
    ...overrides,
  };
}

test('YouTube Report readiness is plan-only and exact-confirmation gated', () => {
  assert.deepEqual(parseYouTubeReportReadinessArgs([]), { execute: false });
  assert.deepEqual(parseYouTubeReportReadinessArgs(['--execute']), { execute: true });
  assert.throws(() => parseYouTubeReportReadinessArgs(['--write']));
  assert.throws(() => assertYouTubeReportReadinessConfirmation({}));
  assert.equal(assertYouTubeReportReadinessConfirmation({
    CONFIRM_YOUTUBE_REPORT_READINESS_AUDIT: YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION,
  }), true);
});

test('YouTube Report readiness classifies create, reuse and repair independently', () => {
  const result = assessYouTubeReportLiveReadiness(readyInput());
  assert.equal(result.readyForLive, true);
  assert.equal(result.repositoryReady, true);
  assert.equal(result.repository.head, REVIEWED_HEAD);
  assert.equal(result.expectedMetricRowsTotal, 68);
  assert.deepEqual(result.windows.map((window) => window.action), [
    'create_materialization',
    'reuse_or_idempotent_verify',
    'refresh_or_repair_materialization',
    'create_materialization',
  ]);
  assert.equal(result.windows[3].baselineComplete, false);
});

test('YouTube readiness blocks dirty, non-main or stale repository evidence', () => {
  const input = readyInput();
  input.repository.branch = 'audit/youtube-report-live-readiness-v1';
  input.repository.clean = false;
  input.repository.head = 'b'.repeat(40);
  const result = assessYouTubeReportLiveReadiness(input);
  assert.equal(result.readyForLive, false);
  assert.equal(result.repositoryReady, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'repository_branch_not_main'));
  assert.ok(result.blockers.some((entry) => entry.code === 'repository_not_clean'));
  assert.ok(result.blockers.some((entry) => entry.code === 'repository_head_not_reviewed'));
  assert.ok(result.windows.every((window) => window.action === 'blocked'));
});

test('YouTube incomplete Coverage blocks all windows without converting missing values to zero', () => {
  const input = readyInput();
  input.source.contentCoverageStatus = 'partial';
  input.source.failureCount = 1;
  const result = assessYouTubeReportLiveReadiness(input);
  assert.equal(result.readyForLive, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'coverage_incomplete'));
  assert.ok(result.blockers.some((entry) => entry.code === 'coverage_failure_present'));
  assert.ok(result.windows.every((window) => window.action === 'blocked'));
});

test('YouTube active Report lock and open Report DLQ block every window', () => {
  const input = readyInput();
  input.runtime.activeReportLockCount = 1;
  input.runtime.openReportDlqCount = 2;
  const result = assessYouTubeReportLiveReadiness(input);
  assert.equal(result.readyForLive, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'active_report_lock'));
  assert.ok(result.blockers.some((entry) => entry.code === 'open_report_dlq'));
  assert.ok(result.windows.every((window) => window.action === 'blocked'));
});

test('YouTube accepted 837-entity baseline may grow but cannot regress or diverge', () => {
  const grown = readyInput();
  grown.source.contentEntityCount = 900;
  grown.source.contentStateCount = 900;
  grown.source.observationCount = 900;
  assert.equal(assessYouTubeReportLiveReadiness(grown).sourceReady, true);

  const regressed = readyInput();
  regressed.source.contentEntityCount = 836;
  regressed.source.contentStateCount = 836;
  regressed.source.observationCount = 835;
  const result = assessYouTubeReportLiveReadiness(regressed);
  assert.ok(result.blockers.some((entry) => entry.code === 'accepted_source_entity_regression'));
  assert.ok(result.blockers.some((entry) => entry.code === 'source_entity_reconciliation_drift'));
});

test('YouTube readiness rejects orphan Lark rows, duplicate identities and window-field drift', () => {
  const input = readyInput();
  input.lark.windowOptions = [3, 7, 1, 30];
  input.windows[0] = windowState(1, { d1MaterializationCount: 0, larkSnapshotCount: 1 });
  input.windows[1] = windowState(3, { d1MaterializationCount: 2 });
  const result = assessYouTubeReportLiveReadiness(input);
  assert.equal(result.readyForLive, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'window_option_order_drift'));
  assert.ok(result.windows[0].blockers.some((entry) => entry.code === 'orphan_lark_report_rows'));
  assert.ok(result.windows[1].blockers.some((entry) => entry.code === 'window_identity_duplicate'));
});

test('YouTube unsupported window blocks every locked Dashboard window', () => {
  const input = readyInput();
  input.windows.push(windowState(9));
  const result = assessYouTubeReportLiveReadiness(input);
  assert.equal(result.readyForLive, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'unsupported_window_present'));
  assert.ok(result.windows.every((window) => window.action === 'blocked'));
});
