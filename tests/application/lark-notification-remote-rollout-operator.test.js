import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION,
  LARK_NOTIFICATION_REMOTE_INDEXES,
  LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIRMATIONS,
  assertLarkNotificationRemoteRolloutConfirmation,
  auditLarkNotificationMigrationSource,
  buildLarkNotificationControlledUatJob,
  buildLarkNotificationRemotePreflightSql,
  buildLarkNotificationRemoteSchemaReadbackSql,
  createLarkNotificationRemoteTargetFingerprint,
  extractLarkNotificationWranglerD1Rows,
  loadLarkNotificationRemoteRolloutTarget,
  parseLarkNotificationRemoteRolloutArgs,
  sha256Hex,
  validateLarkNotificationBackupEvidence,
  validateLarkNotificationNoPendingMigrations,
  validateLarkNotificationPendingMigrations,
  validateLarkNotificationRemotePreflightRow,
  validateLarkNotificationRemoteSchemaReadbackRow,
  validateLarkNotificationRemoteWranglerConfig,
} from '../../scripts/lib/lark-notification-remote-rollout-operator.js';

const repositoryRoot = new URL('../../', import.meta.url);

test('notification rollout defaults to plan and rejects unsupported phases', () => {
  assert.deepEqual(parseLarkNotificationRemoteRolloutArgs([]), {
    phase: 'plan',
    execute: false,
  });
  assert.deepEqual(
    parseLarkNotificationRemoteRolloutArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseLarkNotificationRemoteRolloutArgs(['--phase=send-message', '--execute']),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_PHASE_INVALID',
  );
});

test('every executable phase requires a distinct exact confirmation', () => {
  const values = new Set();
  for (const [phase, contract] of Object.entries(
    LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIRMATIONS,
  )) {
    assert.equal(values.has(contract.value), false);
    values.add(contract.value);
    assert.throws(
      () => assertLarkNotificationRemoteRolloutConfirmation(phase, {}),
      (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIRMATION_REQUIRED',
    );
    assert.equal(assertLarkNotificationRemoteRolloutConfirmation(phase, {
      [contract.envName]: contract.value,
    }), true);
  }
  assert.equal(assertLarkNotificationRemoteRolloutConfirmation('plan', {}), true);
});

test('target stays locked to the Integration Workspace and expected D1', () => {
  const target = loadLarkNotificationRemoteRolloutTarget(createTargetEnv());
  assert.deepEqual(target, {
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    databaseName: 'social-mkt-state-dev',
    wranglerConfig: 'wrangler.sync.jsonc',
  });
  const fingerprint = createLarkNotificationRemoteTargetFingerprint(target, {
    workerName: 'social-mkt-sync-worker',
    tableMappingFingerprint: 'a'.repeat(64),
  });
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => loadLarkNotificationRemoteRolloutTarget({
      ...createTargetEnv(),
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    }),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_TARGET_INVALID',
  );
});

