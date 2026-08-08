import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-business-metric-consistency-v9.mjs', import.meta.url), 'utf8');

test('V9 starts only from finalized generated quality-v5 state', () => {
  assert.match(source, /RETRY_WEEKLY_7D_NATIVE_AI_BUSINESS_METRIC_V9/);
  assert.match(source, /lark_ai_compact_quality_v5/);
  assert.match(source, /generation_status\) === 'generated'/);
  assert.match(source, /failure_code\) === null/);
  assert.match(source, /notification_eligible\) === false/);
  assert.match(source, /sent_to_group\) === false/);
});

test('V9 revalidates the retained V8 output before any write', () => {
  assert.match(source, /hardenLarkNativeAiExecutiveBusinessMetricConsistency/);
  assert.match(source, /insight_ctr_inconsistent_with_components/);
  assert.match(source, /priorQualityGate\.violations\.length !== 1/);
  assert.match(source, /stage = 'prepare-v9'/);
});

test('V9 performs one evidence preparation and one failure_code-only trigger', () => {
  assert.match(source, /metric_summary_json: hardened\.metricSummaryJson/);
  assert.match(source, /fields: \{ failure_code: TRIGGER_MARKER \}/);
  assert.match(source, /preparationTouchesFailureCode: false/);
  assert.match(source, /triggerWrittenFields: \['failure_code'\]/);
  assert.match(source, /recordWriteCount: 2/);
});

test('V9 preserves Notification Schedule and Production safety boundaries', () => {
  assert.match(source, /Eligible AI Run → Lark Group Notification/);
  assert.match(source, /Notification automation must remain inactive/);
  assert.match(source, /notificationCount: 0/);
  assert.match(source, /scheduleEnabled: false/);
  assert.match(source, /production: 'BLOCKED'/);
  assert.doesNotMatch(source, /batchCreateRecords|queue\.send|wrangler deploy|D1Database|CREATE TABLE|DROP TABLE/i);
});
