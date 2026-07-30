import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReportWindowDirectorySafeToStart,
  summarizeReusableReportWindow,
  validateReusableReportFinalizerEvidence,
} from '../../scripts/lib/report-runtime-window-repair-resume.js';

function finalizerEvidence(head = 'abc123') {
  return {
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', head, clean: true },
    gates: Array.from({ length: 6 }, (_, index) => ({ command: `gate-${index}`, status: 'pass' })),
    schema: {
      version: 'report-materialization-schema-v3',
      readbackActions: 0,
      conflicts: 0,
      metricFieldMigration: {
        pendingMigrationCount: 0,
        legacyValueMutationCount: 0,
        deleteCount: 0,
      },
    },
    settings: {
      canonicalActive: 66,
      activeLegacySettings: 0,
      readbackCreates: 0,
      readbackUpdates: 0,
    },
    runtime: {
      reportD1ReadEnabled: false,
      presetMaterializationEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
    },
  };
}

function windowEvidence(overrides = {}) {
  return {
    ok: true,
    decision: 'REPORT_WINDOW_REFRESHED',
    target: {
      operation: 'refresh',
      windowDays: 3,
      reportId: 'report-3',
    },
    materialization: {
      dataStatus: 'partial',
      d1MaterializationCount: 1,
      integrity: { metricCount: 6, mismatchCount: 0 },
    },
    replay: {
      sameReportId: true,
      samePayloadChecksum: true,
      d1MaterializationCount: 1,
      larkRowsUnchanged: true,
      integrityUnchanged: true,
    },
    runtime: {
      restoredAllFalse: true,
      finalWorkerVersion: 'version-safe',
      connectorFlagsEnabled: false,
      aiSummaryEnabled: false,
      dailyScheduleEnabled: false,
      weeklyScheduleEnabled: false,
      production: false,
    },
    ...overrides,
  };
}

test('reuses only safe Finalizer evidence from the exact current repository Head', () => {
  assert.deepEqual(validateReusableReportFinalizerEvidence(finalizerEvidence(), 'abc123'), {
    reusable: true,
    repositoryHead: 'abc123',
    schemaVersion: 'report-materialization-schema-v3',
    canonicalSettingsActive: 66,
  });
  assert.throws(
    () => validateReusableReportFinalizerEvidence(finalizerEvidence('old'), 'new'),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_FINALIZER_HEAD_STALE',
  );
  assert.throws(
    () => validateReusableReportFinalizerEvidence({
      ...finalizerEvidence(),
      schema: {
        ...finalizerEvidence().schema,
        metricFieldMigration: {
          pendingMigrationCount: 1,
          legacyValueMutationCount: 0,
          deleteCount: 0,
        },
      },
    }, 'abc123'),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_FINALIZER_MIGRATION_INVALID',
  );
});

test('reuses only complete window evidence with replay parity and all-false restore', () => {
  assert.deepEqual(summarizeReusableReportWindow(windowEvidence(), {
    operation: 'refresh', windowDays: 3,
  }), {
    windowDays: 3,
    operation: 'refresh',
    decision: 'REPORT_WINDOW_REFRESHED',
    reportId: 'report-3',
    dataStatus: 'partial',
    integrity: { metricCount: 6, mismatchCount: 0 },
    restoredAllFalse: true,
    finalWorkerVersion: 'version-safe',
    reused: true,
  });
  assert.throws(
    () => summarizeReusableReportWindow(windowEvidence({
      runtime: { ...windowEvidence().runtime, restoredAllFalse: false },
    }), { operation: 'refresh', windowDays: 3 }),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_WINDOW_EVIDENCE_INVALID',
  );
  assert.throws(
    () => summarizeReusableReportWindow(windowEvidence({
      replay: { ...windowEvidence().replay, samePayloadChecksum: false },
    }), { operation: 'refresh', windowDays: 3 }),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_WINDOW_EVIDENCE_INVALID',
  );
});

test('blocks automatic rerun when partial window evidence exists without a summary', () => {
  assert.equal(assertReportWindowDirectorySafeToStart([], {
    operation: 'refresh', windowDays: 3,
  }), true);
  assert.equal(assertReportWindowDirectorySafeToStart(['.DS_Store'], {
    operation: 'refresh', windowDays: 3,
  }), true);
  assert.throws(
    () => assertReportWindowDirectorySafeToStart([
      'deploy-active.attempt.json', 'backups',
    ], { operation: 'refresh', windowDays: 3 }),
    (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_PARTIAL_WINDOW_BLOCKED'
      && error.details.evidenceEntryCount === 2,
  );
});
