import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHATWOOT_REMOTE_EXPECTED_MIGRATION,
  CHATWOOT_REMOTE_INDEXES,
  CHATWOOT_REMOTE_READINESS_CONFIRMATIONS,
  CHATWOOT_REMOTE_TABLES,
  assertChatwootRemoteReadinessConfirmation,
  auditChatwootMigrationSource,
  buildChatwootRemotePreflightSql,
  buildChatwootRemoteSchemaReadbackSql,
  createChatwootRemoteTargetFingerprint,
  extractChatwootWranglerD1Rows,
  loadChatwootRemoteReadinessTarget,
  parseChatwootRemoteReadinessArgs,
  sha256Hex,
  validateChatwootBackupEvidence,
  validateChatwootNoPendingMigrations,
  validateChatwootPendingMigrations,
  validateChatwootRemotePreflightRow,
  validateChatwootRemoteSchemaReadbackRow,
  validateChatwootRemoteWranglerConfig,
} from '../../scripts/lib/chatwoot-remote-readiness-operator.js';

const repositoryRoot = new URL('../../', import.meta.url);

test('Chatwoot readiness defaults to plan and rejects unsupported phases', () => {
  assert.deepEqual(parseChatwootRemoteReadinessArgs([]), {
    phase: 'plan',
    execute: false,
  });
  assert.deepEqual(
    parseChatwootRemoteReadinessArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseChatwootRemoteReadinessArgs(['--phase=provider-live', '--execute']),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_PHASE_INVALID',
  );
});

test('every executable Chatwoot phase requires a distinct exact confirmation', () => {
  const values = new Set();
  for (const [phase, contract] of Object.entries(CHATWOOT_REMOTE_READINESS_CONFIRMATIONS)) {
    assert.equal(values.has(contract.value), false);
    values.add(contract.value);
    assert.throws(
      () => assertChatwootRemoteReadinessConfirmation(phase, {}),
      (error) => error.code === 'CHATWOOT_REMOTE_READINESS_CONFIRMATION_REQUIRED',
    );
    assert.equal(assertChatwootRemoteReadinessConfirmation(phase, {
      [contract.envName]: contract.value,
    }), true);
  }
  assert.equal(assertChatwootRemoteReadinessConfirmation('plan', {}), true);
});

test('target is locked to the Integration Workspace without Provider credentials', () => {
  const target = loadChatwootRemoteReadinessTarget(createTargetEnv());
  assert.deepEqual(target, {
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    databaseName: 'social-mkt-state-dev',
    wranglerConfig: 'wrangler.sync.jsonc',
  });
  const fingerprint = createChatwootRemoteTargetFingerprint(target, {
    workerName: 'social-mkt-sync-worker',
  });
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => loadChatwootRemoteReadinessTarget({
      ...createTargetEnv(),
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    }),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_TARGET_INVALID',
  );
});

test('Wrangler config requires exact topology and all execution flags false', async () => {
  const config = await createSafeWranglerConfig();
  const result = validateChatwootRemoteWranglerConfig(config);
  assert.equal(result.allExecutionFlagsFalse, true);
  assert.equal(result.d1BindingPresent, true);
  assert.throws(
    () => validateChatwootRemoteWranglerConfig(config.replace(
      '"MKT_CONNECTOR_CHATWOOT_ENABLED": "false"',
      '"MKT_CONNECTOR_CHATWOOT_ENABLED": "true"',
    )),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_CONFIG_UNSAFE',
  );
  assert.throws(
    () => validateChatwootRemoteWranglerConfig(config.replace(
      '"MKT_DLQ_REDRIVE_ENABLED": "false"',
      '"MKT_DLQ_REDRIVE_ENABLED": "true"',
    )),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_CONFIG_UNSAFE',
  );
});

test('Migration 0018 source is exact, additive and PII-safe by structure', async () => {
  const sql = await readFile(
    new URL('migrations/0018_chatwoot_analytics.sql', repositoryRoot),
    'utf8',
  );
  const audit = auditChatwootMigrationSource(sql);
  assert.equal(audit.migration, CHATWOOT_REMOTE_EXPECTED_MIGRATION);
  assert.equal(audit.tableCount, CHATWOOT_REMOTE_TABLES.length);
  assert.equal(audit.indexCount, CHATWOOT_REMOTE_INDEXES.length);
  assert.equal(audit.destructiveCount, 0);
  assert.match(audit.sha256, /^[0-9a-f]{64}$/u);
  assert.throws(
    () => auditChatwootMigrationSource(`${sql}\nDROP TABLE chatwoot_account_state;`),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_MIGRATION_SOURCE_INVALID',
  );
});

test('migration ledger accepts only pending 0018 and none after apply', () => {
  assert.deepEqual(
    validateChatwootPendingMigrations('0018_chatwoot_analytics.sql'),
    ['0018_chatwoot_analytics.sql'],
  );
  assert.equal(validateChatwootNoPendingMigrations('No migrations to apply!'), true);
  assert.throws(
    () => validateChatwootPendingMigrations([
      '0018_chatwoot_analytics.sql',
      '0019_unreviewed.sql',
    ].join('\n')),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_PENDING_MIGRATIONS_MISMATCH',
  );
  assert.throws(
    () => validateChatwootPendingMigrations('No migrations to apply!'),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_PENDING_MIGRATIONS_MISMATCH',
  );
});

