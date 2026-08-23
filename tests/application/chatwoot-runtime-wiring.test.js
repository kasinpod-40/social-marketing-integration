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
  CHATWOOT_LARK_TABLE_KEYS,
  readChatwootRuntimeConfig,
} from '../../packages/config/src/chatwoot-runtime-config.js';
import {
  createChatwootActiveJobRouter,
  selectChatwootActiveRoute,
} from '../../apps/sync-worker/src/chatwoot-active-job-router.js';
import { processChatwootAnalyticsJob } from '../../apps/sync-worker/src/chatwoot-job-router.js';

const REQUESTED_AT = Date.parse('2026-07-27T00:00:00Z');
const OPERATION_ID = 'chatwoot-integration-1';

function protectedEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_CHATWOOT_ENABLED: 'true',
    MKT_CHATWOOT_D1_WRITE_ENABLED: 'true',
    MKT_CHATWOOT_LARK_WRITE_ENABLED: 'false',
    MKT_CHATWOOT_REPORT_WRITE_ENABLED: 'false',
    MKT_SCHEDULE_CHATWOOT_ENABLED: 'false',
    MKT_CHATWOOT_WEBHOOK_ENABLED: 'false',
    CHATWOOT_BASE_URL: 'https://chatwoot.example.test',
    CHATWOOT_ACCOUNT_ID: '123',
    CHATWOOT_API_ACCESS_TOKEN: 'test-secret',
  };
}

test('Chatwoot defaults are safe-closed without reading Provider credentials', () => {
  const config = readChatwootRuntimeConfig({});
  assert.deepEqual(config.flags, {
    connector: false,
    d1Write: false,
    larkWrite: false,
    reportWrite: false,
    schedule: false,
    webhook: false,
  });
  assert.equal(config.source, null);
  assert.equal(config.reportingTimezone, 'Asia/Bangkok');
});

test('Chatwoot catalog and Queue job are active after retained Source and Report UAT', () => {
  const connector = getConnectorCatalogEntry('chatwoot');
  const job = getJobDefinition(JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC);
  assert.equal(connector.implementationStatus, 'active');
  assert.equal(job.implementationStatus, 'active');
  assert.notEqual(job.manualOnly, true);
});

test('active Chatwoot runtime allows manual and scheduled configuration without protected-UAT alias', () => {
  const env = protectedEnv();
  const runtime = loadCustomerRuntimeConfig(env);
  const config = readChatwootRuntimeConfig(env);
  assert.equal(runtime.connectors.chatwoot.enabled, true);
  assert.equal(runtime.connectors.chatwoot.protectedUatRuntime, false);
  assert.equal(config.flags.larkWrite, false);
  assert.equal(config.source.baseUrl, 'https://chatwoot.example.test');

  assert.equal(loadCustomerRuntimeConfig({
    ...env,
    MKT_SCHEDULE_CHATWOOT_ENABLED: 'true',
  }).connectors.chatwoot.enabled, true);
});

test('Chatwoot Queue identity is account-scoped and continuation preserves it', () => {
  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    trigger: 'manual_uat',
    accountKey: 'chemistry_k',
    operationId: OPERATION_ID,
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
  };
  const operation = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'delivery-1', body }),
    message: { id: 'delivery-1' },
  });
  assert.equal(operation.stable, true);
  assert.equal(operation.workKey, `chatwoot:chemistry_k:${OPERATION_ID}`);
  const continuation = withQueueOperation({
    type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    trigger: 'manual_uat',
    accountKey: 'chemistry_k',
    continuation: true,
  }, operation);
  assert.equal(continuation.workKey, operation.workKey);
  assert.equal(continuation.originalRequestedAt, REQUESTED_AT);
});

test('all Chatwoot Lark logical keys are centrally registered and unique', () => {
  assert.equal(CHATWOOT_LARK_TABLE_KEYS.length, 5);
  const env = {};
  CHATWOOT_LARK_TABLE_KEYS.forEach((key, index) => {
    assert.equal(typeof LARK_TABLE_ENV[key], 'string');
    env[LARK_TABLE_ENV[key]] = `tbl_chatwoot_${index}`;
  });
  const tableIds = readLarkTableIdsFromEnv(env, CHATWOOT_LARK_TABLE_KEYS);
  assert.deepEqual(Object.keys(tableIds), CHATWOOT_LARK_TABLE_KEYS);
});

test('Chatwoot active router preserves the complete existing fallback chain', async () => {
  assert.equal(selectChatwootActiveRoute({
    job: { body: { type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC } },
  }), 'chatwoot');
  assert.equal(selectChatwootActiveRoute({
    job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC } },
  }), 'fallback');

  const calls = [];
  const router = createChatwootActiveJobRouter({
    processChatwoot: async () => { calls.push('chatwoot'); return 'chatwoot'; },
    processFallback: async () => { calls.push('fallback'); return 'fallback'; },
  });
  assert.equal(await router({ job: { body: { type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC } } }), 'chatwoot');
  assert.equal(await router({ job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC } } }), 'fallback');
  assert.deepEqual(calls, ['chatwoot', 'fallback']);
});

test('disabled Chatwoot job fails before Infrastructure or Provider construction', async () => {
  let infrastructureRead = false;
  await assert.rejects(
    processChatwootAnalyticsJob({
      job: {
        body: {
          type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
          trigger: 'manual_uat',
          accountKey: 'chemistry_k',
        },
      },
      operation: {
        stable: true,
        operationId: OPERATION_ID,
        workKey: `chatwoot:chemistry_k:${OPERATION_ID}`,
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

test('Migration 0018 is additive and contains all 14 approved tables', async () => {
  const sql = await readFile(new URL('../../migrations/0018_chatwoot_analytics.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/gu) ?? []).length, 14);
  assert.equal(sql.includes('DROP TABLE'), false);
  assert.equal(sql.includes('DELETE FROM'), false);
  assert.equal(sql.includes('ALTER TABLE'), false);
  for (const forbidden of ['message_content', 'email ', 'phone_number', 'access_token', 'raw_payload']) {
    assert.equal(sql.toLowerCase().includes(forbidden), false);
  }
});

test('release examples retain every Chatwoot execution and Schedule/Webhook gate as false', async () => {
  const [vars, wrangler] = await Promise.all([
    readFile(new URL('../../.dev.vars.example', import.meta.url), 'utf8'),
    readFile(new URL('../../wrangler.sync.example.jsonc', import.meta.url), 'utf8'),
  ]);
  for (const flag of [
    'MKT_CONNECTOR_CHATWOOT_ENABLED',
    'MKT_CHATWOOT_D1_WRITE_ENABLED',
    'MKT_CHATWOOT_LARK_WRITE_ENABLED',
    'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
    'MKT_SCHEDULE_CHATWOOT_ENABLED',
    'MKT_CHATWOOT_WEBHOOK_ENABLED',
  ]) {
    assert.match(vars, new RegExp(`^${flag}=false$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${flag}": "false"`, 'u'));
  }
});

test('Chatwoot resumable completion preserves deterministic syncRunId', async () => {
  const source = await readFile(
    new URL('../../apps/sync-worker/src/chatwoot-job-router.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /const result = Object\.freeze\(\{\s*\.\.\.syncResult,\s*syncRunId: deterministicSyncRunId,/u,
  );
  assert.match(source, /syncRunId: result\.syncRunId/u);
  assert.match(source, /return result;/u);
});
