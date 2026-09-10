import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMktAdsCampaignSummaryRetentionPreviewHttpHandler,
  MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH,
} from '../../apps/sync-worker/src/mkt-ads-campaign-summary-retention-preview-http.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const TOKEN = 'reviewed-preview-token';
const TOKEN_DIGEST = 'a'.repeat(64);

function environment() {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    LARK_APP_TOKEN: 'Tcm4bYRL4acuQysp6AwlmXBKgbe',
    LARK_TABLE_MKT_ADS_DAILY: 'tblTjWaxgSCwSj1P',
    MKT_ADS_PROD_OPERATOR_TOKEN_SHA256: TOKEN_DIGEST,
    MKT_STATE_DB: { prepare() {} },
  };
}

function request(token = TOKEN, body = { mode: 'preview', contract: { schema: [], views: [] } }) {
  return new Request(`https://preview.invalid${MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('Preview handler passes only exact customer bindings and bounded operator contract', async () => {
  let observed = null;
  const client = {};
  const db = environment().MKT_STATE_DB;
  const repository = {};
  const syncEngine = {};
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler({
    async digest(value) { return value === TOKEN ? TOKEN_DIGEST : 'b'.repeat(64); },
    createInfrastructure(env) {
      assert.equal(env.MKT_CUSTOMER_PROFILE, 'chemistry_k');
      return {
        getLarkBitableClient: () => client,
        getStateDb: () => db,
        repository,
        syncEngine,
      };
    },
    async runOperator(input) {
      observed = input;
      return { mode: 'preview', status: 'ready', safety: { organicMutations: 0 } };
    },
  });
  const response = await handler({
    request: request(),
    env: { ...environment(), MKT_STATE_DB: db },
    url: new URL(`https://preview.invalid${MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(observed.execute, false);
  assert.equal(observed.client, client);
  assert.equal(observed.db, db);
  assert.equal(observed.repository, repository);
  assert.equal(observed.syncEngine, syncEngine);
  assert.equal(observed.customerKey, 'chemistry_k');
  assert.equal(observed.retentionDays, 90);
  assert.equal(observed.softLimit, 17_000);
  assert.equal(observed.targetLimit, 15_000);
  assert.equal(observed.maxDeleteRows, 500);
});

test('Preview handler rejects invalid authorization without constructing infrastructure', async () => {
  let constructed = false;
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler({
    async digest() { return 'b'.repeat(64); },
    createInfrastructure() { constructed = true; return {}; },
  });
  const response = await handler({
    request: request('wrong'),
    env: environment(),
    url: new URL(`https://preview.invalid${MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'MKT_ADS_PREVIEW_UNAUTHORIZED');
  assert.equal(constructed, false);
});

test('Preview handler rejects a non-customer or wrong-Base runtime before authorization', async () => {
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
  });
  for (const env of [
    { ...environment(), MKT_ENV: 'development' },
    { ...environment(), LARK_APP_TOKEN: 'wrong-base' },
    { ...environment(), LARK_TABLE_MKT_ADS_DAILY: 'wrong-paid-table' },
    { ...environment(), MKT_STATE_DB: null },
  ]) {
    const response = await handler({
      request: request(),
      env,
      url: new URL(`https://preview.invalid${MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH}`),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }
});

test('Preview handler returns only sanitized operational diagnostics for an apply failure', async () => {
  const handler = createMktAdsCampaignSummaryRetentionPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
    createInfrastructure() {
      return {
        getLarkBitableClient: () => ({}),
        getStateDb: () => environment().MKT_STATE_DB,
        repository: {},
        syncEngine: {},
      };
    },
    async runOperator() {
      throw permanentError('Lark API error 1254001: WrongRequestBody', {
        code: 'LARK_PERMANENT_API_ERROR',
        details: { status: 200, larkCode: 1254001, appSecret: 'must-not-leak' },
      });
    },
  });
  const response = await handler({
    request: request(),
    env: environment(),
    url: new URL(`https://preview.invalid${MKT_ADS_CAMPAIGN_SUMMARY_RETENTION_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'LARK_PERMANENT_API_ERROR',
    error: 'Lark API error 1254001: WrongRequestBody',
    details: { status: 200, larkCode: 1254001, appSecret: '[REDACTED]' },
  });
});