test('Wrangler config reuses Integration topology and validates every effective flag source', () => {
  const config = createSafeWranglerConfig();
  const result = validateLarkNotificationRemoteWranglerConfig(config);
  assert.equal(result.notificationFlagsAllFalse, true);
  assert.equal(
    result.notificationFlagSourcePolicy,
    'all_config_and_environment_sources_false_or_omitted',
  );
  assert.equal(result.requiredTableMappingsPresent, true);
  assert.equal(result.mainQueueBindingPresent, true);

  const omittedFlagsConfig = createSafeWranglerConfig({ includeNotificationFlags: false });
  const omittedResult = validateLarkNotificationRemoteWranglerConfig(omittedFlagsConfig);
  assert.equal(omittedResult.notificationFlagsAllFalse, true);

  for (const flag of [
    'MKT_NOTIFICATION_RUNTIME_ENABLED',
    'MKT_NOTIFICATION_LARK_SEND_ENABLED',
    'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
  ]) {
    assert.throws(
      () => validateLarkNotificationRemoteWranglerConfig(config, { [flag]: 'true' }),
      (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE'
        && error.details.fieldName === flag
        && error.details.invalidSources.includes('environment'),
    );
    assert.throws(
      () => validateLarkNotificationRemoteWranglerConfig(config.replace(
        `"${flag}": "false"`,
        `"${flag}": "true"`,
      )),
      (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE'
        && error.details.fieldName === flag,
    );
  }
});

test('table mappings resolve from merged environment, remain conflict-free and are fingerprint-bound', () => {
  const configWithoutMappings = createSafeWranglerConfig({ includeTableMappings: false });
  const envMappings = createTableMappingEnv();
  const result = validateLarkNotificationRemoteWranglerConfig(
    configWithoutMappings,
    envMappings,
  );
  assert.equal(result.requiredTableMappingsPresent, true);
  assert.equal(
    result.tableMappingSourcePolicy,
    'wrangler_or_merged_environment_exact_and_conflict_free',
  );
  assert.match(result.tableMappingFingerprint, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    new Set(Object.values(result.tableMappingSources)),
    new Set(['environment']),
  );

  const target = loadLarkNotificationRemoteRolloutTarget(createTargetEnv());
  const fingerprint = createLarkNotificationRemoteTargetFingerprint(target, result);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);

  assert.throws(
    () => validateLarkNotificationRemoteWranglerConfig(configWithoutMappings, {
      ...envMappings,
      LARK_TABLE_MKT_AI_REPORT_RUNS: '',
    }),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE'
      && error.details.fieldName === 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  );
  assert.throws(
    () => validateLarkNotificationRemoteWranglerConfig(configWithoutMappings, {
      ...envMappings,
      LARK_TABLE_MKT_AI_REPORT_RUNS: 'todo',
    }),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE'
      && error.details.invalidSource === 'environment',
  );
  assert.throws(
    () => validateLarkNotificationRemoteWranglerConfig(
      createSafeWranglerConfig(),
      { ...envMappings, LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_conflict' },
    ),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE'
      && error.details.sourceConflict === true,
  );
});

test('Migration 0019 is exact, additive and preserves atomic delivery authority', async () => {
  const sql = await readFile(
    new URL('migrations/0019_lark_notification_delivery.sql', repositoryRoot),
    'utf8',
  );
  const audit = auditLarkNotificationMigrationSource(sql);
  assert.equal(audit.migration, LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION);
  assert.equal(audit.tableCount, 1);
  assert.equal(audit.indexCount, LARK_NOTIFICATION_REMOTE_INDEXES.length);
  assert.equal(audit.destructiveCount, 0);
  assert.match(audit.sha256, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => auditLarkNotificationMigrationSource(`${sql}\nDROP TABLE lark_notification_deliveries;`),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_MIGRATION_SOURCE_INVALID',
  );
});

test('migration ledger accepts only pending 0019 and none after apply', () => {
  assert.deepEqual(
    validateLarkNotificationPendingMigrations('0019_lark_notification_delivery.sql'),
    ['0019_lark_notification_delivery.sql'],
  );
  assert.equal(validateLarkNotificationNoPendingMigrations('No migrations to apply!'), true);
  assert.throws(
    () => validateLarkNotificationPendingMigrations([
      '0019_lark_notification_delivery.sql',
      '0020_unreviewed.sql',
    ].join('\n')),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_PENDING_MIGRATIONS_MISMATCH',
  );
});

test('preflight SQL is read-only and checks actual active work and locks', () => {
  const sql = buildLarkNotificationRemotePreflightSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/iu);
  const row = createPreflightRow();
  assert.deepEqual(validateLarkNotificationRemotePreflightRow(row), row);
  for (const field of [
    'notification_table_count',
    'notification_index_count',
    'active_work',
    'active_locks',
  ]) {
    assert.throws(
      () => validateLarkNotificationRemotePreflightRow({ ...row, [field]: 1 }),
      (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_PREFLIGHT_FAILED',
    );
  }
});

test('schema read-back requires exact empty 0019 schema and Shared fact parity', () => {
  const sql = buildLarkNotificationRemoteSchemaReadbackSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/iu);
  const before = createPreflightRow();
  const after = createSchemaReadbackRow(before);
  assert.deepEqual(validateLarkNotificationRemoteSchemaReadbackRow(after, before), after);
  assert.throws(
    () => validateLarkNotificationRemoteSchemaReadbackRow({
      ...after,
      notification_delivery_rows: 1,
    }, before),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED',
  );
  assert.throws(
    () => validateLarkNotificationRemoteSchemaReadbackRow({
      ...after,
      coverage_entities: before.coverage_entities + 1,
    }, before),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED',
  );
});

test('Wrangler D1 extraction and backup evidence stay fail closed', () => {
  assert.deepEqual(extractLarkNotificationWranglerD1Rows(JSON.stringify([{
    success: true,
    results: [{ value: 1 }],
  }])), [{ value: 1 }]);
  const contents = Buffer.from('PRAGMA foreign_keys=OFF;\n');
  const evidence = {
    phase: 'backup',
    status: 'passed',
    sizeBytes: contents.byteLength,
    sha256: sha256Hex(contents),
    migration: LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION,
    targetFingerprint: 'a'.repeat(64),
  };
  assert.equal(validateLarkNotificationBackupEvidence(evidence, contents), evidence);
  assert.throws(
    () => validateLarkNotificationBackupEvidence(evidence, Buffer.from('changed')),
    (error) => error.code === 'LARK_NOTIFICATION_REMOTE_ROLLOUT_BACKUP_INVALID',
  );
});

test('controlled UAT payload uses the central Job and stable Queue contracts', () => {
  const requestedAt = Date.UTC(2026, 7, 4, 7, 0, 0);
  const body = buildLarkNotificationControlledUatJob({
    aiRunKey: 'ai:executive:30d:2026-08-04',
    operationId: 'lark-notification-uat-20260804',
    requestedAt,
  });
  assert.equal(body.type, 'lark.notification.send');
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.trigger, 'lark_notification_controlled_uat');
  assert.equal(body.operationId, 'lark-notification-uat-20260804');
  assert.equal(body.workKey, 'lark_notification:lark-notification-uat-20260804');
  assert.equal(body.generation, requestedAt);
  assert.equal(body.originalRequestedAt, requestedAt);
});

