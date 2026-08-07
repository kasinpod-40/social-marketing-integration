import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-quality-retry.mjs', import.meta.url), 'utf8');

test('weekly AI quality retry stays one-shot and notification-safe', () => {
  assert.match(source, /RETRY_WEEKLY_7D_NATIVE_AI_QUALITY_V1/u);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_QUALITY_RETRY_V3/u);
  assert.match(source, /hardenLarkNativeAiWeeklyEvidence/u);
  assert.match(source, /generation_status: 'pending'/u);
  assert.match(source, /notification_eligible: false/u);
  assert.match(source, /sent_to_group: false/u);
  assert.match(source, /recordWriteCount: 1/u);
  assert.match(source, /notificationCount: 0/u);
  assert.doesNotMatch(source, /batchCreateRecords/u);
  assert.doesNotMatch(source, /Queue|sendMessage|deploy/u);
});

test('weekly AI quality retry exposes generated outputs for review', () => {
  for (const field of ['insight_summary', 'strengths', 'weaknesses', 'recommendations']) {
    assert.match(source, new RegExp(`${field}: optionalText\\(observed\\.${field}\\)`, 'u'));
  }
});
