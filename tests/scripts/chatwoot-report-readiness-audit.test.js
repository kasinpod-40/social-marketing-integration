import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATWOOT_REPORT_EXPECTED_METRIC_COUNT,
  CHATWOOT_REPORT_WINDOW_ACTIONS,
  assessChatwootReportReadiness,
} from '../../scripts/lib/chatwoot-report-readiness-audit.js';

const HEAD = '1'.repeat(40);

function readyInput() {
  return {
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
      platformScope: 'chatwoot',
    },
    repository: { branch: 'main', head: HEAD, reviewedHead: HEAD, clean: true },
    runtime: {
      allExecutionFlagsFalse: true,
      bindingsMatch: true,
      activeTrafficPercent: 100,
      pendingMigrationCount: 0,
      activeTargetWorkCount: 0,
      activeTargetLockCount: 0,
    },
    catalog: {
      connectorStatus: 'uat_pending',
      jobStatus: 'uat_pending',
      reportStatus: 'uat_pending',
      adapterRegistered: true,
      readerRegistered: true,
    },
    source: {
      acceptedUatMarker: 'CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE',
      acceptedUatRepositoryHead: '2'.repeat(40),
      initial30DayVerified: true,
      initialReplayVerified: true,
      daily3DayVerified: true,
      dailyReplayVerified: true,
      restoredAllFlagsFalse: true,
      scheduleEnabled: false,
      webhookEnabled: false,
      coverageComplete: true,
      coverageFailureCount: 0,
      conversationCount: 65,
      messageCount: 2071,
      factsPresent: true,
      larkParityComplete: true,
      dateRangeSufficient: true,
      reportingTimezone: 'Asia/Bangkok',
    },
    report: {
      settingsReady: true,
      materializerCompatible: true,
      larkWriterCompatible: true,
      tablesReady: true,
      stableKeysReady: true,
      previewWindows: [1, 3, 7, 30],
      nullZeroSemanticsVerified: true,
      weightedDurationVerified: true,
    },
    incidents: {
      acceptedForensicTruth: true,
      retainedDlqCount: 9,
      retainedAlertCount: 15,
      incidentMutationCount: 0,
    },
    windows: [1, 3, 7, 30].map((windowDays) => ({
      windowDays,
      d1MaterializationCount: 0,
      d1MetricCount: 0,
      dataStatus: null,
      larkSnapshotCount: 0,
      larkMetricCount: 0,
      duplicateMetricKeys: 0,
      parity: false,
    })),
  };
}

test('classifies accepted Chatwoot source with missing report windows as promotion ready', () => {
  const result = assessChatwootReportReadiness(readyInput());
  assert.equal(result.promotionReady, true);
  assert.equal(result.nextGate, 'catalog_promotion_ready');
  assert.deepEqual(result.windows.map((entry) => entry.action), [
    CHATWOOT_REPORT_WINDOW_ACTIONS.CREATE,
    CHATWOOT_REPORT_WINDOW_ACTIONS.CREATE,
    CHATWOOT_REPORT_WINDOW_ACTIONS.CREATE,
    CHATWOOT_REPORT_WINDOW_ACTIONS.CREATE,
  ]);
  assert.equal(result.catalogPromotionAuthorized, false);
  assert.equal(result.liveMaterializationAuthorized, false);
});

test('recognizes exact 139-row D1/Lark parity as reusable', () => {
  const input = readyInput();
  input.windows = input.windows.map((entry) => ({
    ...entry,
    d1MaterializationCount: 1,
    d1MetricCount: CHATWOOT_REPORT_EXPECTED_METRIC_COUNT,
    dataStatus: 'complete',
    larkSnapshotCount: 1,
    larkMetricCount: CHATWOOT_REPORT_EXPECTED_METRIC_COUNT,
    parity: true,
  }));
  const result = assessChatwootReportReadiness(input);
  assert.equal(result.promotionReady, true);
  assert.ok(result.windows.every((entry) => entry.action === CHATWOOT_REPORT_WINDOW_ACTIONS.REUSE));
});

test('fails closed on dirty repository and blocks every window action', () => {
  const input = readyInput();
  input.repository.clean = false;
  const result = assessChatwootReportReadiness(input);
  assert.equal(result.promotionReady, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'repository_not_clean'));
  assert.ok(result.windows.every((entry) => entry.action === CHATWOOT_REPORT_WINDOW_ACTIONS.BLOCKED));
});

test('retains exact accepted facts and forensic incident counts', () => {
  const input = readyInput();
  input.source.messageCount = 2070;
  input.incidents.retainedDlqCount = 8;
  const result = assessChatwootReportReadiness(input);
  assert.equal(result.promotionReady, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'accepted_source_fact_drift'));
  assert.ok(result.blockers.some((entry) => entry.code === 'retained_incident_drift'));
});

test('unsupported report windows fail closed globally', () => {
  const input = readyInput();
  input.windows.push({ windowDays: 90 });
  const result = assessChatwootReportReadiness(input);
  assert.equal(result.promotionReady, false);
  assert.ok(result.blockers.some((entry) => entry.code === 'unsupported_window_present'));
  assert.ok(result.windows.every((entry) => entry.action === CHATWOOT_REPORT_WINDOW_ACTIONS.BLOCKED));
});

test('blocks missing Lark Report tables or Stable-key fields', () => {
  const missingTables = readyInput();
  missingTables.report.tablesReady = false;
  assert.equal(assessChatwootReportReadiness(missingTables).blockers.some(
    (entry) => entry.code === 'report_lark_tables_missing'
  ), true);

  const missingKeys = readyInput();
  missingKeys.report.stableKeysReady = false;
  assert.equal(assessChatwootReportReadiness(missingKeys).blockers.some(
    (entry) => entry.code === 'report_lark_stable_keys_missing'
  ), true);
});
