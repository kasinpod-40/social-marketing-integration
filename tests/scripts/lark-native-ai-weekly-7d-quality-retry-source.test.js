import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-quality-retry.mjs', import.meta.url), 'utf8');

test('weekly AI quality v3 retry prepares without failure_code then wakes with failure_code only', () => {
  assert.match(source, /RETRY_WEEKLY_7D_NATIVE_AI_QUALITY_V3/u);
  assert.match(source, /lark_ai_compact_quality_v2/u);
  assert.match(source, /lark_ai_compact_quality_v3/u);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_QUALITY_TRIGGER_V5/u);
  assert.match(source, /hardenLarkNativeAiWeeklyEvidence/u);
  assert.match(source, /prepare-quality-v3-without-trigger-field/u);
  assert.match(source, /generation_status: 'pending'/u);
  assert.match(source, /notification_eligible: false/u);
  assert.match(source, /sent_to_group: false/u);
  assert.match(source, /preparationTouchesFailureCode: false/u);
  assert.match(source, /fields: \{ failure_code: TRIGGER_MARKER \}/u);
  assert.match(source, /triggerWrittenFields: \['failure_code'\]/u);
  assert.match(source, /recordWriteCount: 2/u);
  assert.match(source, /aiCallsByOperator: 0/u);
  assert.match(source, /notificationCount: 0/u);
  assert.doesNotMatch(source, /batchCreateRecords/u);
  assert.doesNotMatch(source, /Queue|sendMessage|deploy/u);
});

test('weekly AI quality v3 retry verifies prepared state before the trigger write', () => {
  assert.match(source, /verify-prepared-quality-v3-row/u);
  assert.match(source, /isPreparedQualityV3Row\(prepared, hardened\)/u);
  assert.match(source, /optionalText\(fields\.metric_summary_json\) === hardened\.metricSummaryJson/u);
  assert.match(source, /optionalText\(fields\.channel_status_vector_json\) === hardened\.channelStatusVectorJson/u);
  assert.match(source, /Object\.values\(outputPresence\(fields\)\)\.every\(\(present\) => present === false\)/u);
});

test('weekly AI quality v3 retry exposes generated outputs for review', () => {
  for (const field of ['insight_summary', 'strengths', 'weaknesses', 'recommendations']) {
    assert.match(source, new RegExp(`${field}: optionalText\\(observed\\.${field}\\)`, 'u'));
  }
});
