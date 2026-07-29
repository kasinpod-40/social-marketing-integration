import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_BACKFILL_VERIFICATION_DELAYS_MS,
  LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION,
  assertBackfillVerificationComplete,
  assertBoundedMaterializationRows,
  assertLarkDashboardSharedDimensionsBackfillConfirmation,
  buildLarkDashboardSharedDimensionsBackfillSql,
  createBackfillAllowedFieldsByTableId,
  createBackfillLogicalTableKeysByTableId,
  createInMemoryReportMaterializationD1,
  createLarkDashboardSharedDimensionsBackfillPlanner,
  parseLarkDashboardSharedDimensionsBackfillArgs,
  parseWranglerD1Rows,
  verifyBackfillPostApply,
} from '../../scripts/lib/lark-dashboard-shared-dimensions-backfill.js';
import {
  normalizeExistingRecordsForComparison,
  serializeRowsForLark,
} from '../../packages/connectors/src/lark/lark-field-serializer.js';
import {
  TableSyncEngine,
  hasChangedFields,
} from '../../packages/sync-engine/src/table-sync-engine.js';

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
        existingReadStrategy: 'filtered_keys',
        changedFieldCounts: {
          customer_key: 1,
          capability: 1,
          period_kind: 1,
          coverage_rate: 1,
        },
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
    logicalTableKeysByTableId: {
      metrics: 'mktReportMetricValues',
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
      logicalTableKey: 'mktReportMetricValues',
      plans: 1,
      createRows: 0,
      updateRows: 1,
      skippedRows: 0,
    }],
    pendingFieldNameCounts: {
      capability: 1,
      coverage_rate: 1,
      customer_key: 1,
      period_kind: 1,
    },
    readStrategies: ['filtered_keys'],
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
          existingReadStrategy: 'filtered_keys',
          changedFieldCounts: {},
        };
      },
      async executePlan() {
        executeCount += 1;
        return { created: 1, updated: 0, skipped: 0 };
      },
    },
    allowedFieldsByTableId: { snapshots: ['customer_key', 'capability', 'coverage_rate'] },
    logicalTableKeysByTableId: { snapshots: 'mktReportSnapshots' },
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
  assert.deepEqual(createBackfillLogicalTableKeysByTableId({
    mktReportSnapshots: 'snapshots',
    mktReportMetricValues: 'metrics',
    mktReportTopContent: 'content',
    mktReportTopAds: 'ads',
  }), {
    snapshots: 'mktReportSnapshots',
    metrics: 'mktReportMetricValues',
    content: 'mktReportTopContent',
    ads: 'mktReportTopAds',
  });
  assert.equal(assertBackfillVerificationComplete({ createRows: 0, updateRows: 0 }), true);
  assert.throws(
    () => assertBackfillVerificationComplete({ createRows: 0, updateRows: 1 }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED',
  );
});

