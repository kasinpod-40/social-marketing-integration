import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX,
  ORGANIC_DASHBOARD_METRIC_SUFFIXES,
  ORGANIC_DASHBOARD_PLATFORMS,
  ORGANIC_DASHBOARD_WINDOWS,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';
import { planLarkDashboardDisplayV2Backfill } from '../../scripts/lib/lark-dashboard-display-v2-compatibility-v1.js';

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

test('current-slot planner repairs Facebook provider-native account rows without touching business values', () => {
  const records = currentMatrix();
  const plan = planLarkDashboardDisplayV2Backfill({ records, fieldNames: FIELD_NAMES });
  assert.equal(plan.targetRecordCount, 272);
  assert.equal(plan.conflictCount, 0);
  assert.equal(plan.platformCounts.facebook.target, 68);
  assert.equal(plan.platformCounts.facebook.pending, 68);
  assert.equal(plan.platformCounts.tiktok.pending, 0);
  assert.equal(plan.pendingUpdateCount, 204);
  for (const update of plan.updates) {
    assert.deepEqual(Object.keys(update.fields), [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]);
    assert.equal(Object.hasOwn(update.fields, 'current_value'), false);
  }
});

test('current-slot repair operator is Record-only and never creates/deletes Report rows', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-organic-display-v2-current-slot-repair.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /batchUpdateRecords\(/u);
  assert.doesNotMatch(source, /batchCreateRecords\(/u);
  assert.doesNotMatch(source, /batch_delete|deleteRecords?\(/u);
  assert.doesNotMatch(source, /\/dashboards/u);
  assert.match(source, /currentValueMutationCount:\s*0/u);
  assert.match(source, /recordCreateCount:\s*0/u);
  assert.match(source, /recordDeleteCount:\s*0/u);
  assert.match(source, /queueSendCount:\s*0/u);
});

function currentMatrix() {
  const accountIds = Object.freeze({
    facebook: '1144655862068079',
    instagram: '27863086069952218',
    tiktok: 'chemistry_k',
    youtube: 'UC_provider_native_channel',
  });
  const records = [];
  for (const platform of ORGANIC_DASHBOARD_PLATFORMS) {
    for (const windowDays of ORGANIC_DASHBOARD_WINDOWS) {
      for (const [index, metricSuffix] of ORGANIC_DASHBOARD_METRIC_SUFFIXES.entries()) {
        records.push({
          recordId: `${platform}-${windowDays}-${metricSuffix}`,
          fields: {
            metric_key: `${platform}:${metricSuffix}`,
            window_days: windowDays,
            __mkt_legacy_window_days_single_select_v1: String(windowDays),
            [LARK_DASHBOARD_DISPLAY_V2_FIELD.fieldName]: platform === 'tiktok'
              ? ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX[metricSuffix]
              : null,
            current_value: index,
            report_type: 'dashboard_performance_report',
            platform,
            capability: 'organic',
            period_kind: 'rolling_days',
            customer_profile: 'integration_workspace',
            customer_key: 'chemistry_k',
            account_id: accountIds[platform],
          },
        });
      }
    }
  }
  return records;
}
