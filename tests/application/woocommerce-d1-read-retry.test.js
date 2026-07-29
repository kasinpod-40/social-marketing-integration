import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyWooCommerceD1ReadCommand,
  wooCommerceD1ReadMaxAttempts,
  wooCommerceD1ReadRetryDelay,
} from '../../scripts/lib/woocommerce-d1-read-retry.js';

function remoteD1(sql) {
  return [
    'wrangler',
    'd1',
    'execute',
    'social-mkt-state-dev',
    '--remote',
    '--json',
    '--command',
    sql,
  ];
}

test('classifies only Remote D1 read-only commands for bounded retry', () => {
  assert.equal(classifyWooCommerceD1ReadCommand(remoteD1('SELECT 1;')).eligible, true);
  assert.equal(classifyWooCommerceD1ReadCommand(remoteD1('WITH rows AS (SELECT 1) SELECT * FROM rows;')).eligible, true);
  assert.equal(classifyWooCommerceD1ReadCommand(remoteD1("UPDATE sync_runs SET status='failed';")).eligible, false);
  assert.equal(classifyWooCommerceD1ReadCommand([
    'wrangler', 'd1', 'execute', 'social-mkt-state-dev', '--local', '--command', 'SELECT 1;',
  ]).eligible, false);
  assert.equal(classifyWooCommerceD1ReadCommand(['wrangler', 'deploy']).eligible, false);
});

test('retry plan is bounded and deterministic', () => {
  assert.equal(wooCommerceD1ReadMaxAttempts(), 5);
  assert.equal(wooCommerceD1ReadRetryDelay(1), 1_000);
  assert.equal(wooCommerceD1ReadRetryDelay(2), 2_000);
  assert.equal(wooCommerceD1ReadRetryDelay(3), 5_000);
  assert.equal(wooCommerceD1ReadRetryDelay(4), 10_000);
  assert.equal(wooCommerceD1ReadRetryDelay(5), null);
});

test('resilient launcher composes active-scope launcher through a temporary npx shim', async () => {
  const launcher = await readFile('scripts/woocommerce-final-one-command-d1-resilient.mjs', 'utf8');
  const shim = await readFile('scripts/woocommerce-d1-read-retry-npx-shim.mjs', 'utf8');
  assert.match(launcher, /woocommerce-final-one-command-active-scope\.mjs/u);
  assert.match(launcher, /MKT_WOOCOMMERCE_D1_RETRY_REAL_NPX_PATH/u);
  assert.match(shim, /woocommerce-d1-read-retry/u);
  assert.match(shim, /businessMutationCount: 0/u);
  assert.doesNotMatch(shim, /Authorization|CONSUMER_SECRET|CONSUMER_KEY/u);
});
