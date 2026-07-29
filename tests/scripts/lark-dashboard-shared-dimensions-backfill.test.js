import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION,
  assertBackfillVerificationComplete,
  assertBoundedMaterializationRows,
  assertLarkDashboardSharedDimensionsBackfillConfirmation,
  buildLarkDashboardSharedDimensionsBackfillSql,
  createBackfillAllowedFieldsByTableId,
  createInMemoryReportMaterializationD1,
  createLarkDashboardSharedDimensionsBackfillPlanner,
  parseLarkDashboardSharedDimensionsBackfillArgs,
  parseWranglerD1Rows,
} from '../../scripts/lib/lark-dashboard-shared-dimensions-backfill.js';

test('backfill arguments and exact Apply confirmation fail closed', () => {
  assert.deepEqual(parseLarkDashboardSharedDimensionsBackfillArgs([]), {
    apply: false,
    help: false,
  });
  assert.deepEqual(parseLarkDashboardSharedDimensionsBackfillArgs(['--apply']), {
    apply: true,
    help: false,
  });
  assert.throws(
    () => parseLarkDashboardSharedDimensionsBackfillArgs(['--force']),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_ARGUMENT_INVALID',
  );
  assert.equal(assertLarkDashboardSharedDimensionsBackfillConfirmation({}, false), true);
  assert.throws(
    () => assertLarkDashboardSharedDimensionsBackfillConfirmation({ CONFIRM_WRITE: 'YES' }, true),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkDashboardSharedDimensionsBackfillConfirmation({
    CONFIRM_WRITE: 'YES',
    CONFIRM_LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL:
      LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION,
  }, true), true);
});

