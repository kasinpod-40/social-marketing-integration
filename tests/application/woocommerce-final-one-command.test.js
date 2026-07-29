import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildWooCommerceIsolatedMigrationConfig,
  classifyWooCommercePendingMigrations,
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
  validateWooCommercePreMigrationState,
} from '../../scripts/lib/woocommerce-final-one-command.js';

const ACCOUNT_A = 'a'.repeat(32);
const ACCOUNT_B = 'b'.repeat(32);

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

test('Cloudflare Account ID uses explicit env, config, or one exact Wrangler membership', () => {
  assert.equal(resolveCloudflareAccountId({
    explicitAccountId: ACCOUNT_A,
    configText: '{}',
    whoamiOutput: '{}',
  }), ACCOUNT_A);

  assert.equal(resolveCloudflareAccountId({
    explicitAccountId: '  ',
    configText: JSON.stringify({ account_id: ACCOUNT_A }),
    whoamiOutput: '{}',
  }), ACCOUNT_A);

  assert.equal(resolveCloudflareAccountId({
    configText: '{}',
    whoamiOutput: JSON.stringify({
      accounts: [{ id: ACCOUNT_A, name: 'Integration Workspace' }],
    }),
  }), ACCOUNT_A);
});

test('Cloudflare Account ID selection fails closed for ambiguity and supports exact preference', () => {
  const whoamiOutput = JSON.stringify({
    memberships: [
      { account: { id: ACCOUNT_A, name: 'Integration Workspace' } },
      { account: { id: ACCOUNT_B, name: 'Other Account' } },
    ],
  });
  assert.throws(
    () => resolveCloudflareAccountId({ configText: '{}', whoamiOutput }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_ACCOUNT_AMBIGUOUS',
  );
  assert.equal(resolveCloudflareAccountId({
    configText: '{}',
    whoamiOutput,
    preferredAccount: 'Integration Workspace',
  }), ACCOUNT_A);
});

test('Cloudflare bearer auth uses explicit token or Wrangler API/OAuth session', () => {
  assert.deepEqual(resolveCloudflareBearerAuth({ explicitApiToken: 'token-from-env' }), {
    type: 'api_token',
    source: 'environment',
    token: 'token-from-env',
  });
  assert.deepEqual(resolveCloudflareBearerAuth({
    explicitApiToken: '',
    authOutput: JSON.stringify({ type: 'oauth', token: 'oauth-session-token' }),
  }), {
    type: 'oauth',
    source: 'wrangler_auth_session',
    token: 'oauth-session-token',
  });
  assert.throws(
    () => resolveCloudflareBearerAuth({
      authOutput: JSON.stringify({ type: 'api_key', key: 'hidden', email: 'user@example.test' }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_AUTH_TYPE_UNSUPPORTED',
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

test('pre-Migration state permits only the one pinned active exact continuation', () => {
  const row = {
    active_work: 1,
    pinned_active_work: 1,
    other_active_work: 0,
    active_locks: 0,
    commerce_table_count: 17,
    commerce_index_count: 13,
  };
  const result = validateWooCommercePreMigrationState(
    row,
    { migration0017Pending: false },
    { resumeOperationId: 'woo-final-full-e2372e56d52d' },
  );
  assert.equal(result.pinnedActiveWork, 1);
  assert.throws(
    () => validateWooCommercePreMigrationState(
      { ...row, other_active_work: 1, active_work: 2 },
      { migration0017Pending: false },
      { resumeOperationId: 'woo-final-full-e2372e56d52d' },
    ),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED',
  );
  assert.throws(
    () => validateWooCommercePreMigrationState(
      row,
      { migration0017Pending: true },
      { resumeOperationId: 'woo-final-full-e2372e56d52d' },
    ),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED',
  );
});

test('one-command wrapper discovers Wrangler account and auth session instead of requiring env values', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-one-command.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /\['whoami', '--json'\]/u);
  assert.match(source, /\['auth', 'token', '--json'\]/u);
  assert.doesNotMatch(source, /requireText\(env\.CLOUDFLARE_ACCOUNT_ID/u);
  assert.doesNotMatch(source, /requireText\(env\.CLOUDFLARE_API_TOKEN/u);
});
