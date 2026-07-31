import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY,
  TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS,
  TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS,
  TIKTOK_ORGANIC_DASHBOARD_WINDOWS,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';
import {
  EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT,
  EXPECTED_DASHBOARD_RECORD_COUNT,
  EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT,
  EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT,
  EXPECTED_REPORT_RECORD_COUNT,
  EXPECTED_REVIEWED_ALIAS_CORRECTION_COUNT,
  LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION,
  assertLarkDashboardDisplayV2BackfillConfirmation,
  assertLarkDashboardDisplayV2Options,
  planLarkDashboardDisplayV2Backfill,
} from '../../scripts/lib/lark-dashboard-display-v2-compatibility-v1.js';

const FIELD_NAMES = Object.freeze({
  metricKey: 'metric_key',
  numberWindow: 'window_days',
  preservedWindowSelect: '__mkt_legacy_window_days_single_select_v1',
  displaySelectV2: LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName,
  currentValue: 'current_value',
  reportType: 'report_type',
  platform: 'platform',
  capability: 'capability',
  periodKind: 'period_kind',
  customerProfile: 'customer_profile',
  customerKey: 'customer_key',
  accountId: 'account_id',
});

const PREPOPULATED_CORRECT_KEYS = Object.freeze([
  'tiktok:period_views',
  'tiktok:period_likes',
  'tiktok:period_comments',
  'tiktok:period_shares',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
  'tiktok:latest_total_views',
  'tiktok:latest_total_likes',
  'tiktok:latest_total_comments',
]);

test('planner reproduces the exact reviewed 86/68/24 and 50-update live boundary', () => {
  const records = reviewedRecords();
  const plan = planLarkDashboardDisplayV2Backfill({ records, fieldNames: FIELD_NAMES });

  assert.equal(records.length, EXPECTED_REPORT_RECORD_COUNT);
  assert.equal(plan.recordCount, EXPECTED_REPORT_RECORD_COUNT);
  assert.equal(plan.targetRecordCount, EXPECTED_DASHBOARD_RECORD_COUNT);
  assert.equal(plan.targetCurrentValueNullCount, EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT);
  assert.equal(plan.populatedDisplayV2Count, 20);
  assert.equal(plan.convergedDisplayV2Count, 18);
  assert.equal(plan.missingValueUpdateCount, EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT);
  assert.equal(plan.reviewedAliasCorrectionCount, EXPECTED_REVIEWED_ALIAS_CORRECTION_COUNT);
  assert.equal(plan.pendingUpdateCount, EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT);
  assert.equal(plan.conflictCount, 0);

  for (const update of plan.updates) {
    assert.deepEqual(Object.keys(update.fields), [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]);
    assert.equal(Object.hasOwn(update.fields, 'current_value'), false);
    assert.equal(TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS.includes(update.metricKey), true);
    assert.equal(TIKTOK_ORGANIC_DASHBOARD_WINDOWS.includes(update.windowDays), true);
  }
  assert.equal(
    plan.updates.filter((update) => update.reason === 'missing_display_v2').length,
    48,
  );
  assert.equal(
    plan.updates.filter((update) => update.reason === 'reviewed_alias_correction').length,
    2,
  );
});

test('planner converges all 68 Dashboard rows after applying only reviewed V2 updates', () => {
  const records = reviewedRecords();
  const initial = planLarkDashboardDisplayV2Backfill({ records, fieldNames: FIELD_NAMES });
  const byId = new Map(records.map((record) => [record.recordId, structuredClone(record)]));
  for (const update of initial.updates) {
    Object.assign(byId.get(update.recordId).fields, update.fields);
  }
  const finalPlan = planLarkDashboardDisplayV2Backfill({
    records: [...byId.values()],
    fieldNames: FIELD_NAMES,
  });
  assert.equal(finalPlan.targetRecordCount, 68);
  assert.equal(finalPlan.populatedDisplayV2Count, 68);
  assert.equal(finalPlan.convergedDisplayV2Count, 68);
  assert.equal(finalPlan.pendingUpdateCount, 0);
  assert.equal(finalPlan.conflictCount, 0);
  assert.equal(finalPlan.targetCurrentValueNullCount, 24);
});

test('planner fails closed for unexpected populated V2 values and incomplete metric-window matrix', () => {
  const wrong = reviewedRecords();
  const blank = wrong.find((record) => (
    record.fields.window_days === 1
    && record.fields.metric_key === 'tiktok:period_views'
  ));
  blank.fields[LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName] = 'Wrong label';
  const wrongPlan = planLarkDashboardDisplayV2Backfill({
    records: wrong,
    fieldNames: FIELD_NAMES,
  });
  assert.equal(wrongPlan.conflictCount, 1);
  assert.equal(wrongPlan.conflicts[0].reason, 'unexpected_populated_display_v2');

  const incomplete = reviewedRecords().filter((record) => record.recordId !== 'target-1-0');
  const incompletePlan = planLarkDashboardDisplayV2Backfill({
    records: incomplete,
    fieldNames: FIELD_NAMES,
  });
  assert.equal(incompletePlan.targetRecordCount, 67);
  assert.equal(
    incompletePlan.conflicts.some((conflict) => conflict.reason === 'missing_dashboard_metric_window'),
    true,
  );
});

