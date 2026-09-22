import assert from 'node:assert/strict';
import test from 'node:test';

import { LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES } from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from '../../scripts/lib/lark-native-ai-weekly-7d-controlled-uat.js';

const DAY = 86_400_000;
const PERIOD_END = '2026-09-20';
const PERIOD_START = '2026-09-14';
const YOUTUBE_REPORT_ID = 'chemistry_k:youtube:rolling:7d:chemistry_k:rolling_days:2026-09-14:2026-09-20:youtube-organic-v1';
const atBangkokDay = (date) => Date.parse(`${date}T00:00:00.000+07:00`);

function retainedSnapshot() {
  return {
    fields: {
      report_id: YOUTUBE_REPORT_ID,
      report_setting_key: 'chemistry_k:youtube:rolling:7d',
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
      if (input.tableId === ids.snapshots && input.fieldName === 'report_id') {
        assert.ok(input.values.includes(YOUTUBE_REPORT_ID));
        return [retainedSnapshot()];
      }
      return [];
    },
  };
}

test('exact retained period can reconstruct canonical snapshot identities without current enabled settings', async () => {
  const searches = [];
  const result = await collectLarkNativeAiWeekly7dControlledUatSource({
    client: client(searches),
    customerProfile: 'chemistry_k',
    targetPeriodEnd: PERIOD_END,
  });

  assert.equal(result.targetPeriod.periodStart, PERIOD_START);
  assert.equal(result.targetPeriod.periodEnd, PERIOD_END);
  assert.deepEqual(result.sourceReportIds, [YOUTUBE_REPORT_ID]);
  assert.deepEqual(result.selectedChannels, ['youtube_organic']);
  assert.equal(result.selectionPolicy, 'exact_period_end_with_maximum_channel_coverage');
  assert.equal(searches[0].fieldName, 'report_id');
});

test('current/latest collection still fails closed when enabled settings are absent', async () => {
  await assert.rejects(
    () => collectLarkNativeAiWeekly7dControlledUatSource({
      client: client(),
      customerProfile: 'chemistry_k',
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SETTINGS_MISSING',
  );
});
