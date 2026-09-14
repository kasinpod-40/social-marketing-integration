import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createCustomerWeeklyAiQualityPreviewHttpHandler,
  CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH,
} from '../../apps/sync-worker/src/customer-weekly-ai-quality-preview-http.js';

const TOKEN = 'weekly-quality-preview-token';
const TOKEN_DIGEST = 'a'.repeat(64);
const WORK_KEY = 'lark_notification:weekly-executive-auto-20260913';
const AI_RUN_KEY = `weekly-7d-executive-decision:${'b'.repeat(64)}`;
const IDENTITY_SHA256 = createHash('sha256').update(AI_RUN_KEY).digest('hex');

function environment() {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    LARK_TABLE_MKT_AI_REPORT_RUNS: 'tblM96oQuMoN2E5v',
    MKT_WEEKLY_AI_QUALITY_PREVIEW_TOKEN_SHA256: TOKEN_DIGEST,
    MKT_STATE_DB: { prepare() {} },
  };
}

function request(token = TOKEN, body = {
  mode: 'diagnose',
  workKey: WORK_KEY,
  periodEnd: '2026-09-13',
}) {
  return new Request(`https://preview.invalid${CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function database() {
  return {
    prepare(sql) {
      return {
        bind() {
          if (sql.includes('FROM sync_work_runs')) {
            return { async first() {
              return {
                work_key: WORK_KEY,
                work_type: 'lark_automatic_weekly_executive_notification_v1',
                generation: 123,
                lifecycle_status: 'terminal',
                terminal_reason: 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED',
              };
            } };
          }
          return { async all() {
            return { results: [
              {
                phase: 'fresh_ai_row_create_attempt', complete: 1,
                state_json: JSON.stringify({ identitySha256: IDENTITY_SHA256 }),
              },
              {
                phase: 'native_ai_trigger_attempt', complete: 1,
                state_json: JSON.stringify({ aiRunKeySha256: IDENTITY_SHA256 }),
              },
            ] };
          } };
        },
      };
    },
  };
}

test('read-only Preview returns only exact quality violations and no generated prose', async () => {
  const db = database();
  const handler = createCustomerWeeklyAiQualityPreviewHttpHandler({
    async digest(value) { return value === TOKEN ? TOKEN_DIGEST : 'c'.repeat(64); },
    createInfrastructure() {
      return {
        getStateDb: () => db,
        repository: {
          async listByFieldValues() {
            return [{ fields: {
              ai_run_key: AI_RUN_KEY,
              insight_summary: 'customer prose must not leave worker',
              strengths: 'customer prose must not leave worker',
              weaknesses: 'customer prose must not leave worker',
              recommendations: 'customer prose must not leave worker',
            } }];
          },
        },
      };
    },
    async collectRetainedSource() {
      return {
        targetPeriod: { periodStart: '2026-09-07', periodEnd: '2026-09-13' },
        settings: [],
        reportBundles: [{ payload: { generatedAt: 123 } }],
      };
    },
    async buildSeed() { return { executiveRow: {} }; },
    buildFactualReport() { return {}; },
    buildSynthesis() { return { aiRunKey: 'expected-old-key', evidence: { evidence: {} } }; },
    assertGenerated() {
      const error = new Error('quality failed');
      error.code = 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED';
      error.details = {
        violations: ['insight_contains_action'],
        outputs: { insight_summary: 'must-not-leak' },
      };
      throw error;
    },
  });
  const response = await handler({
    request: request(), env: { ...environment(), MKT_STATE_DB: db },
    url: new URL(`https://preview.invalid${CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH}`),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.result.qualityGate, {
    passed: false,
    violations: ['insight_contains_action'],
  });
  assert.equal(body.result.boundedRepair.repaired, false);
  assert.equal(body.result.d1WriteCount, 0);
  assert.equal(body.result.larkWriteCount, 0);
  assert.equal(body.result.queueAdmissionCount, 0);
  assert.equal(body.result.messageSendCount, 0);
  assert.doesNotMatch(JSON.stringify(body), /customer prose|must-not-leak/u);
});

test('Preview rejects wrong identity and authorization before reading Customer data', async () => {
  let constructed = false;
  const handler = createCustomerWeeklyAiQualityPreviewHttpHandler({
    async digest(value) { return value === TOKEN ? TOKEN_DIGEST : 'c'.repeat(64); },
    createInfrastructure() { constructed = true; return {}; },
  });
  const wrongToken = await handler({
    request: request('wrong'), env: environment(),
    url: new URL(`https://preview.invalid${CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH}`),
  });
  assert.equal(wrongToken.status, 401);
  const wrongIdentity = await handler({
    request: request(TOKEN, { mode: 'diagnose', workKey: 'other', periodEnd: '2026-09-13' }),
    env: environment(),
    url: new URL(`https://preview.invalid${CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_PATH}`),
  });
  assert.equal(wrongIdentity.status, 400);
  assert.equal(constructed, false);
});
