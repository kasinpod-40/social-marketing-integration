import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const HANDLER = await readFile(
  new URL('../../apps/sync-worker/src/customer-weekly-format-correction-preview-http.js', import.meta.url),
  'utf8',
);
const OPERATOR = await readFile(
  new URL('../../scripts/customer-weekly-format-correction.mjs', import.meta.url),
  'utf8',
);

test('weekly correction uses exact Customer PROD retained D1 facts and shared format quality', () => {
  assert.match(HANDLER, /collectRetainedD1Weekly7dSource/u);
  assert.match(HANDLER, /targetPeriodEnd:\s*PERIOD_END/u);
  assert.match(HANDLER, /buildLarkWeeklyExecutiveFactualReport/u);
  assert.match(HANDLER, /buildLarkWeeklyExecutiveDeterministicInsightSummary/u);
  assert.match(HANDLER, /validateLarkWeeklyExecutiveFullChannelAiOutputs/u);
  assert.match(HANDLER, /PERIOD_START = '2026-09-14'/u);
  assert.match(HANDLER, /PERIOD_END = '2026-09-20'/u);
});

test('weekly correction resolves the reviewed customer destination and never persists raw destination', () => {
  assert.match(HANDLER, /expectedName:\s*env\.MKT_NOTIFICATION_DESTINATION_CHAT_NAME/u);
  assert.match(HANDLER, /expectedDestinationKeyHash:\s*env\.MKT_NOTIFICATION_DESTINATION_KEY_HASH/u);
  assert.match(HANDLER, /Chemistry K — Marketing Alerts/u);
  assert.doesNotMatch(HANDLER, /chat_id\s*[:=]\s*['"][^'"]+['"]/u);
});

test('preview is read-only and send has one new idempotent direct-message identity', () => {
  const previewReturn = HANDLER.indexOf("if (body.mode === 'preview')");
  const sendCall = HANDLER.indexOf('/open-apis/im/v1/messages?receive_id_type=chat_id&uuid=');
  assert.ok(previewReturn > 0);
  assert.ok(sendCall > previewReturn);
  assert.match(HANDLER, /weekly-exec-20260920-format-correction-v2/u);
  assert.match(HANDLER, /already_visible_exact_message/u);
  assert.doesNotMatch(HANDLER, /MKT_SYNC_QUEUE\.send|queue\.send/u);
});

test('operator uploads only an isolated Preview version and preserves Production traffic', () => {
  assert.match(OPERATOR, /versions', 'upload/u);
  assert.match(OPERATOR, /productionTrafficChanged:\s*false/u);
  assert.match(OPERATOR, /preview_urls = true/u);
  assert.match(OPERATOR, /delete config\.triggers/u);
  assert.match(OPERATOR, /delete config\.queues/u);
  assert.doesNotMatch(OPERATOR, /wrangler', 'deploy/u);
});
