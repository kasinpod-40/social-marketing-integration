import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS,
  LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS,
} from '../../packages/config/src/lark-native-ai-all-channel-contract.js';
import {
  LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS,
  LARK_NATIVE_AI_REUSED_FIELDS,
} from '../../packages/config/src/lark-native-ai-schema-preview.js';
import {
  buildLarkNativeAiControlledPreviewReadiness,
} from '../../packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js';
import {
  buildLarkNativeAiSchemaViewFilter,
} from '../../packages/application/src/reports/lark-native-ai-schema-view-filters.js';
import {
  collectLarkNativeAiControlledPreviewRealSource,
  createLarkNativeAiControlledPreviewSourceReadGuard,
} from '../../scripts/lib/collect-lark-native-ai-controlled-preview-real-source.js';
import {
  buildLarkNativeAiControlledPreviewExactTerminalReadiness,
  validateLarkNativeAiControlledPreviewSourcePackage,
} from '../../scripts/lib/lark-native-ai-controlled-preview-exact-terminal.js';

const HEAD = 'a'.repeat(40);
const NOW = Date.parse('2026-08-03T08:00:00Z');
const AI_TABLE_ID = 'tbl_ai_report_runs';
const SNAPSHOT_TABLE_ID = 'tbl_report_snapshots';
const METRIC_TABLE_ID = 'tbl_report_metrics';

test('collector output passes the real four-window readiness stack', async () => {
  const client = buildClient();
  const sourceGuard = Object.freeze({
    snapshot: () => Object.freeze({
      tokenRequestCount: 1,
      tableReadRequestCount: 1,
      fieldReadRequestCount: 2,
      viewListRequestCount: 2,
      viewReadRequestCount: 6,
      recordSearchRequestCount: 2,
      blockedRequestCount: 0,
      totalRequests: 14,
    }),
  });
  const repository = { branch: 'main', clean: true, exactHeadSha: HEAD };
  const collected = await collectLarkNativeAiControlledPreviewRealSource({
    client,
    sourceGuard,
    repository,
    env: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_REPORT_AI_SUMMARY_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: SNAPSHOT_TABLE_ID,
      LARK_TABLE_MKT_REPORT_METRIC_VALUES: METRIC_TABLE_ID,
    },
    generatedAt: NOW,
  });

  assert.equal(collected.repositoryHead, HEAD);
  assert.match(collected.packageSha256, /^[a-f0-9]{64}$/u);
  assert.equal(collected.provenance.source, 'live_lark_report_outputs');
  assert.equal(collected.provenance.fixtureData, false);
  assert.equal(collected.schemaAuthority.status, 'zero_drift');
  assert.equal(collected.schemaAuthority.exactViewFilterCount, 6);
  assert.equal(collected.remoteAuthority.authorityMode, 'isolated_lark_ai_table_only');
  assert.deepEqual(collected.offlineInputs.map(({ window }) => window.windowDays), [1, 3, 7, 30]);
  for (const offlineInput of collected.offlineInputs) {
    assert.equal(offlineInput.channels.length, 10);
    const tiktok = offlineInput.channels.find(({ platform }) => platform === 'tiktok');
    assert.equal(tiktok.availabilityStatus, 'complete');
    assert.equal(tiktok.report.metricValues.length, 2);
    assert.equal(tiktok.report.validationStatus, 'validated');
    assert.equal(tiktok.report.freshness.status, 'fresh');
    const tiktokAds = offlineInput.channels.find(({ platform }) => platform === 'tiktok_ads');
    assert.equal(tiktokAds.availabilityStatus, 'unavailable');
  }

  const validated = await validateLarkNativeAiControlledPreviewSourcePackage(
    collected,
    repository,
  );
  const plans = await buildLarkNativeAiControlledPreviewExactTerminalReadiness({
    sourcePackage: validated,
    repository,
    buildReadiness: async (input) => {
      const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
      assert.equal(
        plan.status,
        'ready_for_controlled_preview',
        `window=${input.offlineInput.window.windowDays} blockers=${JSON.stringify(plan.blockers)}`,
      );
      assert.equal(
        plan.blockers.length,
        0,
        `window=${input.offlineInput.window.windowDays} blockers=${JSON.stringify(plan.blockers)}`,
      );
      return plan;
    },
  });
  assert.equal(plans.length, 4);
  assert.deepEqual(plans.map(({ status }) => status), [
    'ready_for_controlled_preview',
    'ready_for_controlled_preview',
    'ready_for_controlled_preview',
    'ready_for_controlled_preview',
  ]);
  assert.deepEqual(plans.map(({ runIdentity }) => runIdentity.windowDays), [1, 3, 7, 30]);
  for (const plan of plans) {
    assert.equal(plan.blockers.length, 0);
    assert.equal(plan.schemaAuthority.status, 'zero_drift');
    assert.equal(plan.remoteAuthority.metaRemoteLockReleased, true);
    assert.equal(plan.goldenDataset.platform, 'tiktok');
    assert.equal(plan.goldenDataset.complete, true);
    assert.equal(plan.goldenDataset.fresh, true);
  }
});

