import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-native-action-retry.mjs', import.meta.url), 'utf8');

test('native weekly AI retry mutates only failure_code and never recompacts evidence', () => {
  assert.match(source, /CONTROLLED_UAT_RETRY_COMPACT_V1/);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_RETRY_V2/);
  assert.match(source, /promptShape !== 'lark_ai_compact_v1'/);
  assert.match(source, /metricSummaryText\.length > 2800/);
  assert.match(source, /channelStatusVectorText\.length > 700/);
  assert.match(source, /fields: \{ failure_code: RETRY_MARKER \}/);
  assert.doesNotMatch(source, /compactLarkNativeAiWeeklyEvidence/);
  assert.doesNotMatch(source, /metric_summary_json:\s*compact/);
  assert.doesNotMatch(source, /channel_status_vector_json:\s*compact/);
});

test('native weekly AI retry keeps notification and production safety closed', () => {
  assert.match(source, /Notification automation must remain inactive/);
  assert.match(source, /notificationCount: 0/);
  assert.match(source, /scheduleEnabled: false/);
  assert.match(source, /production: 'BLOCKED'/);
  assert.match(source, /maximumRecordWrites: 1/);
});
