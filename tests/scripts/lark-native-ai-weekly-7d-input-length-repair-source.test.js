import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../scripts/lark-native-ai-weekly-7d-input-length-repair.mjs', import.meta.url),
  'utf8',
);

test('weekly AI input-length repair measures normalized Lark Text values before comparing compaction size', () => {
  assert.match(source, /const originalMetricSummaryJson = requireText\(fields\.metric_summary_json, 'metric_summary_json'\);/u);
  assert.match(source, /const originalChannelStatusVectorJson = optionalText\(fields\.channel_status_vector_json\) \?\? '';/u);
  assert.match(source, /metricSummaryChars: originalMetricSummaryJson\.length/u);
  assert.match(source, /channelStatusVectorChars: originalChannelStatusVectorJson\.length/u);
  assert.doesNotMatch(source, /String\(fields\.metric_summary_json\)\.length/u);
  assert.doesNotMatch(source, /String\(fields\.channel_status_vector_json/u);
});
