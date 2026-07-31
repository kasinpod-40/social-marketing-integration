import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bootstrapWooCommerceFinalQueueId } from '../../scripts/lib/woocommerce-final-queue-bootstrap.js';

const QUEUE_NAME = 'social-mkt-sync-jobs';
const QUEUE_ID = 'queue-id-reviewed';

function queueResponse(expectedToken, expectedAccountId) {
  return async (url, options = {}) => {
    assert.equal(
      url,
      `https://api.cloudflare.com/client/v4/accounts/${expectedAccountId}/queues`,
    );
    assert.equal(options.headers?.Authorization, `Bearer ${expectedToken}`);
    return {
      ok: true,
      status: 200,
      redirected: false,
      async text() {
        return JSON.stringify({
          success: true,
          errors: [],
          result: [{ queue_name: QUEUE_NAME, queue_id: QUEUE_ID }],
          result_info: { total_pages: 1 },
        });
      },
    };
  };
}

async function withConfig(config, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-queue-bootstrap-'));
  const configPath = join(directory, 'wrangler.jsonc');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  try {
    return await callback({ directory, configPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('explicit account and API token bypass Wrangler authentication commands', async () => {
  await withConfig({}, async ({ directory, configPath }) => {
    const accountId = 'a'.repeat(32);
    const apiToken = 'explicit-api-token';
    const calls = [];
    const env = {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: apiToken,
      MKT_MAIN_QUEUE_NAME: QUEUE_NAME,
      MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: configPath,
    };

    const result = await bootstrapWooCommerceFinalQueueId({
      env,
      repositoryRoot: directory,
      runWrangler(args) {
        calls.push(args);
        throw new Error('Wrangler must not run for explicit account and token');
      },
      fetchImpl: queueResponse(apiToken, accountId),
    });

    assert.deepEqual(calls, []);
    assert.equal(result.queueId, QUEUE_ID);
    assert.equal(result.accountSource, 'explicit_environment');
    assert.equal(result.authSource, 'environment');
    assert.equal(result.providerRequests, 1);
  });
});

test('configured account uses Wrangler auth token without calling whoami', async () => {
  const accountId = 'b'.repeat(32);
  await withConfig({ account_id: accountId }, async ({ directory, configPath }) => {
    const oauthToken = 'oauth-token-from-session';
    const calls = [];
    const result = await bootstrapWooCommerceFinalQueueId({
      env: {
        MKT_MAIN_QUEUE_NAME: QUEUE_NAME,
        MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: configPath,
      },
      repositoryRoot: directory,
      runWrangler(args) {
        calls.push(args);
        assert.deepEqual(args, ['auth', 'token', '--json']);
        return JSON.stringify({ type: 'oauth', token: oauthToken });
      },
      fetchImpl: queueResponse(oauthToken, accountId),
    });

    assert.deepEqual(calls, [['auth', 'token', '--json']]);
    assert.equal(result.accountSource, 'wrangler_config');
    assert.equal(result.authType, 'oauth');
    assert.equal(result.authSource, 'wrangler_auth_session');
  });
});

test('whoami is retained only when no account ID is configured', async () => {
  await withConfig({}, async ({ directory, configPath }) => {
    const accountId = 'c'.repeat(32);
    const oauthToken = 'oauth-token-for-account-discovery';
    const calls = [];
    const result = await bootstrapWooCommerceFinalQueueId({
      env: {
        MKT_MAIN_QUEUE_NAME: QUEUE_NAME,
        MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: configPath,
      },
      repositoryRoot: directory,
      runWrangler(args, commandEnv) {
        calls.push(args);
        if (args[0] === 'auth') {
          return JSON.stringify({ type: 'oauth', token: oauthToken });
        }
        assert.deepEqual(args, ['whoami', '--json']);
        assert.equal(commandEnv.CLOUDFLARE_API_TOKEN, oauthToken);
        return JSON.stringify({ accounts: [{ id: accountId, name: 'Primary' }] });
      },
      fetchImpl: queueResponse(oauthToken, accountId),
    });

    assert.deepEqual(calls, [
      ['auth', 'token', '--json'],
      ['whoami', '--json'],
    ]);
    assert.equal(result.accountSource, 'wrangler_whoami');
  });
});
