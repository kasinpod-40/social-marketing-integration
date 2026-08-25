import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
  writeReportRuntimeFinalizerEnvironment,
} from '../../scripts/lib/report-runtime-finalizer-environment.js';
import {
  buildNotificationPreservingReportRuntimeConfigWindow,
} from '../../scripts/lib/report-runtime-notification-preserving-config.js';

const HEAD = 'a'.repeat(40);

function config() {
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
      MKT_REPORT_D1_READ_ENABLED: 'false',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'false',
      MKT_REPORT_AI_SUMMARY_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      LARK_TABLE_MKT_SYNC_LOG: 'tbl-sync-log',
      LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl-alerts',
    },
  });
}

function reportMappings() {
  return Object.fromEntries(REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.map(
    (envName, index) => [envName, `tbl-report-${index + 1}`],
  ));
}

function activeAuthority(overrides = {}) {
  const report = reportMappings();
  return {
    state: 'active',
    settingKeys: [1, 3, 7, 30].map(
      (days) => `integration_workspace:facebook:rolling:${days}d`,
    ),
    destinationKeyHash: 'b'.repeat(64),
    workerEnvironment: {
      LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl-notification-ai-runs',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS:
        report.LARK_TABLE_MKT_REPORT_SNAPSHOTS,
      LARK_TABLE_MKT_REPORT_SETTINGS:
        report.LARK_TABLE_MKT_REPORT_SETTINGS,
      LARK_TABLE_MKT_NOTIFICATION_LOG: 'tbl-notification-log',
      ...(overrides.workerEnvironment ?? {}),
    },
  };
}

async function finalizerEvidence(state = 'active', authorityOverride = null) {
  const root = await mkdtemp(join(tmpdir(), 'report-notification-window-'));
  const summaryPath = join(root, 'report-runtime-finalize-summary.json');
  const authority = state === 'active'
    ? authorityOverride ?? activeAuthority()
    : { state: 'inactive' };
  await writeReportRuntimeFinalizerEnvironment({
    evidenceRoot: root,
    repositoryHead: HEAD,
    environmentUpdates: reportMappings(),
    notificationRuntimeAuthority: authority,
  });
  await writeFile(summaryPath, `${JSON.stringify({
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', head: HEAD, clean: true },
    settings: {
      notificationRuntimeState: state,
      preservedNotificationRuntimeSettingCount: state === 'active' ? 4 : 0,
    },
    runtime: { notificationAdmissionEnabled: false },
  })}\n`, { mode: 0o600 });
  return summaryPath;
}

test('active baseline keeps exact Notification flags and adds only Report flags', async () => {
  const finalizerEvidencePath = await finalizerEvidence('active');
  const window = buildNotificationPreservingReportRuntimeConfigWindow(config(), {
    activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    finalizerEvidencePath,
    expectedRepositoryHead: HEAD,
  });
  assert.deepEqual(window.safeTrueFlags, REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS);
  assert.deepEqual(window.activeTrueFlags, [...new Set([
    ...REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
    ...REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  ])].sort());
  assert.equal(window.notificationRuntime.state, 'active');
  const safe = JSON.parse(window.safeText);
  const active = JSON.parse(window.activeText);
  assert.equal(safe.vars.MKT_NOTIFICATION_RUNTIME_MODE, 'runtime');
  assert.equal(active.vars.MKT_NOTIFICATION_RUNTIME_MODE, 'runtime');
  assert.ok(REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS.every(
    (flag) => safe.vars[flag] === 'true' && active.vars[flag] === 'true',
  ));
  assert.equal(safe.vars.MKT_REPORT_D1_READ_ENABLED, 'false');
  assert.equal(active.vars.MKT_REPORT_D1_READ_ENABLED, 'true');
  assert.equal(active.vars.MKT_REPORT_PRESET_MATERIALIZATION_ENABLED, 'true');
  assert.equal(active.vars.MKT_REPORT_AI_SUMMARY_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, 'false');
  assert.equal(
    window.workerTableIds.mktAiReportRuns,
    activeAuthority().workerEnvironment.LARK_TABLE_MKT_AI_REPORT_RUNS,
  );
  assert.equal(
    window.workerTableIds.mktNotificationLog,
    activeAuthority().workerEnvironment.LARK_TABLE_MKT_NOTIFICATION_LOG,
  );
});

test('WooCommerce window preserves Notification baseline and adds exact three Report flags', async () => {
  const finalizerEvidencePath = await finalizerEvidence('active');
  const window = buildNotificationPreservingReportRuntimeConfigWindow(config(), {
    activeTrueFlags: WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    finalizerEvidencePath,
    expectedRepositoryHead: HEAD,
  });
  assert.deepEqual(window.activeTrueFlags, [...new Set([
    ...REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
    ...WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  ])].sort());
  const active = JSON.parse(window.activeText);
  assert.equal(active.vars.MKT_WOOCOMMERCE_REPORT_READ_ENABLED, 'true');
});

test('inactive Finalizer retains the prior all-false baseline', async () => {
  const finalizerEvidencePath = await finalizerEvidence('inactive');
  const window = buildNotificationPreservingReportRuntimeConfigWindow(config(), {
    activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    finalizerEvidencePath,
    expectedRepositoryHead: HEAD,
  });
  assert.deepEqual(window.safeTrueFlags, []);
  assert.deepEqual(
    window.activeTrueFlags,
    [...REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS].sort(),
  );
  assert.equal(window.notificationRuntime.state, 'inactive');
});

test('shared Report and Notification table drift fails before generated config use', async () => {
  const authority = activeAuthority({
    workerEnvironment: {
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl-wrong-snapshots',
    },
  });
  const finalizerEvidencePath = await finalizerEvidence('active', authority);
  assert.throws(
    () => buildNotificationPreservingReportRuntimeConfigWindow(config(), {
      activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
      finalizerEvidencePath,
      expectedRepositoryHead: HEAD,
    }),
    (error) => error.code === 'REPORT_RUNTIME_NOTIFICATION_SHARED_TABLE_MISMATCH',
  );
});

test('Head drift or Notification Admission summary drift fails closed', async () => {
  const finalizerEvidencePath = await finalizerEvidence('active');
  assert.throws(
    () => buildNotificationPreservingReportRuntimeConfigWindow(config(), {
      activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
      finalizerEvidencePath,
      expectedRepositoryHead: 'c'.repeat(40),
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
  );
  const summary = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  summary.runtime.notificationAdmissionEnabled = true;
  await writeFile(finalizerEvidencePath, `${JSON.stringify(summary)}\n`, { mode: 0o600 });
  assert.throws(
    () => buildNotificationPreservingReportRuntimeConfigWindow(config(), {
      activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
      finalizerEvidencePath,
      expectedRepositoryHead: HEAD,
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
  );
});
