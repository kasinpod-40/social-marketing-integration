import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { discoverWooCommerceQueueId } from '../../scripts/lib/woocommerce-final-queue-discovery.js';
import { bootstrapWooCommerceFinalQueueId } from '../../scripts/lib/woocommerce-final-queue-bootstrap.js';

const ACCOUNT_ID = 'a'.repeat(32);
const TOKEN = 'queue-read-token';
const QUEUE_ID = 'queue-main-id';
const QUEUE_NAME = 'social-mkt-sync-jobs';

function response(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    redirected: options.redirected ?? false,
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },
  };
}

function queuePayload(overrides = {}) {
  return {
    success: true,
    errors: [],
    messages: [],
    result: [
      { queue_id: QUEUE_ID, queue_name: QUEUE_NAME },
      { queue_id: 'queue-dlq-id', queue_name: 'social-mkt-sync-dlq' },
    ],
    result_info: {
      page: 1,
      total_pages: 1,
      total_count: 2,
    },
    ...overrides,
  };
}

test('Queue discovery uses one exact Cloudflare GET and resolves one exact Queue ID', async () => {
  const requests = [];
  const queueId = await discoverWooCommerceQueueId({
    accountId: ACCOUNT_ID,
    apiToken: TOKEN,
    queueName: QUEUE_NAME,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response(queuePayload());
    },
  });

  assert.equal(queueId, QUEUE_ID);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/queues`,
  );
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Accept, 'application/json');
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${TOKEN}`);
});

test('Queue discovery fails closed for HTTP, contract, pagination and duplicate identity errors', async () => {
  await assert.rejects(
    discoverWooCommerceQueueId({
      accountId: ACCOUNT_ID,
      apiToken: TOKEN,
      queueName: QUEUE_NAME,
      fetchImpl: async () => response('denied', { ok: false, status: 403 }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_API_HTTP_FAILED'
      && error.details?.status === 403
      && !JSON.stringify(error).includes(TOKEN),
  );

  await assert.rejects(
    discoverWooCommerceQueueId({
      accountId: ACCOUNT_ID,
      apiToken: TOKEN,
      queueName: QUEUE_NAME,
      fetchImpl: async () => response(queuePayload({ success: false })),
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_API_CONTRACT_INVALID',
  );

  await assert.rejects(
    discoverWooCommerceQueueId({
      accountId: ACCOUNT_ID,
      apiToken: TOKEN,
      queueName: QUEUE_NAME,
      fetchImpl: async () => response(queuePayload({
        result_info: { page: 1, total_pages: 2, total_count: 101 },
      })),
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_API_PAGINATION_UNSUPPORTED',
  );

  await assert.rejects(
    discoverWooCommerceQueueId({
      accountId: ACCOUNT_ID,
      apiToken: TOKEN,
      queueName: QUEUE_NAME,
      fetchImpl: async () => response(queuePayload({
        result: [
          { queue_id: QUEUE_ID, queue_name: QUEUE_NAME },
          { queue_id: 'duplicate-id', queue_name: QUEUE_NAME },
        ],
      })),
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_ID_UNRESOLVED',
  );
});

test('Queue bootstrap injects exact ID without calling removed Wrangler Queue JSON output', async () => {
  const commands = [];
  const requests = [];
  const env = {
    MKT_MAIN_QUEUE_NAME: QUEUE_NAME,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: TOKEN,
  };
  const result = await bootstrapWooCommerceFinalQueueId({
    env,
    repositoryRoot: process.cwd(),
    runWrangler(args) {
      commands.push(args);
      return JSON.stringify({
        accounts: [{ id: ACCOUNT_ID, name: 'Integration Workspace' }],
      });
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response(queuePayload());
    },
  });

  assert.equal(result.source, 'cloudflare_queue_rest');
  assert.equal(result.providerRequests, 1);
  assert.equal(env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID, QUEUE_ID);
  assert.deepEqual(commands, [
    ['whoami', '--json'],
    ['whoami', '--account', ACCOUNT_ID, '--json'],
  ]);
  assert.equal(
    commands.some((args) => args.join(' ') === 'queues list --json'),
    false,
  );
  assert.equal(requests.length, 1);
});

test('explicit Queue ID bootstrap performs zero Provider or Wrangler requests', async () => {
  let commandCount = 0;
  let requestCount = 0;
  const result = await bootstrapWooCommerceFinalQueueId({
    env: {
      MKT_WOOCOMMERCE_FINAL_QUEUE_ID: QUEUE_ID,
    },
    runWrangler() {
      commandCount += 1;
      throw new Error('must not run');
    },
    fetchImpl: async () => {
      requestCount += 1;
      throw new Error('must not run');
    },
  });

  assert.equal(result.source, 'explicit_environment');
  assert.equal(result.providerRequests, 0);
  assert.equal(commandCount, 0);
  assert.equal(requestCount, 0);
});

test('canonical launcher bootstraps Queue ID before importing Safe Launcher', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-2026-completion-canonical-launcher.mjs', import.meta.url),
    'utf8',
  );
  const canonicalizeIndex = source.indexOf('canonicalizeTemporaryDirectoryEnvironment(process.env)');
  const bootstrapIndex = source.indexOf('bootstrapWooCommerceFinalQueueId');
  const injectIndex = source.indexOf('process.env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID');
  const safeLauncherIndex = source.indexOf("await import('./woocommerce-2026-completion-safe-launcher.mjs')");

  assert.ok(canonicalizeIndex >= 0);
  assert.ok(bootstrapIndex > canonicalizeIndex);
  assert.ok(injectIndex > bootstrapIndex);
  assert.ok(safeLauncherIndex > injectIndex);
  assert.doesNotMatch(source, /queues\s+list\s+--json/u);
});