test('post-Apply verification resolves eventual consistency with fresh read attempts and no write retry', async () => {
  let clock = 0;
  let readAttempts = 0;
  let writeAttempts = 0;
  const sleeps = [];
  const rows = Array.from({ length: 32 }, (_value, index) => ({
    report_metric_key: `report::${index}`,
    coverage_rate: 0,
  }));
  const repository = {
    async prepareRows(_tableId, values) {
      return values;
    },
    async listByFieldValues() {
      readAttempts += 1;
      return rows.map((row, index) => ({
        recordId: `rec-${index}`,
        fields: {
          report_metric_key: row.report_metric_key,
          coverage_rate: readAttempts === 1 ? null : 0,
        },
      }));
    },
    async createMany() {
      writeAttempts += 1;
      return { created: 0 };
    },
    async updateMany() {
      writeAttempts += 1;
      return { updated: 0 };
    },
  };
  const baseEngine = new TableSyncEngine();

  const result = await verifyBackfillPostApply({
    planAttempt: async () => {
      const planner = createLarkDashboardSharedDimensionsBackfillPlanner({
        baseEngine,
        allowedFieldsByTableId: { metrics: ['coverage_rate'] },
        logicalTableKeysByTableId: { metrics: 'mktReportMetricValues' },
      });
      const plan = await planner.syncEngine.planByKey({
        repository,
        tableId: 'metrics',
        keyField: 'report_metric_key',
        rows,
      });
      await planner.syncEngine.executePlan(plan);
      return planner.summarize();
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
  });

  assert.equal(writeAttempts, 0);
  assert.equal(readAttempts, 2);
  assert.deepEqual(sleeps, [1_000]);
  assert.deepEqual(result, {
    attempts: 2,
    elapsedMs: 1_000,
    final: { createRows: 0, updateRows: 0, skippedRows: 32 },
    pendingRowsByLogicalTable: [],
    pendingFieldNameCounts: {},
    readStrategy: 'filtered_keys',
  });
});

test('persistent post-Apply mismatch is bounded and fails with sanitized diagnostics', async () => {
  let clock = 0;
  let attempts = 0;
  const summary = verificationSummary({
    updateRows: 32,
    skippedRows: 0,
    pendingFieldNameCounts: {
      capability: 8,
      coverage_rate: 24,
    },
  });

  await assert.rejects(
    () => verifyBackfillPostApply({
      planAttempt: async () => {
        attempts += 1;
        return summary;
      },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      now: () => clock,
    }),
    (error) => {
      assert.equal(error.code, 'LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED');
      assert.deepEqual(error.details, {
        attempts: 5,
        elapsedMs: 15_000,
        final: { createRows: 0, updateRows: 32, skippedRows: 0 },
        pendingRowsByLogicalTable: [{
          logicalTableKey: 'mktReportMetricValues',
          createRows: 0,
          updateRows: 32,
        }],
        pendingFieldNameCounts: {
          capability: 8,
          coverage_rate: 24,
        },
        readStrategy: 'filtered_keys',
      });
      const diagnostics = JSON.stringify(error.details);
      assert.doesNotMatch(
        diagnostics,
        /tbl_sensitive|caption text|999_sensitive_business_value|token value|secret value|record_id/iu,
      );
      return true;
    },
  );

  assert.equal(attempts, LARK_DASHBOARD_BACKFILL_VERIFICATION_DELAYS_MS.length);
});

test('post-Apply verification blocks create rows immediately without retry or write', async () => {
  let attempts = 0;
  let sleeps = 0;
  await assert.rejects(
    () => verifyBackfillPostApply({
      planAttempt: async () => {
        attempts += 1;
        return verificationSummary({ createRows: 1, updateRows: 0 });
      },
      sleep: async () => {
        sleeps += 1;
      },
      now: () => 0,
    }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_CREATE_BLOCKED',
  );
  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
});

test('backfill field comparison normalizes semantic Lark shapes without hiding null versus zero', () => {
  const fields = [
    { fieldName: 'report_metric_key', type: 1 },
    { fieldName: 'customer_key', type: 1 },
    { fieldName: 'capability', type: 1 },
    {
      fieldName: 'period_kind',
      type: 3,
      property: { options: [{ name: 'rolling_days' }, { name: 'custom_range' }] },
    },
    { fieldName: 'window_days', type: 2, property: { formatter: '0' } },
    { fieldName: 'coverage_rate', type: 2, property: { formatter: '0.0000' } },
  ];
  const [prepared] = serializeRowsForLark([{
    report_metric_key: 'report::views',
    customer_key: 'chemistry_k',
    capability: 'organic',
    period_kind: 'rolling_days',
    window_days: 3,
    coverage_rate: 0.125,
  }], fields, { tableId: 'metrics', keyField: 'report_metric_key' });
  const [existing] = normalizeExistingRecordsForComparison([{
    recordId: 'rec-1',
    fields: {
      report_metric_key: [{ text: 'report::views' }],
      customer_key: [{ text: 'chemistry_k' }],
      capability: [{ text: 'organic' }],
      period_kind: [{ name: 'rolling_days' }],
      window_days: '3',
      coverage_rate: '0.1250',
    },
  }], fields, {
    tableId: 'metrics',
    incomingFieldNames: Object.keys(prepared),
  });
  assert.equal(hasChangedFields(existing.fields, prepared), false);

  const [preparedNull] = serializeRowsForLark([{
    report_metric_key: 'report::custom',
    customer_key: 'chemistry_k',
    capability: 'organic',
    period_kind: 'custom_range',
    window_days: null,
    coverage_rate: null,
  }], fields, { tableId: 'metrics', keyField: 'report_metric_key' });
  const [existingNull] = normalizeExistingRecordsForComparison([{
    recordId: 'rec-2',
    fields: {
      report_metric_key: 'report::custom',
      customer_key: 'chemistry_k',
      capability: 'organic',
      period_kind: 'custom_range',
      window_days: null,
      coverage_rate: null,
    },
  }], fields, {
    tableId: 'metrics',
    incomingFieldNames: Object.keys(preparedNull),
  });
  assert.equal(Object.hasOwn(preparedNull, 'window_days'), false);
  assert.equal(Object.hasOwn(preparedNull, 'coverage_rate'), false);
  assert.equal(hasChangedFields(existingNull.fields, preparedNull), false);

  const [preparedZero] = serializeRowsForLark([{
    report_metric_key: 'report::zero',
    coverage_rate: 0,
  }], fields, { tableId: 'metrics', keyField: 'report_metric_key' });
  const [existingMissing] = normalizeExistingRecordsForComparison([{
    recordId: 'rec-3',
    fields: {
      report_metric_key: 'report::zero',
      coverage_rate: null,
    },
  }], fields, {
    tableId: 'metrics',
    incomingFieldNames: Object.keys(preparedZero),
  });
  assert.equal(hasChangedFields(existingMissing.fields, preparedZero), true);
});

function verificationSummary(overrides = {}) {
  const createRows = overrides.createRows ?? 0;
  const updateRows = overrides.updateRows ?? 0;
  const skippedRows = overrides.skippedRows ?? 0;
  return {
    planCount: 1,
    createRows,
    updateRows,
    skippedRows,
    tables: [{
      logicalTableKey: 'mktReportMetricValues',
      plans: 1,
      createRows,
      updateRows,
      skippedRows,
    }],
    pendingFieldNameCounts: overrides.pendingFieldNameCounts ?? (
      updateRows > 0 ? { coverage_rate: updateRows } : {}
    ),
    readStrategies: ['filtered_keys'],
  };
}
