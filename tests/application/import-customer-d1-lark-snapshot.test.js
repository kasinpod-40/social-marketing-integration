import test from 'node:test';
import assert from 'node:assert/strict';
import { processJob } from '../../apps/sync-worker/src/index.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  CUSTOMER_D1_LARK_IMPORT_MODE,
  importCustomerD1LarkSnapshot,
  listCustomerD1LarkImportContracts,
} from '../../packages/application/src/use-cases/import-customer-d1-lark-snapshot.js';

const TABLE_KEY = 'mktConversations';

function body(overrides = {}) {
  const scope = listCustomerD1LarkImportContracts()[TABLE_KEY];
  return {
    snapshotId: scope.snapshotId,
    tableKey: TABLE_KEY,
    batchIndex: 0,
    batchCount: scope.batchCount,
    totalRows: scope.totalRows,
    ...overrides,
  };
}

function sourceRows() {
  return Array.from({ length: 50 }, (_, index) => ({
    conversation_key: `chatwoot:chemistry_k:conversation:${1000 + index}`,
    customer_key: 'chemistry_k',
    account_key: 'chemistry_k',
    external_conversation_id: 1000 + index,
    external_inbox_id: 4,
    status: 'open',
    priority: null,
    external_assignee_id: null,
    external_team_id: null,
    source_created_at: 1,
    source_updated_at: 2,
    last_activity_at: 2,
    message_count: 1,
    incoming_message_count: 1,
    outgoing_message_count: 0,
    reopen_count_delta: 0,
    first_response_seconds: null,
    resolution_seconds: null,
    reply_seconds: null,
    last_sync_run_id: 'sync-1',
    created_at: 2,
    updated_at: 2,
  }));
}

function dbFixture(manifestOverrides = {}) {
  const scope = listCustomerD1LarkImportContracts()[TABLE_KEY];
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async first() {
              assert.match(sql, /COUNT\(\*\)/u);
              assert.deepEqual(bindings, ['chemistry_k']);
              return {
                total_rows: scope.totalRows,
                min_key: scope.minKey,
                max_key: scope.maxKey,
                max_updated: scope.maxUpdated,
                ...manifestOverrides,
              };
            },
            async all() {
              assert.match(sql, /ORDER BY conversation_key/u);
              assert.deepEqual(bindings, ['chemistry_k', 50, 0]);
              return { results: sourceRows() };
            },
          };
        },
      };
    },
  };
}

function syncEngine(result) {
  const calls = [];
  return {
    calls,
    async planByKey(input) {
      calls.push(input);
      return { duplicateInputRows: 0 };
    },
    async executePlan() {
      return result;
    },
  };
}

test('Customer D1 snapshot reads only the reviewed batch and projects Chatwoot conversations', async () => {
  const engine = syncEngine({ created: 50, updated: 0, skipped: 0, duplicateInputRows: 0 });
  const result = await importCustomerD1LarkSnapshot({
    body: body(),
    db: dbFixture(),
    repository: { marker: 'customer' },
    syncEngine: engine,
    tables: { [TABLE_KEY]: 'tbl_customer_conversations' },
  });
  assert.equal(engine.calls[0].tableId, 'tbl_customer_conversations');
  assert.equal(engine.calls[0].keyField, 'conversation_key');
  assert.equal(engine.calls[0].rows.length, 50);
  assert.equal(Object.hasOwn(engine.calls[0].rows[0], 'customer_key'), false);
  assert.equal(engine.calls[0].rows[0].sync_run_id, 'sync-1');
  assert.equal(result.reconciliation[0].created, 50);
});

test('Customer D1 snapshot replay may skip the complete batch', async () => {
  const result = await importCustomerD1LarkSnapshot({
    body: body(),
    db: dbFixture(),
    repository: {},
    syncEngine: syncEngine({ created: 0, updated: 0, skipped: 50, duplicateInputRows: 0 }),
    tables: { [TABLE_KEY]: 'tbl_customer_conversations' },
  });
  assert.equal(result.reconciliation[0].skipped, 50);
});

test('Customer D1 snapshot fails closed when the reviewed manifest drifts', async () => {
  await assert.rejects(importCustomerD1LarkSnapshot({
    body: body(),
    db: dbFixture({ total_rows: 1145 }),
    repository: {},
    syncEngine: syncEngine({ created: 0, updated: 0, skipped: 50 }),
    tables: { [TABLE_KEY]: 'tbl_customer_conversations' },
  }), (error) => error.code === 'CUSTOMER_D1_LARK_IMPORT_INVALID');
});

test('Worker route rejects disabled mode and foreign runtime before infrastructure initialization', async () => {
  const job = {
    body: {
      schemaVersion: 1,
      type: JOB_TYPES.CUSTOMER_D1_LARK_SNAPSHOT_IMPORT,
      trigger: JOB_TRIGGERS.CUSTOMER_D1_SNAPSHOT_IMPORT,
      tableKey: TABLE_KEY,
    },
  };
  const runtime = {
    environment: 'production',
    profileKey: 'chemistry_k',
    customerKey: 'chemistry_k',
    infrastructureOwner: 'customer',
  };
  await assert.rejects(processJob({
    job,
    env: {},
    getRuntimeConfig: () => runtime,
    getInfrastructure: () => { throw new Error('must not initialize'); },
  }), (error) => error.code === 'CUSTOMER_D1_LARK_IMPORT_DISABLED');

  await assert.rejects(processJob({
    job,
    env: { MKT_CUSTOMER_D1_LARK_IMPORT_MODE: CUSTOMER_D1_LARK_IMPORT_MODE },
    getRuntimeConfig: () => ({ ...runtime, profileKey: 'integration_workspace' }),
    getInfrastructure: () => { throw new Error('must not initialize'); },
  }), (error) => error.code === 'CUSTOMER_D1_LARK_IMPORT_FORBIDDEN');
});
