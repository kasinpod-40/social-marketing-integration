import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewedStateRuntime } from '../../scripts/lib/report-runtime-closeout-reviewed-state.js';

function runtimeWith(runText, env = {}) {
  return createReviewedStateRuntime({
    run: async () => {},
    runText,
    repositoryRoot: process.cwd(),
    outputRoot: 'outputs/test-report-state',
    configPath: 'wrangler.sync.jsonc',
    env: {
      MKT_REPORT_RUNTIME_CLOSEOUT_D1_READ_MAX_ATTEMPTS: '3',
      MKT_REPORT_RUNTIME_CLOSEOUT_D1_READ_RETRY_INTERVAL_MS: '1',
      ...env,
    },
    target: {
      platformScope: 'instagram',
      accountKey: 'chemistry_k',
    },
  });
}

test('reviewed D1 read retries bounded command failures and returns the successful row', async () => {
  let attempts = 0;
  const runtime = runtimeWith(async (command, args) => {
    attempts += 1;
    assert.equal(command, 'npx');
    assert.deepEqual(args.slice(0, 5), [
      'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote',
    ]);
    if (attempts < 3) {
      const error = new Error('transient D1 command failure');
      error.code = 1;
      error.stderr = 'temporary Cloudflare D1 failure';
      throw error;
    }
    return JSON.stringify([{ results: [{ value: 1 }] }]);
  });

  const row = await runtime.readD1Row('SELECT 1 AS value;');

  assert.equal(attempts, 3);
  assert.deepEqual(row, { value: 1 });
});

test('reviewed D1 read fails closed with bounded sanitized command diagnostics', async () => {
  let attempts = 0;
  const runtime = runtimeWith(async () => {
    attempts += 1;
    const error = new Error('Command failed with full SQL that must not be propagated');
    error.code = 1;
    error.signal = 'SIGTERM';
    error.stderr = '  D1 API unavailable\nretry later  ';
    error.stdout = '';
    throw error;
  }, {
    MKT_REPORT_RUNTIME_CLOSEOUT_D1_READ_MAX_ATTEMPTS: '2',
  });

  await assert.rejects(
    runtime.readD1Row('SELECT secret_query_text FROM hidden;'),
    (error) => {
      assert.equal(error.code, 'REPORT_RUNTIME_CLOSEOUT_D1_READ_FAILED');
      assert.equal(error.details.attemptCount, 2);
      assert.equal(error.details.sourceCode, '1');
      assert.equal(error.details.sourceSignal, 'SIGTERM');
      assert.equal(error.details.stderr, 'D1 API unavailable retry later');
      assert.equal(error.details.stdout, null);
      assert.doesNotMatch(error.message, /secret_query_text/u);
      return true;
    },
  );

  assert.equal(attempts, 2);
});

test('reviewed D1 read rejects an invalid successful JSON response without mutation retry', async () => {
  let attempts = 0;
  const runtime = runtimeWith(async () => {
    attempts += 1;
    return 'not-json';
  });

  await assert.rejects(
    runtime.readD1Row('SELECT 1;'),
    (error) => {
      assert.equal(error.code, 'REPORT_RUNTIME_CLOSEOUT_D1_RESPONSE_INVALID');
      assert.equal(error.details.responseBytes, 8);
      return true;
    },
  );

  assert.equal(attempts, 1);
});