test('operator is plan-only by default and contains no deploy or send path', async () => {
  const script = resolve('scripts/lark-notification-remote-rollout-operator.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.executed, false);
  assert.equal(output.contractVersion, 'lark_notification_remote_rollout_v1');
  assert.equal(output.safety.queueSend, false);
  assert.equal(output.safety.workerDeployment, false);
  assert.equal(output.safety.production, false);

  const source = await readFile(new URL(
    'scripts/lark-notification-remote-rollout-operator.mjs',
    repositoryRoot,
  ), 'utf8');
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /queues['",\s]+send/iu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /LarkMessageClient|TableSyncEngine/u);
});

function createTargetEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_NOTIFICATION_ROLLOUT_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_NOTIFICATION_ROLLOUT_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
  };
}

function createTableMappingEnv() {
  return {
    LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai_runs',
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_report_snapshots',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_report_settings',
    LARK_TABLE_MKT_NOTIFICATION_LOG: 'tbl_notification_log',
  };
}

function createSafeWranglerConfig(input = {}) {
  const vars = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  };
  if (input.includeTableMappings !== false) {
    Object.assign(vars, createTableMappingEnv());
  }
  if (input.includeNotificationFlags !== false) {
    Object.assign(vars, {
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_SEND_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'false',
    });
  }
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    vars,
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
    }],
    queues: {
      producers: [{ binding: 'MKT_SYNC_QUEUE', queue: 'social-mkt-sync-jobs' }],
      consumers: [{
        queue: 'social-mkt-sync-jobs',
        dead_letter_queue: 'social-mkt-sync-dlq',
      }],
    },
  }, null, 2);
}

function createPreflightRow() {
  return {
    notification_table_count: 0,
    notification_index_count: 0,
    active_work: 0,
    active_locks: 0,
    sync_runs: 120,
    sync_jobs: 80,
    coverage_runs: 40,
    coverage_entities: 3396,
    organic_content_state: 2021,
    organic_content_observations: 2021,
  };
}

function createSchemaReadbackRow(before) {
  return {
    notification_table_count: 1,
    notification_index_count: LARK_NOTIFICATION_REMOTE_INDEXES.length,
    notification_delivery_rows: 0,
    active_work: 0,
    active_locks: 0,
    sync_runs: before.sync_runs,
    sync_jobs: before.sync_jobs,
    coverage_runs: before.coverage_runs,
    coverage_entities: before.coverage_entities,
    organic_content_state: before.organic_content_state,
    organic_content_observations: before.organic_content_observations,
  };
}
