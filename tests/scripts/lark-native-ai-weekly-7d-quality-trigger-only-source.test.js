import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-quality-trigger-only.mjs', import.meta.url), 'utf8');

test('weekly AI quality trigger mutates failure_code only', () => {
  assert.match(source, /TRIGGER_WEEKLY_7D_NATIVE_AI_QUALITY_V4/u);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_QUALITY_RETRY_V3/u);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_QUALITY_TRIGGER_V4/u);
  assert.match(source, /PROMPT_SHAPE = 'lark_ai_compact_quality_v2'/u);
  assert.match(source, /const updateFields = \{ failure_code: TRIGGER_MARKER \}/u);
  assert.match(source, /writtenFields: \['failure_code'\]/u);
  assert.match(source, /recordWriteCount: 1/u);
  assert.match(source, /evidenceMutation: false/u);
  assert.match(source, /outputMutationByOperator: false/u);
  assert.doesNotMatch(source, /metric_summary_json:\s*hardened/u);
  assert.doesNotMatch(source, /generation_status:\s*'pending'/u);
  assert.doesNotMatch(source, /insight_summary:\s*null/u);
  assert.doesNotMatch(source, /batchCreateRecords/u);
  assert.doesNotMatch(source, /Queue|sendMessage|deploy/u);
});

test('weekly AI quality trigger remains notification-safe and returns four outputs', () => {
  assert.match(source, /Notification automation must remain inactive/u);
  assert.match(source, /notificationCount: 0/u);
  assert.match(source, /scheduleEnabled: false/u);
  assert.match(source, /production: 'BLOCKED'/u);
  for (const field of ['insight_summary', 'strengths', 'weaknesses', 'recommendations']) {
    assert.match(source, new RegExp(`${field}: optionalText\\(observed\\.${field}\\)`, 'u'));
  }
});
