import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
} from '../../scripts/lib/report-runtime-finalizer-environment.js';
import {
  REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT,
  REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  assertReportRuntimeCloseoutCompletion,
  assertReportRuntimeCloseoutConfirmation,
  assertReportRuntimeCloseoutPreflight,
  assertReportRuntimeCloseoutReplay,
  assertReportRuntimeFinalizerEvidence,
  assertWooCommerceReportRuntimeCloseoutConfirmation,
  assertWooCommerceReportRuntimeCloseoutPreflight,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
  parseReportRuntimeCloseoutArgs,
  resolveReportRuntimeCloseoutTarget,
  safeReportRuntimeCloseoutEvidence,
  selectFreshReportRuntimeCloseoutCandidate,
} from '../../scripts/lib/report-runtime-closeout-operator.js';

function validConfig() {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: './apps/sync-worker/src/index.js',
    workers_dev: false,
    triggers: { crons: ['*/5 * * * *', '50 0 * * *'] },
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
      database_id: '11111111-1111-4111-8111-111111111111',
      migrations_dir: './migrations',
    }],
    queues: {
      producers: [{ binding: 'MKT_SYNC_QUEUE', queue: 'social-mkt-sync-jobs' }],
      consumers: [
        {
          queue: 'social-mkt-sync-jobs',
          max_concurrency: 1,
          max_batch_size: 10,
          max_batch_timeout: 30,
          max_retries: 5,
          dead_letter_queue: 'social-mkt-sync-dlq',
        },
        {
          queue: 'social-mkt-sync-dlq',
          max_concurrency: 1,
          max_batch_size: 10,
          max_batch_timeout: 30,
          max_retries: 10,
        },
      ],
    },
    vars: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      MKT_REPORT_D1_READ_ENABLED: 'false',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'false',
      MKT_REPORT_AI_SUMMARY_ENABLED: 'false',
      MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
      LARK_TABLE_MKT_REPORT_METRIC_VALUES: 'tbl_metrics',
      LARK_TABLE_MKT_REPORT_TOP_CONTENT: 'tbl_top_content',
      LARK_TABLE_MKT_REPORT_TOP_ADS: 'tbl_top_ads',
      LARK_TABLE_MKT_SYNC_LOG: 'tbl_sync_log',
      LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl_alerts',
    },
  });
}

function validFinalizerEvidence() {
  return {
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', head: 'a'.repeat(40), clean: true },
    gates: Array.from({ length: 6 }, (_, index) => ({ command: String(index), status: 'pass' })),
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
    },
    runtime: {
      reportD1ReadEnabled: false,
      presetMaterializationEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
    },
  };
}

test('Report closeout is plan-only by default and requires exact confirmation', () => {
  assert.deepEqual(parseReportRuntimeCloseoutArgs([]), { execute: false });
  assert.deepEqual(parseReportRuntimeCloseoutArgs(['--execute']), { execute: true });
  assert.throws(() => parseReportRuntimeCloseoutArgs(['--phase=send']));
  assert.throws(() => assertReportRuntimeCloseoutConfirmation({}));
  assert.equal(assertReportRuntimeCloseoutConfirmation({
    CONFIRM_REPORT_RUNTIME_CLOSEOUT: REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  }), true);
});

test('WooCommerce Report closeout uses an explicit target and separate confirmation', () => {
  assert.throws(() => assertWooCommerceReportRuntimeCloseoutConfirmation({}));
  assert.equal(assertWooCommerceReportRuntimeCloseoutConfirmation({
    CONFIRM_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT:
      WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  }), true);
  const target = resolveReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'woocommerce',
  });
  assert.equal(target.platformScope, 'woocommerce');
  assert.equal(target.capability, 'commerce');
  assert.deepEqual(
    target.activeTrueFlags,
    WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  );
  assert.throws(
    () => resolveReportRuntimeCloseoutTarget({
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'meta_ads',
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_PLATFORM_UNSUPPORTED',
  );
});

test('Report closeout config creates an exact two-flag window and all-false restore', () => {
  const window = buildReportRuntimeCloseoutConfigWindow(validConfig());
  assert.deepEqual(window.safeTrueFlags, []);
  assert.deepEqual(window.activeTrueFlags, [...REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS].sort());
  assert.equal(window.tableIds.mktReportTopAds, 'tbl_top_ads');
  const safe = JSON.parse(window.safeText);
  const active = JSON.parse(window.activeText);
  assert.equal(safe.vars.MKT_CONNECTOR_TIKTOK_ENABLED, 'false');
  assert.equal(active.vars.MKT_CONNECTOR_TIKTOK_ENABLED, 'false');
  assert.equal(active.vars.MKT_REPORT_D1_READ_ENABLED, 'true');
  assert.equal(active.vars.MKT_REPORT_PRESET_MATERIALIZATION_ENABLED, 'true');
  assert.equal(active.vars.MKT_REPORT_AI_SUMMARY_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, 'false');
});

