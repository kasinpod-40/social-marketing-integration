import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_AUTHORIZATION,
} from '../../scripts/lib/report-runtime-refresh-authorization.js';
import {
  selectReportRuntimeWindowTarget,
} from '../../scripts/lib/report-runtime-window-repair.js';
import {
  ORGANIC_DASHBOARD_READINESS_METRIC_KEYS,
  assertOrganicDashboardReadinessCloseoutSummary,
  assertOrganicDashboardReadinessRefreshConfirmation,
  assertOrganicDashboardReadinessSequence,
  assertOrganicDashboardReadinessWindow,
} from '../../scripts/lib/organic-dashboard-readiness-refresh.js';

const REPORT_ID = 'integration_workspace:tiktok:rolling:1d:chemistry_k:rolling_days:2026-07-28:2026-07-28:tiktok-organic-v1';

function candidates() {
  return [1, 3, 7, 30].map((windowDays) => ({
    windowDays,
    reportId: windowDays === 1 ? REPORT_ID : `report-${windowDays}`,
    job: { type: 'report.materialization.generate' },
  }));
}

test('1D and 30D refresh require the exact Dashboard readiness authorization', () => {
  assert.throws(
    () => selectReportRuntimeWindowTarget(candidates(), [REPORT_ID], {
      MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '1',
      MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
    }),
    /approved only/u,
  );
  const selected = selectReportRuntimeWindowTarget(candidates(), [REPORT_ID], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '1',
    MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
    MKT_REPORT_RUNTIME_REFRESH_AUTHORIZATION:
      REPORT_RUNTIME_DASHBOARD_READINESS_REFRESH_AUTHORIZATION,
  });
  assert.equal(selected.windowDays, 1);
  assert.equal(selected.operation, 'refresh');
  assert.throws(
    () => selectReportRuntimeWindowTarget(candidates(), ['report-3'], {
      MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '30',
      MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: 'refresh',
      MKT_REPORT_RUNTIME_REFRESH_AUTHORIZATION: 'wrong',
    }),
    /approved only/u,
  );
});

test('execution confirmation is exact', () => {
  assert.throws(() => assertOrganicDashboardReadinessRefreshConfirmation({}), /requires/u);
  assert.equal(assertOrganicDashboardReadinessRefreshConfirmation({
    CONFIRM_ORGANIC_DASHBOARD_READINESS_REFRESH: 'EXECUTE_ORGANIC_DASHBOARD_READINESS_REFRESH',
  }), true);
});

test('closeout summary requires 17 metrics, replay idempotency and all-false restore', () => {
  const result = assertOrganicDashboardReadinessCloseoutSummary(closeoutSummary(1), 1);
  assert.equal(result.reportId, REPORT_ID);
  assert.equal(result.payloadChecksum, 'checksum-1');

  const unsafe = structuredClone(closeoutSummary(1));
  unsafe.runtime.restoredAllFalse = false;
  assert.throws(
    () => assertOrganicDashboardReadinessCloseoutSummary(unsafe, 1),
    /not a completed/u,
  );
});

test('partial window verifies exact 17-key D1/Lark values and readiness metadata', () => {
  const payload = partialPayload();
  const larkRows = Object.values(payload.metricPayload).map((metric) => ({
    metricKey: metric.metricKey,
    currentValue: metric.current,
    metricScope: metric.metricScope,
    availabilityStatus: metric.availabilityStatus,
    availabilityMessage: metric.availabilityMessage,
  }));
  const result = assertOrganicDashboardReadinessWindow({
    windowDays: 1,
    payload,
    larkRows,
  });
  assert.equal(result.metricCount, 17);
  assert.equal(result.valueMismatchCount, 0);
  assert.equal(result.metadataMismatchCount, 0);
  assert.deepEqual(result.scopeCounts, {
    period_delta: 6,
    current_total: 6,
    data_quality: 5,
  });
  assert.deepEqual(result.availabilityCounts, {
    available: 11,
    baseline_incomplete: 6,
    source_unavailable: 0,
    not_observed: 0,
  });

  const drifted = structuredClone(larkRows);
  drifted[0].availabilityMessage = 'wrong';
  assert.throws(
    () => assertOrganicDashboardReadinessWindow({ windowDays: 1, payload, larkRows: drifted }),
    /did not converge/u,
  );
});

test('aggregate sequence requires exact 1D/3D/7D/30D verified windows', () => {
  const windows = [1, 3, 7, 30].map((windowDays) => ({
    windowDays,
    metricCount: 17,
    valueMismatchCount: 0,
    metadataMismatchCount: 0,
    restoredAllFalse: true,
  }));
  assert.equal(assertOrganicDashboardReadinessSequence(windows), true);
  windows[2].metricCount = 16;
  assert.throws(() => assertOrganicDashboardReadinessSequence(windows), /did not fully converge/u);
});

function closeoutSummary(windowDays) {
  return {
    ok: true,
    decision: 'REPORT_WINDOW_REFRESHED',
    target: {
      windowDays,
      operation: 'refresh',
      reportId: windowDays === 1 ? REPORT_ID : `report-${windowDays}`,
    },
    materialization: {
      d1MaterializationCount: 1,
      payloadChecksum: `checksum-${windowDays}`,
      integrity: { metricCount: 17, mismatchCount: 0 },
    },
    replay: {
      sameReportId: true,
      samePayloadChecksum: true,
      d1MaterializationCount: 1,
      successfulSyncRunCount: 2,
      larkRowsUnchanged: true,
      integrityUnchanged: true,
    },
    runtime: {
      restoredAllFalse: true,
      finalWorkerVersion: 'version-id',
      providerCalls: 0,
      production: false,
    },
  };
}

function partialPayload() {
  const metricPayload = {};
  for (const metricKey of ORGANIC_DASHBOARD_READINESS_METRIC_KEYS) {
    const suffix = metricKey.split(':')[1];
    const isPeriod = suffix.startsWith('period_');
    const isCurrent = suffix.startsWith('latest_');
    const metricScope = isPeriod ? 'period_delta' : (isCurrent ? 'current_total' : 'data_quality');
    metricPayload[metricKey] = {
      metricKey,
      displayName: metricKey,
      unit: suffix.includes('rate') ? 'ratio' : 'count',
      current: isPeriod ? null : 1,
      compare: null,
      change: null,
      changePercent: null,
      metricScope,
      availabilityStatus: isPeriod ? 'baseline_incomplete' : 'available',
      availabilityMessage: isPeriod ? 'N/A — Baseline ยังไม่ครบ' : 'พร้อมใช้งาน',
      clientVisible: true,
      sortOrder: 1,
      formulaVersion: 'tiktok-organic-v1',
    };
  }
  return {
    coverageRate: 0.5,
    metricPayload,
  };
}
