import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      if (options.bodyError) throw options.bodyError;
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

test('Queue discovery bounds and sanitizes response body read failures', async () => {
  await assert.rejects(
    discoverWooCommerceQueueId({
      accountId: ACCOUNT_ID,
      apiToken: TOKEN,
      queueName: QUEUE_NAME,
      fetchImpl: async () => response('', {
        status: 200,
        bodyError: Object.assign(new Error(`body failed with ${TOKEN}`), {
          name: 'BodyReadError',
        }),
      }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_API_BODY_READ_FAILED'
      && error.details?.status === 200
      && error.details?.errorName === 'BodyReadError'
      && !JSON.stringify(error).includes(TOKEN),
  );
});

test('Queue bootstrap injects exact ID without unnecessary Wrangler authentication commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'woo-queue-bootstrap-'));
  try {
    const configPath = join(root, 'wrangler.sync.jsonc');
    await writeFile(configPath, JSON.stringify({ account_id: ACCOUNT_ID }), 'utf8');
    const commands = [];
    const requests = [];
    const env = {
      MKT_MAIN_QUEUE_NAME: QUEUE_NAME,
      MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: configPath,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: TOKEN,
    };
    const result = await bootstrapWooCommerceFinalQueueId({
      env,
      repositoryRoot: root,
      runWrangler(args) {
        commands.push(args);
        throw new Error('Wrangler authentication must not run for exact account and token');
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return response(queuePayload());
      },
    });

    assert.equal(result.source, 'cloudflare_queue_rest');
    assert.equal(result.providerRequests, 1);
    assert.equal(result.accountSource, 'explicit_environment');
    assert.equal(result.authSource, 'environment');
    assert.equal(env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID, QUEUE_ID);
    assert.deepEqual(commands, []);
    assert.equal(requests.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test('canonical launcher installs locked dependencies and bootstraps Queue before Safe Launcher', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-2026-completion-canonical-launcher.mjs', import.meta.url),
    'utf8',
  );
  const canonicalizeIndex = source.indexOf('canonicalizeTemporaryDirectoryEnvironment(process.env)');
  const installIndex = source.indexOf('installLockedDependencies();');
  const bootstrapIndex = source.indexOf('await bootstrapWooCommerceFinalQueueId({');
  const injectIndex = source.indexOf('process.env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID');
  const safeLauncherIndex = source.indexOf("await import('./woocommerce-2026-completion-safe-launcher.mjs')");

  assert.ok(canonicalizeIndex >= 0);
  assert.ok(installIndex > canonicalizeIndex);
  assert.ok(bootstrapIndex > installIndex);
  assert.ok(injectIndex > bootstrapIndex);
  assert.ok(safeLauncherIndex > injectIndex);
  assert.match(source, /spawnSync\(\s*'npm',\s*\[\s*'ci'\s*\]/u);
  assert.doesNotMatch(source, /queues\s+list\s+--json/u);
});

test('default Queue bootstrap uses only lockfile-installed Wrangler binary', async () => {
  const source = await readFile(
    new URL('../../scripts/lib/woocommerce-final-queue-bootstrap.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /'node_modules',\s*'\.bin'/u);
  assert.match(source, /process\.platform === 'win32' \? 'wrangler\.cmd' : 'wrangler'/u);
  assert.doesNotMatch(source, /spawnSync\(\s*'npx'/u);
  assert.doesNotMatch(source, /\['wrangler',\s*\.\.\.args\]/u);
  assert.doesNotMatch(source, /queues\s+list\s+--json/u);
});
