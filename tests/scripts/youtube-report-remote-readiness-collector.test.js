import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  assertSelectOnlySql,
  assertYouTubeReportRemoteCollectorConfirmation,
  buildYouTubeRemoteReadinessEvidence,
  parseWranglerJson,
  sanitizeYouTubeRemoteEvidence,
  unwrapD1Rows,
} from '../../scripts/lib/youtube-report-remote-readiness-collector.js';

function completeInput() {
  return {
    catalog: {
      connectorStatus: 'active',
      jobStatus: 'active',
      reportStatus: 'active',
      adapterCapability: 'organic',
      reportSettingsReady: true,
    },
    worker: { trueFlags: [], bindingsMatch: true, activeTrafficPercent: 100 },
    runtime: {
      pendingMigrationCount: 0,
      activeReportWorkCount: 0,
      activeReportLockCount: 0,
      openReportDlqCount: 0,
      openReportCriticalAlertCount: 0,
    },
    source: {
      contentCoverageStatus: 'complete',
      accountCoverageStatus: 'completed',
      failureCount: 0,
      contentEntityCount: 837,
      contentStateCount: 837,
      observationCount: 837,
      accountFactCount: 1,
      sourceWatermark: 'youtube-coverage-2026-07-31',
      watermarkDate: '2026-07-31',
      reportingTimezone: 'Asia/Bangkok',
    },
    lark: {
      tablesReady: true,
      stableKeysReady: true,
      windowFieldId: 'fldMlTUP3Z',
      windowOptions: [1, 3, 7, 30],
    },
    windows: [1, 3, 7, 30].map((windowDays) => ({
      windowDays,
      d1MaterializationCount: 0,
      larkSnapshotCount: 0,
      d1MetricCount: 0,
      larkMetricCount: 0,
      d1TopContentCount: 0,
      larkTopContentCount: 0,
      payloadValid: false,
      baselineComplete: false,
      parity: false,
    })),
  };
}

test('internal collector requires the reviewed terminal handoff', () => {
  assert.throws(() => assertYouTubeReportRemoteCollectorConfirmation({
    CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR:
      YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  }), (error) => error?.code === 'YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF_REQUIRED');
  assert.equal(assertYouTubeReportRemoteCollectorConfirmation({
    CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR:
      YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
    MKT_YOUTUBE_REPORT_REMOTE_INTERNAL_HANDOFF:
      YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  }), true);
});

test('builds the exact evidence shape consumed by the existing YouTube assessor', () => {
  const evidence = buildYouTubeRemoteReadinessEvidence(completeInput());
  assert.equal(evidence.target.platformScope, 'youtube');
  assert.equal(evidence.runtime.allExecutionFlagsFalse, true);
  assert.equal(evidence.runtime.bindingsMatch, true);
  assert.equal(evidence.source.contentCoverageStatus, 'completed');
  assert.equal(evidence.source.contentEntityCount, 837);
  assert.equal(evidence.source.sourceWatermark, 'youtube-coverage-2026-07-31');
  assert.equal(evidence.source.watermarkDate, '2026-07-31');
  assert.deepEqual(evidence.lark.windowOptions, [1, 3, 7, 30]);
  assert.deepEqual(evidence.windows.map((row) => row.windowDays), [1, 3, 7, 30]);
});

test('keeps missing exact source watermark explicit instead of substituting watermark date', () => {
  const input = completeInput();
  delete input.source.sourceWatermark;
  const evidence = buildYouTubeRemoteReadinessEvidence(input);
  assert.equal(evidence.source.sourceWatermark, null);
  assert.equal(evidence.source.watermarkDate, '2026-07-31');
});

test('fails closed when execution flags are present', () => {
  const input = completeInput();
  input.worker.trueFlags = ['MKT_REPORT_D1_READ_ENABLED'];
  const evidence = buildYouTubeRemoteReadinessEvidence(input);
  assert.equal(evidence.runtime.allExecutionFlagsFalse, false);
});

test('blocks non-SELECT D1 statements and mutation tokens inside WITH statements', () => {
  assert.equal(assertSelectOnlySql('SELECT 1;'), 'SELECT 1;');
  assert.equal(assertSelectOnlySql('WITH source AS (SELECT 1) SELECT * FROM source;'), 'WITH source AS (SELECT 1) SELECT * FROM source;');
  assert.throws(() => assertSelectOnlySql('DELETE FROM report_materializations;'), (error) => (
    error?.code === 'YOUTUBE_REPORT_REMOTE_COLLECTOR_NON_SELECT_BLOCKED'
  ));
  assert.throws(() => assertSelectOnlySql('WITH removed AS (DELETE FROM x RETURNING *) SELECT * FROM removed;'), (error) => (
    error?.code === 'YOUTUBE_REPORT_REMOTE_COLLECTOR_NON_SELECT_BLOCKED'
  ));
});

test('parses Wrangler JSON with leading status output and unwraps D1 result pages', () => {
  const parsed = parseWranglerJson('notice\n[{"results":[{"count":1}]}]');
  assert.deepEqual(unwrapD1Rows(parsed), [{ count: 1 }]);
});

test('sanitizes infrastructure identities and authorization material recursively', () => {
  const sanitized = sanitizeYouTubeRemoteEvidence({
    databaseId: 'hidden',
    nested: { authorization: 'hidden', count: 1 },
    values: [{ versionId: 'hidden', status: 'safe' }],
  });
  assert.deepEqual(sanitized, {
    nested: { count: 1 },
    values: [{ status: 'safe' }],
  });
});
