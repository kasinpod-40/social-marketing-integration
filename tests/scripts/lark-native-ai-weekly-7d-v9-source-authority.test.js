import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from '../../scripts/lib/lark-native-ai-weekly-7d-controlled-uat.js';

const DAY = 86_400_000;
const PERIOD_START = '2026-09-14';
const PERIOD_END = '2026-09-20';
const RETAINED_ID = 'integration_workspace:youtube:rolling:7d:chemistry_k:rolling_days:2026-09-14:2026-09-20:youtube-organic-v1';
const atBangkokDay = (date) => Date.parse(`${date}T00:00:00.000+07:00`);

function sourceV9() {
  return {
    fields: {
      ai_run_key: `weekly-v9:${'a'.repeat(64)}`,
      report_id: `weekly-v9:${'a'.repeat(64)}`,
      template_version: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
      scope_type: 'executive',
      channel_key: 'executive',
      window_days: '7',
      period_start: atBangkokDay(PERIOD_START),
      period_end: atBangkokDay(PERIOD_END),
      compare_start: atBangkokDay(PERIOD_START) - (7 * DAY),
      compare_end: atBangkokDay(PERIOD_START) - DAY,
      comparison_mode: 'previous_period',
      readiness_status: 'report_available',
      generation_status: 'generated',
      failure_code: null,
      preview_mode: true,
      notification_eligible: false,
      sent_to_group: false,
      dedupe_key: 'b'.repeat(64),
      source_report_ids_json: JSON.stringify([RETAINED_ID]),
      metric_summary_json: JSON.stringify({ channels: [] }),
      channel_status_vector_json: JSON.stringify([]),
      insight_summary: 'summary',
      strengths: 'strengths',
      weaknesses: 'weaknesses',
      recommendations: 'recommendations',
      ai_prompt_version: 'lark_ai_compact_quality_v6',
    },
  };
}

function snapshot() {
  return {
    fields: {
      report_id: RETAINED_ID,
      report_setting_key: 'integration_workspace:youtube:rolling:7d',
      customer_profile: 'chemistry_k',
      account_id: 'youtube:chemistry_k',
      report_type: 'dashboard_performance_report',
      window_days: 7,
      period_start: atBangkokDay(PERIOD_START),
      period_end: atBangkokDay(PERIOD_END),
      compare_start: atBangkokDay(PERIOD_START) - (7 * DAY),
      compare_end: atBangkokDay(PERIOD_START) - DAY,
      comparison_mode: 'previous_period',
      metric_payload_json: '{}',
      generated_at: Date.parse('2026-09-21T02:15:00Z'),
      data_status: 'complete',
      coverage_rate: 1,
    },
  };
}

function client(searches = []) {
  const ids = Object.fromEntries(Object.keys(LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES)
    .map((key) => [key, `tbl_${key}`]));
  return {
    listTables: async () => Object.entries(LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES)
      .map(([key, name]) => ({ tableId: ids[key], name })),
    listRecordsPage: async () => ({ hasMore: false, records: [] }),
    searchRecordsByFieldValues: async (input) => {
      searches.push(input);
      if (input.tableId === ids.aiRuns && input.fieldName === 'template_version') return [sourceV9()];
      if (input.tableId === ids.snapshots && input.fieldName === 'report_id') {
        assert.deepEqual(input.values, [RETAINED_ID]);
        return [snapshot()];
      }
      return [];
    },
  };
}

test('exact retained collection uses accepted V9 source_report_ids instead of recomputing current report IDs', async () => {
  const searches = [];
  const result = await collectLarkNativeAiWeekly7dControlledUatSource({
    client: client(searches),
    customerProfile: 'chemistry_k',
    targetPeriodEnd: PERIOD_END,
  });

  assert.deepEqual(result.sourceReportIds, [RETAINED_ID]);
  assert.deepEqual(result.selectedChannels, ['youtube_organic']);
  assert.equal(result.targetPeriod.periodStart, PERIOD_START);
  assert.equal(result.targetPeriod.periodEnd, PERIOD_END);
  assert.equal(result.reportBundles[0].reportSettingKey, 'integration_workspace:youtube:rolling:7d');
  assert.deepEqual(searches.slice(0, 2), [
    {
      tableId: 'tbl_aiRuns',
      fieldName: 'template_version',
      values: [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
    },
    {
      tableId: 'tbl_snapshots',
      fieldName: 'report_id',
      values: [RETAINED_ID],
    },
  ]);
});