test('preflight SQL is read-only and rejects active work, locks or existing schema', () => {
  const sql = buildChatwootRemotePreflightSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/iu);
  const row = createPreflightRow();
  assert.deepEqual(validateChatwootRemotePreflightRow(row), row);
  for (const field of [
    'chatwoot_table_count',
    'chatwoot_index_count',
    'active_work',
    'active_locks',
  ]) {
    assert.throws(
      () => validateChatwootRemotePreflightRow({ ...row, [field]: 1 }),
      (error) => error.code === 'CHATWOOT_REMOTE_READINESS_PREFLIGHT_FAILED',
    );
  }
});

test('schema read-back requires 14 tables, 15 indexes, zero rows and Shared parity', () => {
  const sql = buildChatwootRemoteSchemaReadbackSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)\b/iu);
  const before = createPreflightRow();
  const after = createSchemaReadbackRow(before);
  assert.deepEqual(validateChatwootRemoteSchemaReadbackRow(after, before), after);
  assert.throws(
    () => validateChatwootRemoteSchemaReadbackRow({
      ...after,
      chatwoot_conversation_state_rows: 1,
    }, before),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_SCHEMA_READBACK_FAILED',
  );
  assert.throws(
    () => validateChatwootRemoteSchemaReadbackRow({
      ...after,
      coverage_entities: before.coverage_entities + 1,
    }, before),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_SCHEMA_READBACK_FAILED',
  );
});

test('Wrangler D1 row extraction supports standard envelopes', () => {
  assert.deepEqual(extractChatwootWranglerD1Rows(JSON.stringify([{
    success: true,
    results: [{ value: 1 }],
  }])), [{ value: 1 }]);
  assert.throws(
    () => extractChatwootWranglerD1Rows(JSON.stringify([{ success: true, results: [] }])),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_D1_RESPONSE_EMPTY',
  );
});

test('backup evidence is non-empty, target-bound and checksum-verified', () => {
  const contents = Buffer.from('PRAGMA foreign_keys=OFF;\n');
  const evidence = {
    phase: 'backup',
    status: 'passed',
    sizeBytes: contents.byteLength,
    sha256: sha256Hex(contents),
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    targetFingerprint: 'a'.repeat(64),
  };
  assert.equal(validateChatwootBackupEvidence(evidence, contents), evidence);
  assert.throws(
    () => validateChatwootBackupEvidence(evidence, Buffer.from('changed')),
    (error) => error.code === 'CHATWOOT_REMOTE_READINESS_BACKUP_INVALID',
  );
});

test('operator uses the supported Wrangler JSON format for Secret listing', async () => {
  const source = await readFile(
    new URL('scripts/chatwoot-remote-readiness-operator.mjs', repositoryRoot),
    'utf8',
  );
  const command = source.match(
    /runCommand\('npx', \[\s*'wrangler', 'secret', 'list',([\s\S]*?)\]\)/u,
  );
  assert.ok(command);
  assert.match(command[1], /'--format', 'json'/u);
  assert.doesNotMatch(command[1], /'--json'/u);
});

test('operator contains no Provider, Queue, Lark or Worker deployment execution path', async () => {
  const source = await readFile(
    new URL('scripts/chatwoot-remote-readiness-operator.mjs', repositoryRoot),
    'utf8',
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /queues['",\s]+send/iu);
  assert.doesNotMatch(source, /LarkClient|TableSyncEngine|ChatwootApiClient/u);
});

function createTargetEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_CHATWOOT_ROLLOUT_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
  };
}

async function createSafeWranglerConfig() {
  const text = await readFile(
    new URL('wrangler.sync.example.jsonc', repositoryRoot),
    'utf8',
  );
  return text.replace(
    '"database_name": "replace-with-environment-specific-d1-name"',
    '"database_name": "social-mkt-state-dev"',
  );
}

function createPreflightRow() {
  return {
    chatwoot_table_count: 0,
    chatwoot_index_count: 0,
    active_work: 0,
    active_locks: 0,
    open_dlq: 0,
    open_alerts: 0,
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
    chatwoot_table_count: CHATWOOT_REMOTE_TABLES.length,
    chatwoot_index_count: CHATWOOT_REMOTE_INDEXES.length,
    ...Object.fromEntries(CHATWOOT_REMOTE_TABLES.map((table) => [`${table}_rows`, 0])),
    active_work: 0,
    active_locks: 0,
    open_dlq: before.open_dlq,
    open_alerts: before.open_alerts,
    sync_runs: before.sync_runs,
    sync_jobs: before.sync_jobs,
    coverage_runs: before.coverage_runs,
    coverage_entities: before.coverage_entities,
    organic_content_state: before.organic_content_state,
    organic_content_observations: before.organic_content_observations,
  };
}
