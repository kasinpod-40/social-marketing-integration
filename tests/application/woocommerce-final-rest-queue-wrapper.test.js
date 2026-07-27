import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = 'scripts/woocommerce-final-one-command-rest-queue.mjs';

test('WooCommerce REST Queue wrapper is plan-only by default', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.executed, false);
  assert.equal(output.queueDiscovery, 'Cloudflare GET /accounts/{account_id}/queues');
  assert.equal(output.delegatesTo, 'scripts/woocommerce-final-one-command.mjs');
  assert.equal(output.remoteMutationCount, 0);
});
