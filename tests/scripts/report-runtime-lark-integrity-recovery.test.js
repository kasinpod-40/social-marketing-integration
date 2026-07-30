import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE,
  assertReportRuntimeCloseoutRecoveryEvidence,
  pollReportRuntimeLarkIntegrity,
  resolveReportRuntimeCloseoutRecoveryMode,
} from '../../scripts/lib/report-runtime-lark-integrity-recovery.js';

const REPORT_ID = 'integration_workspace:tiktok:rolling:3d:chemistry_k:rolling_days:2026-07-27:2026-07-29:tiktok-organic-v1';
const JOB_SHA = 'a'.repeat(64);
const ACTIVE_SHA = 'b'.repeat(64);
const SAFE_SHA = 'c'.repeat(64);

function candidate() {
  return {
    operation: 'refresh',
    windowDays: 3,
    reportId: REPORT_ID,
  };
}

function evidence(overrides = {}) {
  return {
    deployAttempt: {
      repositoryHead: 'd'.repeat(40),
      configSha256: ACTIVE_SHA,
      selectedReportId: REPORT_ID,
      operation: 'refresh',
      windowDays: 3,
    },
    sendFirstAttempt: {
      reportId: REPORT_ID,
      operation: 'refresh',
      jobSha256: JOB_SHA,
      requestedAt: 1785380400000,
    },
    restoreAttempt: {
      configSha256: SAFE_SHA,
    },
    replayAttempt: null,
    summaryExists: false,
    candidate: candidate(),
    activeConfigSha256: ACTIVE_SHA,
    safeConfigSha256: SAFE_SHA,
    jobSha256: JOB_SHA,
    ...overrides,
  };
}

test('bounded Lark integrity polling waits through stale refresh values without write retry', async () => {
  const reads = [
    { snapshots: 1, metrics: 7, topContent: 3, duplicateMetricKeys: 0, version: 'old' },
    { snapshots: 1, metrics: 7, topContent: 3, duplicateMetricKeys: 0, version: 'new' },
  ];
  const delays = [];
  const result = await pollReportRuntimeLarkIntegrity({
    readState: async () => reads.shift(),
    assertComplete: () => true,
    assertIntegrity(state) {
      if (state.version === 'old') {
        const error = new Error('stale');
        error.code = 'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT';
        error.details = { mismatchCount: 7 };
        throw error;
      }
      return { metricCount: 7, mismatchCount: 0 };
    },
    delaysMs: [0, 1_000],
    sleepImpl: async (delay) => delays.push(delay),
  });
  assert.equal(result.attemptCount, 2);
  assert.equal(result.state.version, 'new');
  assert.deepEqual(result.integrity, { metricCount: 7, mismatchCount: 0 });
  assert.deepEqual(delays, [1_000]);
});

test('persistent Lark metric drift fails with sanitized bounded diagnostics', async () => {
  await assert.rejects(
    pollReportRuntimeLarkIntegrity({
      readState: async () => ({
        snapshots: 1,
        metrics: 7,
        topContent: 3,
        duplicateMetricKeys: 0,
      }),
      assertComplete: () => true,
      assertIntegrity() {
        const error = new Error('stale');
        error.code = 'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT';
        error.details = { mismatchCount: 7, secretMetricValues: [1, 2, 3] };
        throw error;
      },
      delaysMs: [0, 1, 2],
      sleepImpl: async () => undefined,
    }),
    (error) => {
      assert.equal(error.code, 'REPORT_RUNTIME_CLOSEOUT_LARK_INTEGRITY_NOT_CONVERGED');
      assert.deepEqual(error.details, {
        attemptCount: 3,
        elapsedDelayMs: 3,
        lastCode: 'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT',
        mismatchCount: 7,
        expectedCount: null,
        observedCount: null,
        snapshots: 1,
        metrics: 7,
        topContent: 3,
        duplicateMetricKeys: 0,
      });
      return true;
    },
  );
});

test('structural Lark errors fail immediately and are not retried', async () => {
  let reads = 0;
  await assert.rejects(
    pollReportRuntimeLarkIntegrity({
      readState: async () => {
        reads += 1;
        return { snapshots: 1, metrics: 7, topContent: 0, duplicateMetricKeys: 1 };
      },
      assertComplete() {
        const error = new Error('duplicate');
        error.code = 'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_DUPLICATE';
        throw error;
      },
      assertIntegrity: () => true,
      delaysMs: [0, 1, 2],
      sleepImpl: async () => undefined,
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_DUPLICATE',
  );
  assert.equal(reads, 1);
});

test('recovery mode and exact first-materialization evidence are fail-closed', () => {
  assert.equal(resolveReportRuntimeCloseoutRecoveryMode({}), null);
  assert.equal(resolveReportRuntimeCloseoutRecoveryMode({
    MKT_REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE: REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE,
  }), REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE);
  assert.throws(() => resolveReportRuntimeCloseoutRecoveryMode({
    MKT_REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE: 'unsafe',
  }));

  assert.deepEqual(assertReportRuntimeCloseoutRecoveryEvidence(evidence()), {
    operation: 'refresh',
    windowDays: 3,
    requestedAt: 1785380400000,
    reportId: REPORT_ID,
    jobSha256: JOB_SHA,
    originalRepositoryHead: 'd'.repeat(40),
    replayAttempted: false,
  });
  assert.throws(() => assertReportRuntimeCloseoutRecoveryEvidence(evidence({
    jobSha256: 'e'.repeat(64),
  })), (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_RECOVERY_EVIDENCE_MISMATCH');
  assert.throws(() => assertReportRuntimeCloseoutRecoveryEvidence(evidence({
    summaryExists: true,
  })), (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_RECOVERY_SUMMARY_EXISTS');
});

test('recorded replay evidence converts recovery to verification-only mode', () => {
  const result = assertReportRuntimeCloseoutRecoveryEvidence(evidence({
    replayAttempt: {
      reportId: REPORT_ID,
      operation: 'refresh',
      jobSha256: JOB_SHA,
      requestedAt: 1785380400000,
    },
  }));
  assert.equal(result.replayAttempted, true);
  assert.throws(() => assertReportRuntimeCloseoutRecoveryEvidence(evidence({
    replayAttempt: {
      reportId: REPORT_ID,
      operation: 'refresh',
      jobSha256: 'f'.repeat(64),
      requestedAt: 1785380400000,
    },
  })), (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_RECOVERY_REPLAY_EVIDENCE_MISMATCH');
});