test('WooCommerce Report closeout config creates an exact three-flag report-only window', () => {
  const window = buildReportRuntimeCloseoutConfigWindow(validConfig(), {
    activeTrueFlags: WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  });
  assert.deepEqual(window.safeTrueFlags, []);
  assert.deepEqual(
    window.activeTrueFlags,
    [...WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS].sort(),
  );
  assert.equal(window.tableIds.mktReportTopAds, 'tbl_top_ads');
  const active = JSON.parse(window.activeText);
  assert.equal(active.vars.MKT_CONNECTOR_TIKTOK_ENABLED, 'false');
  assert.equal(active.vars.MKT_REPORT_D1_READ_ENABLED, 'true');
  assert.equal(active.vars.MKT_REPORT_PRESET_MATERIALIZATION_ENABLED, 'true');
  assert.equal(active.vars.MKT_WOOCOMMERCE_REPORT_READ_ENABLED, 'true');
  assert.equal(active.vars.MKT_REPORT_AI_SUMMARY_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, 'false');
});

test('Report closeout bridges Finalizer mappings and materializes the missing Woo flag safely', () => {
  const source = JSON.parse(validConfig());
  delete source.vars.LARK_TABLE_MKT_REPORT_TOP_ADS;
  delete source.vars.MKT_WOOCOMMERCE_REPORT_READ_ENABLED;

  const window = buildReportRuntimeCloseoutConfigWindow(JSON.stringify(source), {
    activeTrueFlags: WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    finalizerEnvironment: {
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_final_snapshots',
      LARK_TABLE_MKT_REPORT_METRIC_VALUES: 'tbl_final_metrics',
      LARK_TABLE_MKT_REPORT_TOP_CONTENT: 'tbl_final_top_content',
      LARK_TABLE_MKT_REPORT_TOP_ADS: 'tbl_final_top_ads',
    },
  });

  assert.equal(window.tableIds.mktReportSnapshots, 'tbl_final_snapshots');
  assert.equal(window.tableIds.mktReportMetricValues, 'tbl_final_metrics');
  assert.equal(window.tableIds.mktReportTopContent, 'tbl_final_top_content');
  assert.equal(window.tableIds.mktReportTopAds, 'tbl_final_top_ads');
  const safe = JSON.parse(window.safeText);
  const active = JSON.parse(window.activeText);
  assert.equal(safe.vars.MKT_WOOCOMMERCE_REPORT_READ_ENABLED, 'false');
  assert.equal(active.vars.MKT_WOOCOMMERCE_REPORT_READ_ENABLED, 'true');
  assert.deepEqual(window.safeTrueFlags, []);
  assert.deepEqual(
    window.activeTrueFlags,
    [...WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS].sort(),
  );
});

test('Report closeout does not synthesize missing generic execution flags', () => {
  const source = JSON.parse(validConfig());
  delete source.vars.MKT_REPORT_D1_READ_ENABLED;
  assert.throws(
    () => buildReportRuntimeCloseoutConfigWindow(JSON.stringify(source)),
    (error) => (
      error.code === 'REPORT_RUNTIME_CLOSEOUT_CONFIG_FLAG_MISSING'
      && error.details?.flag === 'MKT_REPORT_D1_READ_ENABLED'
    ),
  );
});

test('Report closeout selects a fresh deterministic preset identity', () => {
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: Date.parse('2026-07-28T12:00:00Z'),
    periodEnd: '2026-07-27',
    sourceWatermark: 'coverage-watermark',
  });
  assert.equal(candidates.length, 7);
  assert.equal(candidates[0].windowDays, 1);
  assert.equal(candidates[0].job.type, 'report.materialization.generate');
  assert.equal(candidates[0].job.trigger, 'dashboard_preset');
  const selected = selectFreshReportRuntimeCloseoutCandidate(candidates, [candidates[0].reportId]);
  assert.equal(selected.windowDays, 3);
  assert.throws(() => selectFreshReportRuntimeCloseoutCandidate(
    candidates,
    candidates.map((candidate) => candidate.reportId),
  ));
});

test('WooCommerce Report closeout candidates use Commerce platform and formula identity', () => {
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: Date.parse('2026-07-30T12:00:00Z'),
    periodEnd: '2026-07-29',
    sourceWatermark: 'woo-coverage-watermark',
    platformScope: 'woocommerce',
    accountKey: 'chemistry_k',
    formulaVersion: 'woocommerce-commerce-v1',
  });
  assert.equal(candidates[0].reportSettingKey, 'integration_workspace:woocommerce:rolling:1d');
  assert.equal(candidates[0].job.platformScope, 'woocommerce');
  assert.equal(
    candidates[0].reportId,
    'integration_workspace:woocommerce:rolling:1d:chemistry_k:rolling_days:2026-07-29:2026-07-29:woocommerce-commerce-v1',
  );
});