test('field option guard requires every reviewed Dashboard label and rejects duplicate options', () => {
  const validField = {
    property: {
      options: [
        ...TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS.map((name, index) => ({
          id: `opt-${index}`,
          name,
        })),
        { id: 'opt-extra', name: 'Retained unrelated option' },
      ],
    },
  };
  assert.equal(
    assertLarkDashboardDisplayV2Options(validField).includes('Baseline Coverage Rate'),
    true,
  );

  assert.throws(
    () => assertLarkDashboardDisplayV2Options({
      property: {
        options: validField.property.options.filter((option) => option.name !== 'Views'),
      },
    }),
    (error) => error.code === 'LARK_DASHBOARD_DISPLAY_V2_OPTIONS_INVALID',
  );
  assert.throws(
    () => assertLarkDashboardDisplayV2Options({
      property: {
        options: [...validField.property.options, { id: 'duplicate', name: 'Views' }],
      },
    }),
    (error) => error.code === 'LARK_DASHBOARD_DISPLAY_V2_OPTIONS_INVALID',
  );
});

test('execution confirmation is exact and failure declares zero unrelated mutation', () => {
  assert.equal(
    assertLarkDashboardDisplayV2BackfillConfirmation(
      LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION,
    ),
    true,
  );
  assert.throws(
    () => assertLarkDashboardDisplayV2BackfillConfirmation('wrong'),
    (error) => {
      assert.equal(error.code, 'LARK_DASHBOARD_DISPLAY_V2_BACKFILL_CONFIRMATION_REQUIRED');
      assert.equal(error.details.dashboardPatchCount, 0);
      assert.equal(error.details.fieldMutationCount, 0);
      assert.equal(error.details.currentValueMutationCount, 0);
      assert.equal(error.details.recordDeleteCount, 0);
      assert.equal(error.details.remoteMutationCount, 0);
      return true;
    },
  );
});

test('operator exposes Record update only and uses the Shared batch progress callback shape', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-dashboard-display-v2-compatibility-backfill.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /batchUpdateRecords\(/u);
  assert.match(source, /chunk\.chunks/u);
  assert.match(source, /chunk\.rows/u);
  assert.doesNotMatch(source, /chunk\.records/u);
  assert.doesNotMatch(source, /chunk\.totalChunks/u);
  assert.doesNotMatch(source, /\/dashboards/u);
  assert.doesNotMatch(source, /updateField\(/u);
  assert.doesNotMatch(source, /deleteField\(/u);
  assert.doesNotMatch(source, /batchCreateRecords\(/u);
  assert.doesNotMatch(source, /deleteRecords?\(/u);
  assert.match(source, /currentValueMutationCount:\s*0/u);
  assert.match(source, /fieldMutationCount:\s*0/u);
  assert.match(source, /dashboardPatchCount:\s*0/u);
});

function reviewedRecords() {
  const records = [];
  let targetIndex = 0;
  for (const windowDays of TIKTOK_ORGANIC_DASHBOARD_WINDOWS) {
    for (let metricIndex = 0; metricIndex < TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS.length; metricIndex += 1) {
      const metricKey = TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS[metricIndex];
      let displayV2 = null;
      if ([3, 7].includes(windowDays) && PREPOPULATED_CORRECT_KEYS.includes(metricKey)) {
        displayV2 = TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY[metricKey];
      }
      if ([3, 7].includes(windowDays) && metricKey === 'tiktok:baseline_coverage_rate') {
        displayV2 = 'Baseline coverage';
      }
      records.push({
        recordId: `target-${windowDays}-${metricIndex}`,
        fields: {
          metric_key: metricKey,
          window_days: windowDays,
          __mkt_legacy_window_days_single_select_v1: String(windowDays),
          [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]: displayV2,
          current_value: targetIndex < 24 ? null : targetIndex,
          report_type: 'dashboard_performance_report',
          platform: 'tiktok',
          capability: 'organic',
          period_kind: 'rolling_days',
          customer_profile: 'integration_workspace',
          customer_key: 'chemistry_k',
          account_id: 'chemistry_k',
        },
      });
      targetIndex += 1;
    }
  }
  for (let index = 0; index < 18; index += 1) {
    records.push({
      recordId: `non-target-${index}`,
      fields: {
        metric_key: `tiktok:non_target_${index}`,
        window_days: null,
        __mkt_legacy_window_days_single_select_v1: null,
        [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]: null,
        current_value: index,
        report_type: index % 2 === 0 ? 'daily_organic_report' : 'dashboard_performance_report',
        platform: index % 2 === 0 ? 'tiktok' : 'youtube',
        capability: 'organic',
        period_kind: 'custom_range',
        customer_profile: 'integration_workspace',
        customer_key: 'chemistry_k',
        account_id: 'chemistry_k',
      },
    });
  }
  return records;
}
