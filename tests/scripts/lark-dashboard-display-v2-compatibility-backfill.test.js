import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX,
  ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS,
  ORGANIC_DASHBOARD_METRIC_SUFFIXES,
  ORGANIC_DASHBOARD_PLATFORMS,
  ORGANIC_DASHBOARD_WINDOWS,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';
import {
  EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT,
  EXPECTED_DASHBOARD_RECORD_COUNT,
  EXPECTED_INITIAL_CONVERGED_DISPLAY_V2_COUNT,
  EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT,
  EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT,
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

const REVIEWED_NULL_COUNTS = Object.freeze({
  facebook: 52,
  instagram: 24,
  tiktok: 24,
  youtube: 40,
});

test('planner reproduces the reviewed 1,254-row Base while targeting only exact 272 Organic Dashboard rows', () => {
  const records = reviewedRecords({ unrelatedCount: 982 });
  const plan = planLarkDashboardDisplayV2Backfill({ records, fieldNames: FIELD_NAMES });

  assert.equal(records.length, 1_254);
  assert.equal(plan.recordCount, 1_254);
  assert.equal(plan.targetRecordCount, EXPECTED_DASHBOARD_RECORD_COUNT);
  assert.equal(plan.targetCurrentValueNullCount, EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT);
  assert.equal(plan.populatedDisplayV2Count, EXPECTED_INITIAL_CONVERGED_DISPLAY_V2_COUNT);
  assert.equal(plan.convergedDisplayV2Count, EXPECTED_INITIAL_CONVERGED_DISPLAY_V2_COUNT);
  assert.equal(plan.missingValueUpdateCount, EXPECTED_MISSING_DISPLAY_V2_UPDATE_COUNT);
  assert.equal(plan.reviewedAliasCorrectionCount, EXPECTED_REVIEWED_ALIAS_CORRECTION_COUNT);
  assert.equal(plan.pendingUpdateCount, EXPECTED_PENDING_DISPLAY_V2_UPDATE_COUNT);
  assert.equal(plan.conflictCount, 0);

  assert.deepEqual(plan.platformCounts.facebook, {
    target: 68,
    populated: 0,
    converged: 0,
    pending: 68,
    currentValueNull: 52,
  });
  assert.deepEqual(plan.platformCounts.instagram, {
    target: 68,
    populated: 0,
    converged: 0,
    pending: 68,
    currentValueNull: 24,
  });
  assert.deepEqual(plan.platformCounts.tiktok, {
    target: 68,
    populated: 68,
    converged: 68,
    pending: 0,
    currentValueNull: 24,
  });
  assert.deepEqual(plan.platformCounts.youtube, {
    target: 68,
    populated: 0,
    converged: 0,
    pending: 68,
    currentValueNull: 40,
  });

  for (const update of plan.updates) {
    assert.deepEqual(Object.keys(update.fields), [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]);
    assert.equal(Object.hasOwn(update.fields, 'current_value'), false);
    assert.equal(ORGANIC_DASHBOARD_PLATFORMS.includes(update.platform), true);
    assert.equal(ORGANIC_DASHBOARD_WINDOWS.includes(update.windowDays), true);
  }
});

test('planner converges all 272 target rows after applying only the reviewed 204 Display V2 cells', () => {
  const records = reviewedRecords({ unrelatedCount: 982 });
  const initial = planLarkDashboardDisplayV2Backfill({ records, fieldNames: FIELD_NAMES });
  const byId = new Map(records.map((record) => [record.recordId, structuredClone(record)]));
  for (const update of initial.updates) Object.assign(byId.get(update.recordId).fields, update.fields);

  const finalPlan = planLarkDashboardDisplayV2Backfill({
    records: [...byId.values()],
    fieldNames: FIELD_NAMES,
  });
  assert.equal(finalPlan.recordCount, 1_254);
  assert.equal(finalPlan.targetRecordCount, 272);
  assert.equal(finalPlan.populatedDisplayV2Count, 272);
  assert.equal(finalPlan.convergedDisplayV2Count, 272);
  assert.equal(finalPlan.pendingUpdateCount, 0);
  assert.equal(finalPlan.conflictCount, 0);
  assert.equal(finalPlan.targetCurrentValueNullCount, 140);
});

test('planner ignores non-Dashboard Organic metrics but fails closed on duplicate, missing or wrong target cells', () => {
  const withExtraOrganic = reviewedRecords({ unrelatedCount: 10 });
  withExtraOrganic.push({
    recordId: 'organic-extra-account-metric',
    fields: targetFields({
      platform: 'facebook',
      metricKey: 'facebook:account_followers',
      windowDays: 7,
      displayV2: null,
      currentValue: 123,
    }),
  });
  const extraPlan = planLarkDashboardDisplayV2Backfill({
    records: withExtraOrganic,
    fieldNames: FIELD_NAMES,
  });
  assert.equal(extraPlan.targetRecordCount, 272);
  assert.equal(extraPlan.conflictCount, 0);

  const wrong = reviewedRecords();
  const wrongRow = wrong.find((record) => (
    record.fields.platform === 'facebook'
    && record.fields.window_days === 1
    && record.fields.metric_key === 'facebook:period_views'
  ));
  wrongRow.fields[LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName] = 'Wrong label';
  const wrongPlan = planLarkDashboardDisplayV2Backfill({ records: wrong, fieldNames: FIELD_NAMES });
  assert.equal(
    wrongPlan.conflicts.some((conflict) => conflict.reason === 'unexpected_populated_display_v2'),
    true,
  );

  const incomplete = reviewedRecords().filter((record) => record.recordId !== 'facebook-1-period_views');
  const incompletePlan = planLarkDashboardDisplayV2Backfill({
    records: incomplete,
    fieldNames: FIELD_NAMES,
  });
  assert.equal(incompletePlan.targetRecordCount, 271);
  assert.equal(
    incompletePlan.conflicts.some((conflict) => conflict.reason === 'missing_dashboard_metric_window'),
    true,
  );

  const duplicate = reviewedRecords();
  duplicate.push(structuredClone(duplicate[0]));
  duplicate.at(-1).recordId = 'duplicate-target';
  const duplicatePlan = planLarkDashboardDisplayV2Backfill({
    records: duplicate,
    fieldNames: FIELD_NAMES,
  });
  assert.equal(
    duplicatePlan.conflicts.some((conflict) => conflict.reason === 'duplicate_dashboard_metric_window'),
    true,
  );
});

test('total unrelated business-table growth is not an admission contract', () => {
  const records = reviewedRecords({ unrelatedCount: 3_000 });
  const plan = planLarkDashboardDisplayV2Backfill({ records, fieldNames: FIELD_NAMES });
  assert.equal(records.length, 3_272);
  assert.equal(plan.targetRecordCount, 272);
  assert.equal(plan.pendingUpdateCount, 204);
  assert.equal(plan.conflictCount, 0);
});

test('field option guard requires every reviewed Organic Dashboard label exactly once', () => {
  const validField = {
    property: {
      options: [
        ...ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS.map((name, index) => ({ id: `opt-${index}`, name })),
        { id: 'opt-extra', name: 'Retained unrelated option' },
      ],
    },
  };
  assert.equal(assertLarkDashboardDisplayV2Options(validField).includes('Views'), true);
  assert.throws(
    () => assertLarkDashboardDisplayV2Options({
      property: { options: validField.property.options.filter((option) => option.name !== 'Views') },
    }),
    (error) => error.code === 'LARK_DASHBOARD_DISPLAY_V2_OPTIONS_INVALID',
  );
  assert.throws(
    () => assertLarkDashboardDisplayV2Options({
      property: { options: [...validField.property.options, { id: 'duplicate', name: 'Views' }] },
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

test('operator remains Record-only and contains no Dashboard or total-row ceiling mutation path', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-dashboard-display-v2-compatibility-backfill.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /batchUpdateRecords\(/u);
  assert.match(source, /chunk\.chunks/u);
  assert.match(source, /chunk\.rows/u);
  assert.doesNotMatch(source, /\/dashboards/u);
  assert.doesNotMatch(source, /updateField\(/u);
  assert.doesNotMatch(source, /deleteField\(/u);
  assert.doesNotMatch(source, /batchCreateRecords\(/u);
  assert.doesNotMatch(source, /deleteRecords?\(/u);
  assert.doesNotMatch(source, /maxRecords|MAX_RECORDS|EXPECTED_REPORT_RECORD_COUNT/u);
  assert.match(source, /currentValueMutationCount:\s*0/u);
  assert.match(source, /fieldMutationCount:\s*0/u);
  assert.match(source, /dashboardPatchCount:\s*0/u);
});

function reviewedRecords({ unrelatedCount = 0 } = {}) {
  const records = [];
  for (const platform of ORGANIC_DASHBOARD_PLATFORMS) {
    let platformTargetIndex = 0;
    for (const windowDays of ORGANIC_DASHBOARD_WINDOWS) {
      for (const metricSuffix of ORGANIC_DASHBOARD_METRIC_SUFFIXES) {
        const displayV2 = platform === 'tiktok'
          ? ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX[metricSuffix]
          : null;
        records.push({
          recordId: `${platform}-${windowDays}-${metricSuffix}`,
          fields: targetFields({
            platform,
            metricKey: `${platform}:${metricSuffix}`,
            windowDays,
            displayV2,
            currentValue: platformTargetIndex < REVIEWED_NULL_COUNTS[platform]
              ? null
              : platformTargetIndex,
          }),
        });
        platformTargetIndex += 1;
      }
    }
  }
  for (let index = 0; index < unrelatedCount; index += 1) {
    records.push({
      recordId: `unrelated-${index}`,
      fields: {
        metric_key: `meta_ads:unrelated_${index}`,
        window_days: [1, 3, 7, 30][index % 4],
        __mkt_legacy_window_days_single_select_v1: String([1, 3, 7, 30][index % 4]),
        [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]: null,
        current_value: index,
        report_type: 'dashboard_performance_report',
        platform: 'meta_ads',
        capability: 'paid_ads',
        period_kind: 'rolling_days',
        customer_profile: 'integration_workspace',
        customer_key: 'chemistry_k',
        account_id: 'chemistry_k',
      },
    });
  }
  return records;
}

function targetFields({ platform, metricKey, windowDays, displayV2, currentValue }) {
  return {
    metric_key: metricKey,
    window_days: windowDays,
    __mkt_legacy_window_days_single_select_v1: String(windowDays),
    [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]: displayV2,
    current_value: currentValue,
    report_type: 'dashboard_performance_report',
    platform,
    capability: 'organic',
    period_kind: 'rolling_days',
    customer_profile: 'integration_workspace',
    customer_key: 'chemistry_k',
    account_id: 'chemistry_k',
  };
}
