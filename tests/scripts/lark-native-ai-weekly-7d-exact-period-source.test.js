import assert from 'node:assert/strict';
import test from 'node:test';

import { LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES } from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from '../../scripts/lib/lark-native-ai-weekly-7d-controlled-uat.js';

const DAY = 86_400_000;
const atBangkokDay = (date) => Date.parse(`${date}T00:00:00.000+07:00`);

function snapshot(periodEnd, generatedAt) {
  const end = atBangkokDay(periodEnd);
  const start = end - (6 * DAY);
  return {
    fields: {
      report_id: `report:${periodEnd}`,
      report_setting_key: 'chemistry_k:youtube:rolling:7d',
      customer_profile: 'chemistry_k',
      account_id: 'youtube:chemistry_k',
      report_type: 'dashboard_performance_report',
      window_days: 7,
      period_start: start,
      period_end: end,
      compare_start: start - (7 * DAY),
      compare_end: start - DAY,
      comparison_mode: 'previous_period',
      metric_payload_json: '{}',
      generated_at: generatedAt,
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
    listRecordsPage: async () => ({
      hasMore: false,
      records: [{ fields: {
        enabled: true,
        customer_profile: 'chemistry_k',
        report_type: 'dashboard_performance_report',
        window_days: 7,
        platforms: ['youtube'],
        capability: 'organic',
        report_setting_key: 'chemistry_k:youtube:rolling:7d',
        account_id: 'youtube:chemistry_k',
      } }],
    }),
    searchRecordsByFieldValues: async (input) => {
      const { tableId } = input;
      searches.push(input);
      if (tableId === ids.snapshots && input.fieldName === 'report_id') {
        return [snapshot('2026-09-06', Date.parse('2026-09-07T02:15:00Z'))];
      }
      if (tableId === ids.snapshots) {
        return [
          snapshot('2026-09-06', Date.parse('2026-09-07T02:15:00Z')),
          snapshot('2026-09-07', Date.parse('2026-09-08T02:15:00Z')),
        ];
      }
      return [];
    },
  };
}

test('exact period selection keeps a retained Weekly recovery on its scheduled period', async () => {
  const exactSearches = [];
  const exact = await collectLarkNativeAiWeekly7dControlledUatSource({
    client: client(exactSearches),
    customerProfile: 'chemistry_k',
    targetPeriodEnd: '2026-09-06',
  });
  assert.equal(exact.targetPeriod.periodEnd, '2026-09-06');
  assert.deepEqual(exact.sourceReportIds, ['report:2026-09-06']);
  assert.equal(exact.selectionPolicy, 'exact_period_end_with_maximum_channel_coverage');
  assert.deepEqual(exactSearches[0], {
    tableId: 'tbl_snapshots',
    fieldName: 'report_id',
    values: [
      'chemistry_k:youtube:rolling:7d:chemistry_k:rolling_days:2026-08-31:2026-09-06:youtube-organic-v1',
    ],
  });

  const latestSearches = [];
  const latest = await collectLarkNativeAiWeekly7dControlledUatSource({
    client: client(latestSearches),
    customerProfile: 'chemistry_k',
  });
  assert.equal(latest.targetPeriod.periodEnd, '2026-09-07');
  assert.equal(latest.selectionPolicy, 'newest_7d_period_with_maximum_channel_coverage');
  assert.equal(latestSearches[0].fieldName, 'report_setting_key');
});
