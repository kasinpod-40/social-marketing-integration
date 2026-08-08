import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-v9-read-only-acceptance.mjs', import.meta.url), 'utf8');

test('V9 acceptance is read-only and pins finalized quality-v6 state', () => {
  assert.match(source, /lark_ai_compact_quality_v6/);
  assert.match(source, /generation_status\) === 'generated'/);
  assert.match(source, /failure_code\) === null/);
  assert.match(source, /recordWriteCount: 0/);
  assert.match(source, /evidenceRewriteCount: 0/);
  assert.match(source, /aiCallCount: 0/);
  assert.doesNotMatch(source, /batchUpdateRecords|batchCreateRecords|updateRecord|createRecord/);
});

test('V9 acceptance uses the shared retained-evidence reader and quality gate', () => {
  assert.match(source, /readLarkNativeAiExecutiveBusinessMetricEvidence/);
  assert.match(source, /validateLarkNativeAiExecutiveWriterOutputs/);
  assert.match(source, /derivedCtrFacts\.length < 1/);
  assert.match(source, /weekly_7d_native_ai_v9_read_only_acceptance_passed/);
});

test('V9 acceptance keeps notification schedule and production blocked', () => {
  assert.match(source, /Eligible AI Run → Lark Group Notification/);
  assert.match(source, /Notification automation must remain inactive/);
  assert.match(source, /notificationCount: 0/);
  assert.match(source, /scheduleEnabled: false/);
  assert.match(source, /production: 'BLOCKED'/);
  assert.doesNotMatch(source, /queue\.send|wrangler deploy|D1Database|CREATE TABLE|DROP TABLE/i);
});
