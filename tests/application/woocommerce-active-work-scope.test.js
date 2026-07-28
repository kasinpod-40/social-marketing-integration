import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  rewriteWooCommerceD1CommandArgs,
  scopeWooCommerceActiveWorkSql,
} from '../../scripts/lib/woocommerce-active-work-scope.js';

const recoverySql = `SELECT
  (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work_count,
  (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000) AS active_lock_count;`;

const remotePreflightSql = `SELECT
  (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status='active') AS active_work,
  (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000) AS active_locks;`;

test('scopes recovery and remote-preflight active work to WooCommerce only', () => {
  for (const sql of [recoverySql, remotePreflightSql]) {
    const result = scopeWooCommerceActiveWorkSql(sql);
    assert.equal(result.changed, true);
    assert.match(result.sql, /work_key LIKE 'woocommerce:%'/u);
    assert.match(result.sql, /owner_id LIKE 'woocommerce:%'/u);
    assert.doesNotMatch(
      result.sql,
      /FROM sync_work_runs WHERE lifecycle_status\s*=\s*'active'\s*\) AS active_work/u,
    );
  }
});

test('scope is idempotent and leaves unrelated D1 queries untouched', () => {
  const first = scopeWooCommerceActiveWorkSql(recoverySql);
  const second = scopeWooCommerceActiveWorkSql(first.sql);
  assert.equal(second.changed, false);
  assert.equal(second.sql, first.sql);

  const unrelated = 'SELECT COUNT(*) AS row_count FROM raw_commerce_orders;';
  assert.deepEqual(scopeWooCommerceActiveWorkSql(unrelated), {
    changed: false,
    sql: unrelated,
  });
});

test('rewrites only remote Wrangler D1 execute command arguments', () => {
  const rewritten = rewriteWooCommerceD1CommandArgs([
    'wrangler', 'd1', 'execute', 'social-mkt-state-dev', '--remote', '--json', '--command', remotePreflightSql,
  ]);
  assert.equal(rewritten.changed, true);
  assert.match(rewritten.args.at(-1), /work_key LIKE 'woocommerce:%'/u);

  const local = rewriteWooCommerceD1CommandArgs([
    'wrangler', 'd1', 'execute', 'social-mkt-state-dev', '--local', '--command', remotePreflightSql,
  ]);
  assert.equal(local.changed, false);
});

test('launcher delegates to source-safe rollout through temporary npx scope shim', async () => {
  const launcher = await readFile('scripts/woocommerce-final-one-command-active-scope.mjs', 'utf8');
  const shim = await readFile('scripts/woocommerce-active-work-scope-npx-shim.mjs', 'utf8');
  assert.match(launcher, /woocommerce-final-one-command-source-safe\.mjs/u);
  assert.match(launcher, /MKT_WOOCOMMERCE_REAL_NPX_PATH/u);
  assert.match(launcher, /PATH:/u);
  assert.match(shim, /rewriteWooCommerceD1CommandArgs/u);
  assert.match(shim, /businessMutationCount: 0/u);
});
