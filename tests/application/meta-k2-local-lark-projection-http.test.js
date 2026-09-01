import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMetaK2LocalLarkProjectionHttpHandler,
  META_K2_LOCAL_LARK_PROJECTION_MODE,
  META_K2_LOCAL_LARK_PROJECTION_PATH,
} from '../../apps/sync-worker/src/meta-k2-local-lark-projection-http.js';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';

const OPERATION = Object.freeze({
  operationId: 'meta-ads-chemistry-k2-scheduled-20260828',
  workKey: 'meta_ads:chemistry_k2:meta-ads-chemistry-k2-scheduled-20260828',
  generation: 1_787_938_203_000,
});
const TOKEN_DIGEST = 'a'.repeat(64);

function env() {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_META_K2_LOCAL_LARK_PROJECTION_MODE: META_K2_LOCAL_LARK_PROJECTION_MODE,
    MKT_META_K2_LOCAL_LARK_PROJECTION_OPERATION_ID: OPERATION.operationId,
    MKT_META_K2_LOCAL_LARK_PROJECTION_WORK_KEY: OPERATION.workKey,
    MKT_META_K2_LOCAL_LARK_PROJECTION_GENERATION: String(OPERATION.generation),
    MKT_META_K2_LOCAL_LARK_PROJECTION_TOKEN_SHA256: TOKEN_DIGEST,
    LARK_TABLE_MKT_ADS_ACCOUNTS: 'tbl_accounts',
    LARK_TABLE_MKT_ADS_CAMPAIGNS: 'tbl_campaigns',
    LARK_TABLE_MKT_ADS_ADGROUPS: 'tbl_adgroups',
    LARK_TABLE_MKT_ADS_ADS: 'tbl_ads',
    LARK_TABLE_MKT_ADS_CREATIVES: 'tbl_creatives',
    LARK_TABLE_MKT_ADS_DAILY: 'tbl_daily',
  };
}

