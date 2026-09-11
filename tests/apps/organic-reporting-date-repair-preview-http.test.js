import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOrganicReportingDateRepairPreviewHttpHandler,
  ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH,
} from '../../apps/sync-worker/src/organic-reporting-date-repair-preview-http.js';

const TOKEN = 'organic-repair-token';
const TOKEN_DIGEST = 'a'.repeat(64);

function environment() {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    LARK_APP_TOKEN: 'Tcm4bYRL4acuQysp6AwlmXBKgbe',
    LARK_TABLE_MKT_ACCOUNTS: 'tblVB102JoqSfgHa',
    LARK_TABLE_MKT_CONTENT_DAILY: 'tblODz9RcmCIFtfQ',
    MKT_ORGANIC_DATE_REPAIR_TOKEN_SHA256: TOKEN_DIGEST,
    MKT_STATE_DB: { prepare() {} },
  };
}

function request(token = TOKEN, mode = 'preview') {
  return new Request(`https://preview.invalid${ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

test('organic date Preview handler passes exact Customer PROD tables only', async () => {
  let observed = null;
  const env = environment();
  const handler = createOrganicReportingDateRepairPreviewHttpHandler({
    async digest(value) { return value === TOKEN ? TOKEN_DIGEST : 'b'.repeat(64); },
    createInfrastructure() {
      return {
        getLarkBitableClient: () => 'client',
        getStateDb: () => env.MKT_STATE_DB,
        repository: 'repository',
        syncEngine: 'sync-engine',
      };
    },
    async runOperator(input) { observed = input; return { status: 'completed' }; },
  });
  const response = await handler({
    request: request(),
    env,
    url: new URL(`https://preview.invalid${ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(observed.tables, {
    mktAccounts: 'tblVB102JoqSfgHa',
    mktContentDaily: 'tblODz9RcmCIFtfQ',
  });
  assert.equal(observed.execute, false);
});

test('organic date Preview handler rejects wrong Base/table authority before construction', async () => {
  let constructed = false;
  const handler = createOrganicReportingDateRepairPreviewHttpHandler({
    async digest() { return TOKEN_DIGEST; },
    createInfrastructure() { constructed = true; return {}; },
  });
  const response = await handler({
    request: request(),
    env: { ...environment(), LARK_TABLE_MKT_CONTENT_DAILY: 'wrong' },
    url: new URL(`https://preview.invalid${ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 400);
  assert.equal(constructed, false);
});

test('organic date Preview handler rejects invalid authorization', async () => {
  const handler = createOrganicReportingDateRepairPreviewHttpHandler({
    async digest() { return 'b'.repeat(64); },
  });
  const response = await handler({
    request: request('wrong'),
    env: environment(),
    url: new URL(`https://preview.invalid${ORGANIC_REPORTING_DATE_REPAIR_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'ORGANIC_DATE_REPAIR_UNAUTHORIZED');
});
