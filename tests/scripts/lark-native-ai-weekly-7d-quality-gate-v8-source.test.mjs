import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-quality-gate-v8.mjs', import.meta.url), 'utf8');

test('V8 requires exact prior V7 state and exact confirmation', () => {
  assert.match(source, /RETRY_WEEKLY_7D_NATIVE_AI_QUALITY_GATE_V8/);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_PROMPT_V3_TRIGGER_V7/);
  assert.match(source, /lark_ai_compact_quality_v4/);
  assert.match(source, /failure_code\) === PRIOR_TRIGGER_MARKER/);
});

test('V8 upgrades only the retained evidence and then triggers through failure_code only', () => {
  assert.match(source, /metric_summary_json: upgraded\.metricSummaryJson/);
  assert.match(source, /fields: \{ failure_code: TRIGGER_MARKER \}/);
  assert.match(source, /preparationTouchesFailureCode: false/);
  assert.match(source, /triggerWrittenFields: \['failure_code'\]/);
  assert.match(source, /evidenceRewriteCount: 1/);
});

test('V8 pins the prior diagnosis to missing real business metric only', () => {
  assert.match(source, /priorQualityGate\.violations\.length !== 1/);
  assert.match(source, /insight_missing_business_metric_value/);
  assert.match(source, /validateLarkNativeAiExecutiveWriterOutputs/);
});

test('V8 preserves Notification Schedule and Production safety boundaries', () => {
  assert.match(source, /Eligible AI Run → Lark Group Notification/);
  assert.match(source, /Notification automation must remain inactive/);
  assert.match(source, /notificationCount: 0/);
  assert.match(source, /scheduleEnabled: false/);
  assert.match(source, /production: 'BLOCKED'/);
  assert.doesNotMatch(source, /batchCreateRecords|queue\.send|wrangler deploy|D1Database|CREATE TABLE|DROP TABLE/i);
});
