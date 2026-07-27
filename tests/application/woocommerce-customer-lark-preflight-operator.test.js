import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WOOCOMMERCE_D1_INDEXES,
  WOOCOMMERCE_D1_TABLES,
  WOOCOMMERCE_LARK_KEYS,
  assertWooCommercePreflightConfirmation,
  auditWooCommerceMigrationSource,
  buildWooCommerceRemotePreflightSql,
  classifyWooCommerceMigrationState,
  decideWooCommerceReadinessSummary,
  loadWooCommercePreflightTarget,
  parseWooCommercePreflightArgs,
  validateWooCommerceCommerceReadbackRow,
  validateWooCommerceLarkInventory,
  validateWooCommerceProviderSnapshot,
  validateWooCommerceRemotePreflightRow,
} from '../../scripts/lib/woocommerce-customer-lark-preflight.js';

function targetEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_WOOCOMMERCE_ROLLOUT_REPOSITORY_HEAD: 'a'.repeat(40),
    MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME: 'social-mkt-sync-worker',
  };
}

test('argument parser is plan-only by default and rejects unknown phases', () => {
  assert.deepEqual(parseWooCommercePreflightArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseWooCommercePreflightArgs(['--phase=remote-preflight', '--execute']),
    { phase: 'remote-preflight', execute: true },
  );
  assert.throws(() => parseWooCommercePreflightArgs(['--phase=deploy']), /Unsupported/);
});

test('each executable phase requires its own exact confirmation', () => {
  assert.throws(
    () => assertWooCommercePreflightConfirmation('remote-preflight', {}),
    /CONFIRM_WOOCOMMERCE_REMOTE_PREFLIGHT/,
  );
  assert.equal(assertWooCommercePreflightConfirmation('remote-preflight', {
    CONFIRM_WOOCOMMERCE_REMOTE_PREFLIGHT: 'READ_ONLY_WOOCOMMERCE_REMOTE_PREFLIGHT',
  }), true);
});

test('target is locked to Chemistry K Integration Workspace', () => {
  assert.equal(loadWooCommercePreflightTarget(targetEnv()).databaseName, 'social-mkt-state-dev');
  assert.throws(
    () => loadWooCommercePreflightTarget({ ...targetEnv(), MKT_CONNECTION_CUSTOMER_KEY: 'other' }),
    /must equal chemistry_k/,
  );
});

test('migration source audit accepts exact additive schema and rejects mutations', () => {
  const sql = [
    ...WOOCOMMERCE_D1_TABLES.map((name) => `CREATE TABLE IF NOT EXISTS ${name} (id TEXT);`),
    ...WOOCOMMERCE_D1_INDEXES.map((name, index) => (
      `CREATE INDEX IF NOT EXISTS ${name} ON ${WOOCOMMERCE_D1_TABLES[index % WOOCOMMERCE_D1_TABLES.length]} (id);`
    )),
  ].join('\n');
  const audit = auditWooCommerceMigrationSource(sql);
  assert.equal(audit.tableCount, 17);
  assert.equal(audit.indexCount, 13);
  assert.throws(() => auditWooCommerceMigrationSource(`${sql}\nDELETE FROM sync_runs;`));
});

test('migration state accepts only no pending migration or 0017 alone', () => {
  assert.equal(classifyWooCommerceMigrationState('No migrations to apply').state, 'applied_or_no_pending');
  assert.equal(
    classifyWooCommerceMigrationState('0017_woocommerce_commerce.sql').state,
    'pending_0017_only',
  );
  assert.throws(
    () => classifyWooCommerceMigrationState('0017_woocommerce_commerce.sql 0018_chatwoot_analytics.sql'),
    /unexpected pending set/,
  );
});

test('Remote preflight SQL is SELECT-only and scopes exact schema names', () => {
  const sql = buildWooCommerceRemotePreflightSql();
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/iu);
  assert.match(sql, /raw_commerce_orders/u);
});

test('Remote preflight enforces zero active work and ledger/schema parity', () => {
  const base = { active_work: 0, active_locks: 0, open_dlq: 0, open_alerts: 0 };
  assert.equal(validateWooCommerceRemotePreflightRow({
    ...base,
    commerce_table_count: 0,
    commerce_index_count: 0,
  }, { state: 'pending_0017_only' }).tableCount, 0);
  assert.equal(validateWooCommerceRemotePreflightRow({
    ...base,
    commerce_table_count: 17,
    commerce_index_count: 13,
  }, { state: 'applied_or_no_pending' }).indexCount, 13);
  assert.throws(() => validateWooCommerceRemotePreflightRow({
    ...base,
    active_work: 1,
    commerce_table_count: 17,
    commerce_index_count: 13,
  }, { state: 'applied_or_no_pending' }), /zero active work/);
});

test('commerce readback requires a non-negative count for every table', () => {
  const row = Object.fromEntries(WOOCOMMERCE_D1_TABLES.map((table, index) => [table, index]));
  assert.equal(validateWooCommerceCommerceReadbackRow(row).totalRows, 136);
  assert.throws(() => validateWooCommerceCommerceReadbackRow({ ...row, raw_commerce_orders: -1 }));
});

test('provider evidence stores only minimized identity and dataset counts', () => {
  const snapshot = validateWooCommerceProviderSnapshot({
    store: { wcVersion: '9.0', wpVersion: '6.7', timezone: 'Asia/Bangkok', currency: 'THB' },
    orders: { records: [{}], totalRows: 10, totalPages: 1 },
    products: { records: [], totalRows: 0, totalPages: 0 },
    customers: { records: [{}], totalRows: 5, totalPages: 1 },
  });
  assert.equal(snapshot.providerRequestCount, 4);
  assert.deepEqual(Object.keys(snapshot.store).sort(), [
    'currency', 'timezone', 'wcVersionPresent', 'wpVersionPresent',
  ]);
});

test('Lark inventory requires all 14 unique tables and non-empty fields', () => {
  const tableIds = Object.fromEntries(WOOCOMMERCE_LARK_KEYS.map((key, index) => [key, `tbl${index}`]));
  const remoteTables = Object.values(tableIds).map((tableId) => ({ table_id: tableId }));
  const fieldCounts = Object.fromEntries(WOOCOMMERCE_LARK_KEYS.map((key) => [key, 5]));
  assert.equal(validateWooCommerceLarkInventory({ tableIds, remoteTables, fieldCounts }).tableCount, 14);
  assert.throws(() => validateWooCommerceLarkInventory({
    tableIds: { ...tableIds, mktCommerceDaily: tableIds.mktCommerceOrders },
    remoteTables,
    fieldCounts,
  }), /unique/);
});

test('summary separates migration apply from manual D1 and Lark backfill', () => {
  const common = { targetFingerprint: 'fingerprint', status: 'passed' };
  assert.equal(decideWooCommerceReadinessSummary({
    remote: { ...common, migrationState: { state: 'pending_0017_only' } },
    provider: common,
    lark: common,
  }).decision, 'READY_FOR_SEPARATE_BACKUP_AND_0017_APPLY_AUTHORIZATION');
  assert.equal(decideWooCommerceReadinessSummary({
    remote: { ...common, migrationState: { state: 'applied_or_no_pending' } },
    provider: common,
    lark: common,
  }).decision, 'READY_FOR_GUARDED_MANUAL_D1_LARK_BACKFILL_IMPLEMENTATION');
});