test('source read guard allows only reviewed metadata and record reads', async () => {
  const requests = [];
  const guard = createLarkNativeAiControlledPreviewSourceReadGuard(async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  await guard.fetchImpl('https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
  });
  await guard.fetchImpl('https://open.larksuite.com/open-apis/bitable/v1/apps/app/tables?page_size=500', {
    method: 'GET',
  });
  await guard.fetchImpl('https://open.larksuite.com/open-apis/bitable/v1/apps/app/tables/tbl/records/search?page_size=500', {
    method: 'POST',
  });
  assert.equal(requests.length, 3);
  assert.equal(guard.snapshot().blockedRequestCount, 0);
  await assert.rejects(
    () => guard.fetchImpl('https://open.larksuite.com/open-apis/bitable/v1/apps/app/tables/tbl/records/batch_create', {
      method: 'POST',
    }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_READ_REQUEST_BLOCKED',
  );
  assert.equal(guard.snapshot().blockedRequestCount, 1);
});

function buildClient() {
  const fields = buildSchemaFields();
  const views = LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS.map((contract, index) => ({
    viewId: `vew_${index + 1}`,
    viewName: contract.viewName,
    viewType: 'grid',
  }));
  const viewById = new Map(views.map((view, index) => {
    const expected = buildLarkNativeAiSchemaViewFilter(
      LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS[index],
      fields,
    );
    return [view.viewId, {
      ...view,
      property: { filterInfo: expected?.mutation ?? null },
    }];
  }));
  const snapshots = buildSnapshots();
  const metrics = buildMetrics(snapshots);
  return Object.freeze({
    async listTables() {
      return [
        { tableId: AI_TABLE_ID, name: '🧠 MKT_AI_Report_Runs', revision: 1 },
        { tableId: SNAPSHOT_TABLE_ID, name: 'MKT_Report_Snapshots', revision: 1 },
        { tableId: METRIC_TABLE_ID, name: 'MKT_Report_Metric_Values', revision: 1 },
      ];
    },
    async listFields({ tableId }) {
      assert.equal(tableId, AI_TABLE_ID);
      return fields;
    },
    async listViews({ tableId }) {
      assert.equal(tableId, AI_TABLE_ID);
      return views;
    },
    async getView({ tableId, viewId }) {
      assert.equal(tableId, AI_TABLE_ID);
      return viewById.get(viewId);
    },
    async searchRecordsByFieldValues({ tableId, fieldName, values }) {
      if (tableId === SNAPSHOT_TABLE_ID) {
        assert.equal(fieldName, 'report_setting_key');
        return snapshots.filter(({ fields: row }) => values.includes(row.report_setting_key));
      }
      assert.equal(tableId, METRIC_TABLE_ID);
      assert.equal(fieldName, 'report_id');
      return metrics.filter(({ fields: row }) => values.includes(row.report_id));
    },
  });
}

function buildSchemaFields() {
  const byName = new Map();
  for (const field of LARK_NATIVE_AI_REUSED_FIELDS) byName.set(field.fieldName, {
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    options: [],
  });
  for (const field of LARK_AI_REPORT_RUNS_ADDITIVE_FIELDS) byName.set(field.fieldName, {
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    options: [...(field.options ?? [])],
  });
  for (const [fieldName, options] of Object.entries(LARK_AI_REPORT_RUNS_OPTION_EXTENSIONS)) {
    const field = byName.get(fieldName);
    field.options = [...new Set([...(field.options ?? []), ...options])];
  }
  return [...byName.values()].map((field, index) => {
    const type = ({ Text: 1, Number: 2, SingleSelect: 3, MultiSelect: 4, DateTime: 5, Checkbox: 7 })[field.fieldType];
    const options = field.options.map((name, optionIndex) => ({
      id: `opt_${index}_${optionIndex}`,
      name,
    }));
    return {
      fieldId: `fld_${index + 1}`,
      fieldName: field.fieldName,
      type,
      uiType: field.fieldType,
      property: options.length > 0 ? { options } : {},
    };
  });
}

function buildSnapshots() {
  return [1, 3, 7, 30].map((windowDays, index) => {
    const reportId = `dashboard_performance_report::integration_workspace::chemistry_k::2026-07-${String(31 - windowDays + 1).padStart(2, '0')}::2026-07-31::previous_period::tiktok::${windowDays}d`;
    return {
      recordId: `rec_snapshot_${windowDays}`,
      fields: {
        report_id: reportId,
        report_setting_key: `integration_workspace:tiktok:rolling:${windowDays}d`,
        customer_profile: 'integration_workspace',
        account_id: 'chemistry_k',
        report_type: 'dashboard_performance_report',
        period_kind: 'rolling_days',
        window_days: windowDays,
        period_start: Date.parse(`2026-07-${String(Math.max(1, 32 - windowDays)).padStart(2, '0')}T00:00:00+07:00`),
        period_end: Date.parse('2026-07-31T00:00:00+07:00'),
        compare_start: Date.parse('2026-06-01T00:00:00+07:00'),
        compare_end: Date.parse('2026-06-30T00:00:00+07:00'),
        comparison_mode: 'previous_period',
        platform: ['tiktok'],
        metric_payload_json: JSON.stringify({ views: 100 + index, likes: 10 + index }),
        top_content_json: '[]',
        top_ads_json: '[]',
        generated_at: NOW - 60_000 - index,
        data_status: 'complete',
        formula_version: 'tiktok-organic-v1',
      },
    };
  });
}

function buildMetrics(snapshots) {
  return snapshots.flatMap(({ fields }, snapshotIndex) => [
    metric(fields.report_id, snapshotIndex, 1, 'views', 100 + snapshotIndex, 90),
    metric(fields.report_id, snapshotIndex, 2, 'likes', 10 + snapshotIndex, 9),
  ]);
}

function metric(reportId, snapshotIndex, rank, metricKey, current, compare) {
  return {
    recordId: `rec_metric_${snapshotIndex}_${rank}`,
    fields: {
      report_metric_key: `${reportId}::${metricKey}::summary::all`,
      report_id: reportId,
      metric_key: metricKey,
      display_name: metricKey === 'views' ? 'Views' : 'Likes',
      current_value: current,
      compare_value: compare,
      change_value: current - compare,
      change_percent: ((current - compare) / compare) * 100,
      unit: 'count',
      availability_status: 'available',
      availability_message: 'Available',
      metric_scope: 'current',
      dimension_type: 'summary',
      dimension_value: 'all',
      rank,
      coverage_rate: 1,
    },
  };
}
