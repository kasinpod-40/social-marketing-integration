import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JOB_TYPES, getJobDefinition } from '../../packages/application/src/jobs/job-catalog.js';
import { resolveQueueOperation, withQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';
import { getConnectorCatalogEntry } from '../../packages/config/src/connector-catalog.js';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { LARK_TABLE_ENV, readLarkTableIdsFromEnv } from '../../packages/config/src/lark-table-config.js';
import {
  WOOCOMMERCE_LARK_TABLE_KEYS,
  readWooCommerceRuntimeConfig,
} from '../../packages/config/src/woocommerce-runtime-config.js';
import {
  createWooCommerceActiveJobRouter,
  selectWooCommerceActiveRoute,
} from '../../apps/sync-worker/src/woocommerce-active-job-router.js';
import { processWooCommerceCommerceJob } from '../../apps/sync-worker/src/woocommerce-job-router.js';

const REQUESTED_AT = Date.parse('2026-07-27T00:00:00Z');
const OPERATION_ID = 'woo-integration-1';

function protectedEnv(overrides = {}) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'true',
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: 'true',
    MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'false',
    MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED: 'false',
    MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'false',
    WOOCOMMERCE_BASE_URL: 'https://shop.example.test',
    WOOCOMMERCE_CONSUMER_KEY: 'ck_testkey',
    WOOCOMMERCE_CONSUMER_SECRET: 'cs_testsecret',
    ...overrides,
  };
}

test('WooCommerce defaults are safe-closed without reading credentials', () => {
  const config = readWooCommerceRuntimeConfig({});
  assert.deepEqual(config.flags, {
    connector: false,
    d1Write: false,
    larkWrite: false,
    reportRead: false,
    fullReconciliation: false,
    schedule: false,
  });
  assert.equal(config.source, null);
  assert.equal(config.reportingTimezone, 'Asia/Bangkok');
});

test('WooCommerce catalog and Queue job are active with exact trigger allowlist', () => {
  const connector = getConnectorCatalogEntry('woocommerce');
  const job = getJobDefinition(JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC);
  assert.equal(connector.implementationStatus, 'active');
  assert.equal(job.implementationStatus, 'active');
  assert.deepEqual(job.allowedTriggers, ['manual_uat', 'scheduled']);
});

test('Integration Workspace supports explicit Manual UAT and Scheduled gate windows', () => {
  const manualEnv = protectedEnv();
  const manualRuntime = loadCustomerRuntimeConfig(manualEnv);
  const manualConfig = readWooCommerceRuntimeConfig(manualEnv);
  assert.equal(manualRuntime.connectors.woocommerce.enabled, true);
  assert.equal(manualRuntime.connectors.woocommerce.implementationStatus, 'active');
  assert.equal(manualConfig.source.baseUrl, 'https://shop.example.test');
  assert.equal(manualConfig.flags.schedule, false);

  const scheduledEnv = protectedEnv({ MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'true' });
  const scheduledRuntime = loadCustomerRuntimeConfig(scheduledEnv);
  const scheduledConfig = readWooCommerceRuntimeConfig(scheduledEnv);
  assert.equal(scheduledRuntime.connectors.woocommerce.enabled, true);
  assert.equal(scheduledConfig.flags.schedule, true);
});

test('WooCommerce Queue operation has stable identity and continuation preserves it', () => {
  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
    trigger: 'manual_uat',
    operationId: OPERATION_ID,
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
  };
  const operation = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'delivery-1', body }),
    message: { id: 'delivery-1' },
  });
  assert.equal(operation.stable, true);
  assert.equal(operation.workKey, `woocommerce:${OPERATION_ID}`);
  const continuation = withQueueOperation({
    type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
    trigger: 'manual_uat',
    continuation: true,
  }, operation);
  assert.equal(continuation.workKey, operation.workKey);
  assert.equal(continuation.originalRequestedAt, REQUESTED_AT);
});

test('all customer-facing WooCommerce Lark logical keys are centrally registered and unique', () => {
  assert.equal(WOOCOMMERCE_LARK_TABLE_KEYS.length, 5);
  const env = {};
  WOOCOMMERCE_LARK_TABLE_KEYS.forEach((key, index) => {
    assert.equal(typeof LARK_TABLE_ENV[key], 'string');
    env[LARK_TABLE_ENV[key]] = `tbl_woo_${index}`;
  });
  const tableIds = readLarkTableIdsFromEnv(env, WOOCOMMERCE_LARK_TABLE_KEYS);
  assert.deepEqual(Object.keys(tableIds), WOOCOMMERCE_LARK_TABLE_KEYS);
});

test('WooCommerce active router preserves the prior route for every non-WooCommerce job', async () => {
  assert.equal(selectWooCommerceActiveRoute({
    job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC } },
  }), 'woocommerce');
  assert.equal(selectWooCommerceActiveRoute({
    job: { body: { type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC } },
  }), 'fallback');

  const calls = [];
  const router = createWooCommerceActiveJobRouter({
    processWooCommerce: async () => { calls.push('woocommerce'); return 'woo'; },
    processFallback: async () => { calls.push('fallback'); return 'fallback'; },
  });
  assert.equal(await router({
    job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC, trigger: 'manual_uat' } },
  }), 'woo');
  assert.equal(await router({ job: { body: { type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC } } }), 'fallback');
  assert.deepEqual(calls, ['woocommerce', 'fallback']);
});

test('disabled WooCommerce job fails before Infrastructure, Provider, D1 or Lark construction', async () => {
  let infrastructureRead = false;
  await assert.rejects(
    processWooCommerceCommerceJob({
      job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC, trigger: 'manual_uat' } },
      operation: {
        stable: true,
        operationId: OPERATION_ID,
        workKey: `woocommerce:${OPERATION_ID}`,
        generation: REQUESTED_AT,
        originalRequestedAt: REQUESTED_AT,
      },
      env: {},
      getRuntimeConfig: () => loadCustomerRuntimeConfig({
        MKT_ENV: 'development',
        MKT_CUSTOMER_PROFILE: 'integration_workspace',
      }),
      getInfrastructure: () => { infrastructureRead = true; return {}; },
    }),
    (error) => error?.code === 'MKT_CONNECTOR_DISABLED',
  );
  assert.equal(infrastructureRead, false);
});

test('Migration 0017 is additive, replay-safe and contains all 17 reviewed tables', async () => {
  const sql = await readFile(new URL('../../migrations/0017_woocommerce_commerce.sql', import.meta.url), 'utf8');
  const tableCount = (sql.match(/CREATE TABLE IF NOT EXISTS/gu) ?? []).length;
  assert.equal(tableCount, 17);
  assert.equal(sql.includes('DROP TABLE'), false);
  assert.equal(sql.includes('DELETE FROM'), false);
  assert.equal(sql.includes('ALTER TABLE'), false);
});

test('release examples retain every WooCommerce execution and Schedule gate as false', async () => {
  const [vars, wrangler] = await Promise.all([
    readFile(new URL('../../.dev.vars.example', import.meta.url), 'utf8'),
    readFile(new URL('../../wrangler.sync.example.jsonc', import.meta.url), 'utf8'),
  ]);
  for (const flag of [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  ]) {
    assert.match(vars, new RegExp(`^${flag}=false$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${flag}": "false"`, 'u'));
  }
});