test('Report closeout can target fresh 1D and 30D presets explicitly', () => {
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: Date.parse('2026-07-28T12:00:00Z'),
    periodEnd: '2026-07-27',
    sourceWatermark: 'coverage-watermark',
  });
  assert.equal(selectFreshReportRuntimeCloseoutCandidate(candidates, [], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '1',
  }).windowDays, 1);
  assert.equal(selectFreshReportRuntimeCloseoutCandidate(candidates, [], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '30',
  }).windowDays, 30);
  const thirty = candidates.find((candidate) => candidate.windowDays === 30);
  assert.throws(() => selectFreshReportRuntimeCloseoutCandidate(candidates, [thirty.reportId], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '30',
  }), (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_FRESH_PRESET_UNAVAILABLE');
  assert.throws(() => selectFreshReportRuntimeCloseoutCandidate(candidates, [], {
    MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: '31',
  }), (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_WINDOW_INVALID');
});

test('Report closeout requires validated finalizer and D1 readiness evidence', () => {
  assert.equal(REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT, 74);
  assert.equal(assertReportRuntimeFinalizerEvidence(validFinalizerEvidence()), true);
  assert.throws(() => assertReportRuntimeFinalizerEvidence({
    ...validFinalizerEvidence(),
    settings: {
      ...validFinalizerEvidence().settings,
      canonicalActive: REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT - 1,
    },
  }));
  assert.equal(assertReportRuntimeCloseoutPreflight({
    coverage_status: 'complete',
    source_watermark: 'watermark',
    period_end: '2026-07-27',
    content_state_count: 100,
    observation_count: 200,
    active_report_locks: 0,
    open_report_dlq: 0,
  }), true);
  assert.throws(() => assertReportRuntimeCloseoutPreflight({
    coverage_status: 'complete',
    source_watermark: '',
    period_end: '2026-07-27',
    content_state_count: 100,
    observation_count: 200,
    active_report_locks: 0,
    open_report_dlq: 0,
  }));
});

test('WooCommerce Report closeout accepts reviewed full, recent or bounded Commerce coverage', () => {
  const ready = {
    coverage_status: 'complete',
    coverage_scope_mode: 'full_inventory',
    source_watermark: 'woo-watermark',
    period_end: '2026-07-29',
    daily_fact_count: 100,
    order_state_count: 200,
    active_report_locks: 0,
    open_report_dlq: 0,
  };
  assert.equal(assertWooCommerceReportRuntimeCloseoutPreflight(ready), true);
  assert.equal(assertWooCommerceReportRuntimeCloseoutPreflight({
    ...ready,
    coverage_scope_mode: 'recent_window',
  }), true);
  assert.equal(assertWooCommerceReportRuntimeCloseoutPreflight({
    ...ready,
    coverage_scope_mode: 'report_range',
  }), true);
  assert.throws(
    () => assertWooCommerceReportRuntimeCloseoutPreflight({
      ...ready,
      coverage_scope_mode: 'unknown',
    }),
    (error) => error.code === 'WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY',
  );
});

test('Report closeout verifies completed materialization and stable replay', () => {
  const first = {
    report_id: 'report-id',
    data_status: 'complete',
    payload_checksum: 'checksum',
    sync_status: 'success',
    materialization_count: 1,
    successful_sync_count: 1,
    active_lock_count: 0,
    new_dlq_count: 0,
  };
  const replay = { ...first, successful_sync_count: 2 };
  assert.equal(assertReportRuntimeCloseoutCompletion(first, { reportId: 'report-id' }), true);
  assert.equal(assertReportRuntimeCloseoutReplay(first, replay), true);
  assert.throws(() => assertReportRuntimeCloseoutReplay(first, { ...replay, payload_checksum: 'changed' }));
  assert.throws(() => assertReportRuntimeCloseoutCompletion({ ...first, materialization_count: 2 }, { reportId: 'report-id' }));
});

test('Report closeout evidence strips credential-shaped keys', () => {
  assert.deepEqual(safeReportRuntimeCloseoutEvidence({
    ok: true,
    accessToken: 'nope',
    nested: { LARK_APP_SECRET: 'nope', reportId: 'report-id' },
  }), { ok: true, nested: { reportId: 'report-id' } });
});

test('Report closeout Lark preflight uses the shared reliability sync_id key', () => {
  const source = readFileSync(
    new URL('../../scripts/report-runtime-closeout-operator.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /mktSyncLog:\s*'sync_id'/u);
  assert.doesNotMatch(source, /mktSyncLog:\s*'sync_run_id'/u);
});

test('WooCommerce one-command wrapper pins Commerce mode and runs finalizer first', () => {
  const source = readFileSync(
    new URL('../../scripts/woocommerce-report-runtime-closeout.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE:\s*'woocommerce'/u);
  assert.match(source, /assertWooCommerceReportRuntimeCloseoutConfirmation/u);
  assert.match(
    source,
    /runRequiredStep\(\s*'report-runtime-finalizer'[\s\S]*runRequiredStep\(\s*'woocommerce-report-runtime-closeout'/u,
  );
  assert.match(source, /CONFIRM_REPORT_RUNTIME_FINALIZE:\s*'EXECUTE_REPORT_RUNTIME_FINALIZE'/u);
});
