import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../scripts/lark-native-ai-weekly-7d-quality-retry.mjs', import.meta.url), 'utf8');

test('weekly Prompt v3 retry reuses quality-v4 evidence and wakes with failure_code only', () => {
  assert.match(source, /RETRY_WEEKLY_7D_NATIVE_AI_PROMPT_V3/u);
  assert.match(source, /LARK_NATIVE_AI_AUTOMATION_PROMPTS_V3_APPLIED/u);
  assert.match(source, /lark_ai_compact_quality_v4/u);
  assert.match(source, /lark_native_ai_automation_prompts_v3/u);
  assert.match(source, /CONTROLLED_UAT_NATIVE_AI_PROMPT_V3_TRIGGER_V7/u);
  assert.match(source, /prepare-prompt-v3-retry-without-evidence-rewrite/u);
  assert.match(source, /evidenceRewriteCount: 0/u);
  assert.match(source, /generation_status: 'pending'/u);
  assert.match(source, /notification_eligible: false/u);
  assert.match(source, /sent_to_group: false/u);
  assert.match(source, /preparationTouchesEvidence: false/u);
  assert.match(source, /preparationTouchesFailureCode: false/u);
  assert.match(source, /fields: \{ failure_code: TRIGGER_MARKER \}/u);
  assert.match(source, /triggerWrittenFields: \['failure_code'\]/u);
  assert.match(source, /recordWriteCount: 2/u);
  assert.match(source, /aiCallsByOperator: 0/u);
  assert.match(source, /notificationCount: 0/u);
  assert.doesNotMatch(source, /hardenLarkNativeAiWeeklyEvidence/u);
  assert.doesNotMatch(source, /batchCreateRecords/u);
  assert.doesNotMatch(source, /Queue|sendMessage|deploy/u);
});

test('weekly Prompt v3 retry verifies unchanged evidence before trigger', () => {
  assert.match(source, /verify-prepared-prompt-v3-row/u);
  assert.match(source, /isPreparedPromptV3Row\(prepared, metricSummaryText, channelStatusVectorText\)/u);
  assert.match(source, /optionalText\(fields\.metric_summary_json\) === metricSummaryText/u);
  assert.match(source, /optionalText\(fields\.channel_status_vector_json\) === channelStatusVectorText/u);
  assert.match(source, /Object\.values\(outputPresence\(fields\)\)\.every\(\(present\) => present === false\)/u);
});

test('weekly Prompt v3 retry applies field-isolated executive-writer quality gate', () => {
  assert.match(source, /validateExecutiveWriterOutputs\(outputs, evidence\)/u);
  assert.match(source, /insight_contains_action/u);
  assert.match(source, /insight_contains_strengths_fallback/u);
  assert.match(source, /insight_missing_business_channel_name/u);
  assert.match(source, /insight_missing_business_number/u);
  assert.match(source, /strengths_without_comparison_fallback/u);
  assert.match(source, /unsupported_performance_magnitude/u);
  assert.match(source, /weaknesses_contains_action/u);
  assert.match(source, /weaknesses_contains_data_quality/u);
  assert.match(source, /recommendations_repeats_strengths_fallback/u);
  assert.match(source, /recommendations_contains_heading/u);
  assert.match(source, /recommendations_contains_data_ops/u);
  assert.match(source, /recommendations_missing_business_action/u);
  assert.match(source, /markdown_heading/u);
  assert.match(source, /evidence_footnote/u);
  assert.match(source, /weekly_7d_native_ai_prompt_v3_quality_passed/u);
  assert.match(source, /qualityGate/u);
});

test('weekly Prompt v3 retry returns all four generated outputs', () => {
  assert.match(source, /const OUTPUT_FIELDS = Object\.freeze/u);
  for (const field of ['insight_summary', 'strengths', 'weaknesses', 'recommendations']) {
    assert.match(source, new RegExp(`'${field}'`, 'u'));
  }
  assert.match(source, /outputs,/u);
});