test('D1 query is Organic, customer-scoped and bounded with one overflow row', () => {
  const result = buildLarkDashboardSharedDimensionsBackfillSql({
    customerKey: 'chemistry_k',
    maximumRows: 27,
  });
  assert.equal(result.maximumRows, 27);
  assert.match(result.sql, /customer_key = 'chemistry_k'/u);
  assert.match(result.sql, /report_type = 'dashboard_performance_report'/u);
  assert.match(result.sql, /'facebook', 'instagram', 'tiktok', 'youtube'/u);
  assert.match(result.sql, /LIMIT 28/u);
  assert.throws(
    () => buildLarkDashboardSharedDimensionsBackfillSql({ customerKey: "bad'key" }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_INPUT_INVALID',
  );
});

test('Wrangler D1 JSON parser accepts canonical result envelopes and rejects failure', () => {
  assert.deepEqual(parseWranglerD1Rows(JSON.stringify([{
    success: true,
    results: [{ report_id: 'r1' }, { report_id: 'r2' }],
  }])), [{ report_id: 'r1' }, { report_id: 'r2' }]);
  assert.deepEqual(parseWranglerD1Rows(JSON.stringify({
    success: true,
    result: [{ results: [{ report_id: 'r3' }] }],
  })), [{ report_id: 'r3' }]);
  assert.throws(
    () => parseWranglerD1Rows(JSON.stringify([{ success: false }])),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_D1_QUERY_FAILED',
  );
});

test('materialization row bound and in-memory D1 reader identity are deterministic', async () => {
  const rows = [{ report_id: 'report-1', payload_json: '{}' }];
  assert.equal(assertBoundedMaterializationRows(rows, 1).length, 1);
  assert.throws(
    () => assertBoundedMaterializationRows([...rows, { report_id: 'report-2' }], 1),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_ROW_BOUND_EXCEEDED',
  );
  const d1 = createInMemoryReportMaterializationD1(rows);
  const found = await d1
    .prepare('SELECT * FROM report_materializations WHERE report_id = ?')
    .bind('report-1')
    .first();
  assert.equal(found.report_id, 'report-1');
  assert.equal(await d1
    .prepare('SELECT * FROM report_materializations WHERE report_id = ?')
    .bind('missing')
    .first(), null);
});

test('backfill planner sends only approved additive fields and preserves null versus zero', async () => {
  const observedRows = [];
  const executed = [];
  const baseEngine = {
    async planByKey(input) {
      observedRows.push(...input.rows);
      return {
        tableId: input.tableId,
        createRows: [],
        updateRows: input.rows.map((fields, index) => ({ recordId: `rec-${index}`, fields })),
        skipped: 0,
      };
    },
    async executePlan(plan) {
      executed.push(plan);
      return { created: 0, updated: plan.updateRows.length, skipped: plan.skipped };
    },
  };
  const planner = createLarkDashboardSharedDimensionsBackfillPlanner({
    baseEngine,
    allowedFieldsByTableId: {
      metrics: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
    },
  });
  const plan = await planner.syncEngine.planByKey({
    repository: {},
    tableId: 'metrics',
    keyField: 'report_metric_key',
    rows: [{
      report_metric_key: 'report::views',
      customer_key: 'chemistry_k',
      capability: 'organic',
      period_kind: 'custom_range',
      window_days: null,
      coverage_rate: 0,
      current_value: 999,
      source_snapshot_count: 123,
    }],
  });
  await planner.syncEngine.executePlan(plan);
  assert.deepEqual(observedRows, [{
    report_metric_key: 'report::views',
    customer_key: 'chemistry_k',
    capability: 'organic',
    period_kind: 'custom_range',
    window_days: null,
    coverage_rate: 0,
  }]);
  assert.equal(executed.length, 0, 'planning must not write');
  assert.deepEqual(planner.summarize(), {
    planCount: 1,
    createRows: 0,
    updateRows: 1,
    skippedRows: 0,
    tables: [{
      tableId: 'metrics',
      plans: 1,
      createRows: 0,
      updateRows: 1,
      skippedRows: 0,
    }],
  });
  const result = await planner.executeAll();
  assert.equal(result.results[0].result.updated, 1);
  assert.equal(executed.length, 1);
});

test('backfill blocks missing destination rows before any Apply execution', async () => {
  let executeCount = 0;
  const planner = createLarkDashboardSharedDimensionsBackfillPlanner({
    baseEngine: {
      async planByKey(input) {
        return {
          tableId: input.tableId,
          createRows: input.rows,
          updateRows: [],
          skipped: 0,
        };
      },
      async executePlan() {
        executeCount += 1;
        return { created: 1, updated: 0, skipped: 0 };
      },
    },
    allowedFieldsByTableId: { snapshots: ['customer_key', 'capability', 'coverage_rate'] },
  });
  const plan = await planner.syncEngine.planByKey({
    repository: {},
    tableId: 'snapshots',
    keyField: 'report_id',
    rows: [{
      report_id: 'report-1',
      customer_key: 'chemistry_k',
      capability: 'organic',
      coverage_rate: null,
    }],
  });
  await planner.syncEngine.executePlan(plan);
  assert.throws(
    () => planner.assertSafeToApply(),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_CREATE_BLOCKED',
  );
  await assert.rejects(
    () => planner.executeAll(),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_CREATE_BLOCKED',
  );
  assert.equal(executeCount, 0);
});

test('table mapping and post-Apply zero-drift verification are exact', () => {
  assert.deepEqual(createBackfillAllowedFieldsByTableId({
    mktReportSnapshots: 'snapshots',
    mktReportMetricValues: 'metrics',
    mktReportTopContent: 'content',
    mktReportTopAds: 'ads',
  }), {
    snapshots: ['customer_key', 'capability', 'coverage_rate'],
    metrics: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
    content: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
    ads: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
  });
  assert.equal(assertBackfillVerificationComplete({ createRows: 0, updateRows: 0 }), true);
  assert.throws(
    () => assertBackfillVerificationComplete({ createRows: 0, updateRows: 1 }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED',
  );
});
