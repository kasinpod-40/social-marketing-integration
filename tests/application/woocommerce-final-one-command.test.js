import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWooCommerceIsolatedMigrationConfig,
  classifyWooCommercePendingMigrations,
  resolveWooCommerceQueueId,
  validateWooCommercePreMigrationState,
} from '../../scripts/lib/woocommerce-final-one-command.js';

test('pending Migration classifier allows only WooCommerce 0017 and Chatwoot 0018', () => {
  assert.deepEqual(
    classifyWooCommercePendingMigrations(
      '0018_chatwoot_analytics.sql\n0017_woocommerce_commerce.sql',
    ),
    {
      pending: ['0017_woocommerce_commerce.sql', '0018_chatwoot_analytics.sql'],
      migration0017Pending: true,
      migration0018Pending: true,
    },
  );
  assert.throws(
    () => classifyWooCommercePendingMigrations('0019_unreviewed.sql'),
    /Unexpected pending migrations/u,
  );
});

test('Queue ID resolver requires one exact named Queue', () => {
  assert.equal(
    resolveWooCommerceQueueId([
      { queue_name: 'social-mkt-sync-jobs', queue_id: 'queue-main-id' },
      { queue_name: 'social-mkt-sync-dlq', queue_id: 'queue-dlq-id' },
    ], 'social-mkt-sync-jobs'),
    'queue-main-id',
  );
  assert.throws(
    () => resolveWooCommerceQueueId([], 'social-mkt-sync-jobs'),
    /Unable to resolve exact/u,
  );
});

test('isolated Migration config changes only MKT_STATE_DB migrations directory', () => {
  const source = JSON.stringify({
    name: 'social-mkt-sync-worker',
    d1_databases: [
      { binding: 'OTHER_DB', database_name: 'other', migrations_dir: './other' },
      {
        binding: 'MKT_STATE_DB',
        database_name: 'social-mkt-state-dev',
        migrations_dir: './migrations',
      },
    ],
  });
  const output = JSON.parse(buildWooCommerceIsolatedMigrationConfig({
    configText: source,
    migrationsDir: 'outputs/woocommerce-final-rollout/isolated-migration-0017',
  }));
  assert.equal(output.d1_databases[0].migrations_dir, './other');
  assert.equal(
    output.d1_databases[1].migrations_dir,
    'outputs/woocommerce-final-rollout/isolated-migration-0017',
  );
});

test('pre-Migration state accepts empty or exact schema only while 0017 is pending', () => {
  const base = { active_work: 0, active_locks: 0 };
  assert.equal(validateWooCommercePreMigrationState({
    ...base,
    commerce_table_count: 0,
    commerce_index_count: 0,
  }, { migration0017Pending: true }).tableCount, 0);
  assert.equal(validateWooCommercePreMigrationState({
    ...base,
    commerce_table_count: 17,
    commerce_index_count: 13,
  }, { migration0017Pending: true }).tableCount, 17);
  assert.throws(() => validateWooCommercePreMigrationState({
    ...base,
    commerce_table_count: 5,
    commerce_index_count: 2,
  }, { migration0017Pending: true }), /inconsistent/u);
  assert.throws(() => validateWooCommercePreMigrationState({
    ...base,
    active_work: 1,
    commerce_table_count: 17,
    commerce_index_count: 13,
  }, { migration0017Pending: false }), /Active work/u);
});