test('writes one exact bounded K2 Lark batch and records proof', async () => {
  const rows = [{ ads_account_key: 'meta_ads:a:account:1', account_name: 'K2' }];
  const batchDigest = await createStableFingerprint({
    schemaVersion: 'meta_k2_local_lark_projection_batch_v1',
    operation: OPERATION,
    tableKey: 'mktAdsAccounts',
    keyField: 'ads_account_key',
    batchSequence: 0,
    rows,
  });
  const calls = [];
  const handler = createMetaK2LocalLarkProjectionHttpHandler({
    digest: async () => TOKEN_DIGEST,
    createInfrastructure: () => ({
      repository: {},
      syncEngine: {
        async syncByKey(input) {
          calls.push(input);
          return { created: 1, updated: 0, skipped: 0, duplicateInputRows: 0 };
        },
      },
    }),
    createStore: () => ({
      async findBatch() { return null; },
      async recordBatch(input) {
        calls.push(input);
        return { batchCount: 1, rowCount: 1, complete: true };
      },
    }),
  });
  const response = await handler({
    request: request({
      mode: 'write', operation: OPERATION,
      tableKey: 'mktAdsAccounts', keyField: 'ads_account_key', rows,
      batchSequence: 0, expectedBatches: 1, expectedRows: 1,
      manifestDigest: 'b'.repeat(64), batchDigest,
    }),
    env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.created, 1);
  assert.equal(calls[0].tableId, 'tbl_accounts');
  assert.equal(calls[1].workKey, OPERATION.workKey);
});

test('replays an already-proven batch without writing Lark again', async () => {
  const rows = [{ ads_account_key: 'meta_ads:a:account:1', account_name: 'K2' }];
  const batchDigest = await createStableFingerprint({
    schemaVersion: 'meta_k2_local_lark_projection_batch_v1',
    operation: OPERATION,
    tableKey: 'mktAdsAccounts',
    keyField: 'ads_account_key',
    batchSequence: 0,
    rows,
  });
  let larkWrites = 0;
  const handler = createMetaK2LocalLarkProjectionHttpHandler({
    digest: async () => TOKEN_DIGEST,
    createInfrastructure: () => ({
      repository: {},
      syncEngine: { async syncByKey() { larkWrites += 1; throw new Error('must not write'); } },
    }),
    createStore: () => ({
      async findBatch() {
        return {
          batchDigest, tableKey: 'mktAdsAccounts', keyField: 'ads_account_key',
          rowCount: 1, created: 1, updated: 0, skipped: 0,
        };
      },
      async requireProgress() { return { batchCount: 1, rowCount: 1, complete: true }; },
    }),
  });
  const response = await handler({
    request: request({
      mode: 'write', operation: OPERATION,
      tableKey: 'mktAdsAccounts', keyField: 'ads_account_key', rows,
      batchSequence: 0, expectedBatches: 1, expectedRows: 1,
      manifestDigest: 'b'.repeat(64), batchDigest,
    }),
    env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replayedFromProof, true);
  assert.equal(larkWrites, 0);
});

test('finalizes only after exact projection proof and same-generation reactivation', async () => {
  const calls = [];
  const handler = createMetaK2LocalLarkProjectionHttpHandler({
    digest: async () => TOKEN_DIGEST,
    createStore: () => ({
      async requireComplete(input) {
        calls.push(['proof', input]);
        return { expectedBatches: 2, expectedRows: 30, created: 20, updated: 10, skipped: 0 };
      },
      async readWork() { return { lifecycleStatus: 'completed' }; },
    }),
    createWorkStore: () => ({
      async prepareCompletedSourceRedrive(input) {
        calls.push(['reactivate', input]);
        return { disposition: 'revived' };
      },
      async completeWork(input) { calls.push(['complete', input]); },
    }),
  });
  const response = await handler({
    request: request({
      mode: 'finalize', operation: OPERATION,
      expectedBatches: 2, expectedRows: 30, manifestDigest: 'c'.repeat(64),
    }),
    env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'completed');
  assert.deepEqual(calls.map(([name]) => name), ['proof', 'reactivate', 'complete']);
  assert.equal(calls[1][1].generation, OPERATION.generation);
});

test('fails closed for unauthorized or out-of-scope table requests', async () => {
  const handler = createMetaK2LocalLarkProjectionHttpHandler({
    digest: async (value) => (value === 'valid-token' ? TOKEN_DIGEST : 'd'.repeat(64)),
    createStore: () => ({ async recordBatch() { throw new Error('must not write'); } }),
  });
  const unauthorized = await handler({
    request: request({}, 'wrong-token'), env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(unauthorized.status, 401);

  const invalidTable = await handler({
    request: request({
      mode: 'write', operation: OPERATION, tableKey: 'mktContent', keyField: 'content_key',
      rows: [{ content_key: 'x' }], batchSequence: 0, expectedBatches: 1, expectedRows: 1,
      manifestDigest: 'b'.repeat(64), batchDigest: 'c'.repeat(64),
    }, 'valid-token'),
    env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(invalidTable.status, 400);
  assert.equal((await invalidTable.json()).code, 'META_K2_LOCAL_LARK_TABLE_INVALID');
});

test('returns only safe fingerprints when an authenticated batch digest mismatches', async () => {
  const rows = [{ ads_account_key: 'meta_ads:a:account:1', account_name: 'K2' }];
  const calculatedDigest = await createStableFingerprint({
    schemaVersion: 'meta_k2_local_lark_projection_batch_v1',
    operation: OPERATION,
    tableKey: 'mktAdsAccounts',
    keyField: 'ads_account_key',
    batchSequence: 0,
    rows,
  });
  const suppliedDigest = `${calculatedDigest[0] === '0' ? '1' : '0'}${calculatedDigest.slice(1)}`;
  const handler = createMetaK2LocalLarkProjectionHttpHandler({
    digest: async () => TOKEN_DIGEST,
    createStore: () => ({}),
  });
  const response = await handler({
    request: request({
      mode: 'write', operation: OPERATION,
      tableKey: 'mktAdsAccounts', keyField: 'ads_account_key', rows,
      batchSequence: 0, expectedBatches: 1, expectedRows: 1,
      manifestDigest: 'b'.repeat(64), batchDigest: suppliedDigest,
    }),
    env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'META_K2_LOCAL_LARK_BATCH_DIGEST_MISMATCH');
  assert.deepEqual(body.diagnostic, { calculatedDigest, suppliedDigest });
  assert.equal(JSON.stringify(body).includes('account_name'), false);
});

test('identifies only the mismatched exact-target field without returning either identity', async () => {
  const handler = createMetaK2LocalLarkProjectionHttpHandler({
    digest: async () => TOKEN_DIGEST,
  });
  const response = await handler({
    request: request({
      mode: 'identity_probe_only',
      operation: { ...OPERATION, operationId: `${OPERATION.operationId}-wrong` },
    }),
    env: env(),
    url: new URL(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'META_K2_LOCAL_LARK_TARGET_MISMATCH');
  assert.deepEqual(body.diagnostic, { fieldName: 'operationId' });
  assert.equal(JSON.stringify(body).includes(OPERATION.operationId), false);
});

function request(body, token = 'valid-token') {
  return new Request(`https://preview.example${META_K2_LOCAL_LARK_PROJECTION_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
