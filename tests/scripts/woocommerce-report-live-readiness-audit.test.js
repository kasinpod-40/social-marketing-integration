import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT,
  WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION,
  WOOCOMMERCE_REPORT_REQUIRED_WINDOWS,
  assessWooCommerceReportLiveReadiness,
  assertWooCommerceReportLiveReadinessConfirmation,
  parseWooCommerceReportLiveReadinessArgs,
  safeWooCommerceReportReadinessEvidence,
} from '../../scripts/lib/woocommerce-report-live-readiness-audit.js';
import {
  REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
} from '../../scripts/lib/report-runtime-closeout-operator.js';

function baseInput() {
  const head = 'a'.repeat(40);
  return {
    repository: { branch: 'main', head, originMainHead: head, clean: true },
    finalizerEvidence: {
      ok: true,
      contractVersion: 'report_runtime_finalize_v1',
      repository: { branch: 'main', head, clean: true },
      gates: Array.from({ length: 6 }, (_, index) => ({ command: String(index), status: 'pass' })),
      schema: { readbackActions: 0, conflicts: 0 },
      settings: {
        canonicalActive: REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
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
    },
    config: {
      valid: true,
      safeTrueFlags: [],
      activeTrueFlags: [...WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS],
      tableMappingsReady: true,
    },
    d1Preflight: {
      coverage_status: 'complete',
      coverage_scope_mode: 'report_range',
      source_watermark: 'woo-watermark',
      period_end: '2026-07-31',
      daily_fact_count: 100,
      order_state_count: 200,
      active_report_locks: 0,
      open_report_dlq: 0,
    },
    pendingMigrations: [],
    remoteWorker: {
      verified: true,
      trueFlags: [],
      d1BindingMatches: true,
      queueBindingMatches: true,
      tableMappingsMatch: true,
    },
    larkSchema: {
      tablesReady: true,
      stableKeyFieldsReady: true,
      windowField: {
        fieldId: 'fldMlTUP3Z',
        fieldName: 'window_days',
        optionNames: ['1', '3', '7', '30'],
        optionIdsUnique: true,
      },
    },
    d1Windows: [],
    larkWindows: [],
  };
}

function readyWindow(windowDays) {
  return {
    d1: {
      windowDays,
      materializationCount: 1,
      dataStatus: 'complete',
      payloadMetricCount: WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT,
    },
    lark: {
      windowDays,
      snapshotCount: 1,
      metricCount: WOOCOMMERCE_REPORT_EXPECTED_METRIC_COUNT,
      duplicateMetricKeys: 0,
      parity: true,
    },
  };
}

test('WooCommerce Report readiness is plan-only by default and exact-confirmation gated', () => {
  assert.deepEqual(parseWooCommerceReportLiveReadinessArgs([]), { execute: false });
  assert.deepEqual(parseWooCommerceReportLiveReadinessArgs(['--execute']), { execute: true });
  assert.throws(() => parseWooCommerceReportLiveReadinessArgs(['--write']));
  assert.throws(() => assertWooCommerceReportLiveReadinessConfirmation({}));
  assert.equal(assertWooCommerceReportLiveReadinessConfirmation({
    CONFIRM_WOOCOMMERCE_REPORT_LIVE_READINESS_AUDIT:
      WOOCOMMERCE_REPORT_LIVE_READINESS_CONFIRMATION,
  }), true);
});

test('missing four-window materializations are actionable and not readiness blockers', () => {
  const result = assessWooCommerceReportLiveReadiness(baseInput());
  assert.equal(result.ok, true);
  assert.equal(result.decision, 'READY_FOR_CONTROLLED_MATERIALIZATION');
  assert.deepEqual(
    result.windows.map((window) => window.windowDays),
    WOOCOMMERCE_REPORT_REQUIRED_WINDOWS,
  );
  assert.equal(result.requiredActions.length, 4);
  assert.ok(result.requiredActions.every((action) => action.action === 'create_materialization'));
  assert.equal(result.remoteMutationCount, 0);
});

test('legacy 13-row WooCommerce reports require controlled refresh to 58 rows', () => {
  const input = baseInput();
  input.d1Windows = WOOCOMMERCE_REPORT_REQUIRED_WINDOWS.map((windowDays) => ({
    windowDays,
    materializationCount: 1,
    dataStatus: 'complete',
    payloadMetricCount: 13,
  }));
  input.larkWindows = WOOCOMMERCE_REPORT_REQUIRED_WINDOWS.map((windowDays) => ({
    windowDays,
    snapshotCount: 1,
    metricCount: 13,
    duplicateMetricKeys: 0,
    parity: true,
  }));
  const result = assessWooCommerceReportLiveReadiness(input);
  assert.equal(result.ok, true);
  assert.ok(result.requiredActions.every((action) => action.action === 'refresh_legacy_13_to_58'));
  assert.equal(result.warnings.length, 4);
});

test('current 58-row reports with D1 and Lark parity are reusable', () => {
  const input = baseInput();
  const windows = WOOCOMMERCE_REPORT_REQUIRED_WINDOWS.map(readyWindow);
  input.d1Windows = windows.map((entry) => entry.d1);
  input.larkWindows = windows.map((entry) => entry.lark);
  const result = assessWooCommerceReportLiveReadiness(input);
  assert.equal(result.ok, true);
  assert.equal(result.requiredActions.length, 0);
  assert.ok(result.windows.every((window) => window.state === 'ready_reusable'));
});

test('orphan Lark rows, duplicate keys and locked window-field drift block execution', () => {
  const input = baseInput();
  input.larkSchema.windowField.fieldId = 'fld_wrong';
  input.larkWindows = [{
    windowDays: 1,
    snapshotCount: 1,
    metricCount: 58,
    duplicateMetricKeys: 1,
    parity: false,
  }];
  const result = assessWooCommerceReportLiveReadiness(input);
  assert.equal(result.ok, false);
  assert.equal(result.decision, 'BLOCKED');
  assert.ok(result.blockers.some((blocker) => blocker.code === 'LARK_WINDOW_FIELD_IDENTITY_OR_OPTIONS_DRIFT'));
  assert.ok(result.blockers.some((blocker) => blocker.code === 'LARK_ORPHAN_REPORT_ROWS'));
});

test('remote all-false drift and pending migrations are hard blockers', () => {
  const input = baseInput();
  input.remoteWorker.trueFlags = ['MKT_CONNECTOR_CHATWOOT_ENABLED'];
  input.pendingMigrations = ['0021_pending.sql'];
  const result = assessWooCommerceReportLiveReadiness(input);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'REMOTE_WORKER_NOT_ALL_FALSE_OR_TARGET_DRIFT'));
  assert.ok(result.blockers.some((blocker) => blocker.code === 'PENDING_D1_MIGRATIONS'));
});

test('readiness evidence removes credential and target identifier shaped values', () => {
  assert.deepEqual(safeWooCommerceReportReadinessEvidence({
    ok: true,
    accessToken: 'hidden',
    queueId: 'hidden',
    databaseId: 'hidden',
    nested: { LARK_APP_SECRET: 'hidden', windowDays: 1 },
  }), { ok: true, nested: { windowDays: 1 } });
});
