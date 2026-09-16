import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCustomerOrganicAccountDailyPreviewHttpHandler,
  CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH,
} from '../../apps/sync-worker/src/customer-organic-account-daily-preview-http.js';

const TOKEN = 'reviewed-preview-token';
const DIGEST = 'a'.repeat(64);

test('Organic Account Daily Preview handler binds only exact Customer PROD infrastructure', async () => {
  let observed;
  const db = { prepare() {} };
  const repository = {};
  const syncEngine = {};
  const handler = createCustomerOrganicAccountDailyPreviewHttpHandler({
    async digest(value) { return value === TOKEN ? DIGEST : 'b'.repeat(64); },
    createInfrastructure() {
      return { getStateDb: () => db, repository, syncEngine };
    },
    async runOperator(input) { observed = input; return { mode: 'preview' }; },
  });
  const response = await handler({
    request: request({ mode: 'preview' }),
    env: environment(db),
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 200);
  assert.equal(observed.execute, false);
  assert.equal(observed.db, db);
  assert.equal(observed.repository, repository);
  assert.equal(observed.syncEngine, syncEngine);
  assert.equal(observed.tableId, 'tbl-account-daily');
});

test('Organic Account Daily Preview handler rejects bad auth and placeholder table mapping', async () => {
  const handler = createCustomerOrganicAccountDailyPreviewHttpHandler({
    async digest() { return 'b'.repeat(64); },
  });
  const unauthorized = await handler({
    request: request({ mode: 'preview' }),
    env: environment({ prepare() {} }),
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH}`),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).code, 'ORGANIC_ACCOUNT_DAILY_UNAUTHORIZED');

  const invalid = await handler({
    request: request({ mode: 'preview' }),
    env: { ...environment({ prepare() {} }), LARK_TABLE_MKT_ACCOUNT_DAILY: 'replace-with-table-id' },
    url: new URL(`https://preview.invalid${CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH}`),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'ORGANIC_ACCOUNT_DAILY_RUNTIME_INVALID');
});

function environment(db) {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    LARK_APP_TOKEN: 'Tcm4bYRL4acuQysp6AwlmXBKgbe',
    LARK_TABLE_MKT_ACCOUNT_DAILY: 'tbl-account-daily',
    MKT_ADS_PROD_OPERATOR_TOKEN_SHA256: DIGEST,
    MKT_STATE_DB: db,
  };
}

function request(body) {
  return new Request(`https://preview.invalid${CUSTOMER_ORGANIC_ACCOUNT_DAILY_PREVIEW_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
