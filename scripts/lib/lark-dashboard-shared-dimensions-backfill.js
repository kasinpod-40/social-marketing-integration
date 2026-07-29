const ORGANIC_PLATFORM_SCOPES = Object.freeze([
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
]);

export const LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION =
  'BACKFILL_VALIDATED_MATERIALIZATIONS';

export const LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_FIELDS = Object.freeze({
  mktReportSnapshots: Object.freeze([
    'customer_key',
    'capability',
    'coverage_rate',
  ]),
  mktReportMetricValues: Object.freeze([
    'customer_key',
    'capability',
    'period_kind',
    'window_days',
    'coverage_rate',
  ]),
  mktReportTopContent: Object.freeze([
    'customer_key',
    'capability',
    'period_kind',
    'window_days',
    'coverage_rate',
  ]),
  mktReportTopAds: Object.freeze([
    'customer_key',
    'capability',
    'period_kind',
    'window_days',
    'coverage_rate',
  ]),
});

export function parseLarkDashboardSharedDimensionsBackfillArgs(args = []) {
  const values = Array.isArray(args) ? args : [];
  const unknown = values.filter((value) => !['--apply', '--help'].includes(value));
  if (unknown.length > 0) {
    throw backfillError(
      `Unsupported argument: ${unknown[0]}`,
      'LARK_DASHBOARD_BACKFILL_ARGUMENT_INVALID',
    );
  }
  return Object.freeze({
    apply: values.includes('--apply'),
    help: values.includes('--help'),
  });
}

export function assertLarkDashboardSharedDimensionsBackfillConfirmation(env = {}, apply = false) {
  if (!apply) return true;
  if (env.CONFIRM_WRITE !== 'YES'
    || env.CONFIRM_LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL
      !== LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION) {
    throw backfillError(
      'Apply requires CONFIRM_WRITE=YES and the exact dashboard backfill confirmation',
      'LARK_DASHBOARD_BACKFILL_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildLarkDashboardSharedDimensionsBackfillSql(input = {}) {
  const customerKey = requireKey(input.customerKey, 'customerKey');
  const maximumRows = requireBoundedInteger(input.maximumRows ?? 100, 1, 500, 'maximumRows');
  const platformList = ORGANIC_PLATFORM_SCOPES.map((value) => `'${value}'`).join(', ');
  return Object.freeze({
    maximumRows,
    sql: [
      'SELECT *',
      'FROM report_materializations',
      `WHERE customer_key = '${customerKey}'`,
      "AND report_type = 'dashboard_performance_report'",
      `AND platform_scope IN (${platformList})`,
      'ORDER BY period_end ASC, generated_at ASC, report_id ASC',
      `LIMIT ${maximumRows + 1}`,
    ].join('\n'),
  });
}

export function parseWranglerD1Rows(output) {
  let parsed;
  try {
    parsed = JSON.parse(requireText(output, 'wranglerOutput'));
  } catch (cause) {
    throw backfillError(
      'Wrangler D1 output was not valid JSON',
      'LARK_DASHBOARD_BACKFILL_D1_OUTPUT_INVALID',
      { causeMessage: cause instanceof Error ? cause.message : String(cause) },
    );
  }
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) continue;
    if (envelope.success === false) {
      throw backfillError(
        'Wrangler D1 query reported failure',
        'LARK_DASHBOARD_BACKFILL_D1_QUERY_FAILED',
      );
    }
    for (const candidate of [
      envelope.results,
      envelope.result?.results,
      ...(Array.isArray(envelope.result)
        ? envelope.result.map((item) => item?.results)
        : []),
    ]) {
      if (Array.isArray(candidate)) rows.push(...candidate);
    }
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...requireObject(row, 'd1Row') })));
}

export function assertBoundedMaterializationRows(rows, maximumRows) {
  const values = requireArray(rows, 'rows');
  const maximum = requireBoundedInteger(maximumRows, 1, 500, 'maximumRows');
  if (values.length > maximum) {
    throw backfillError(
      'Dashboard materialization backfill exceeded the reviewed row bound',
      'LARK_DASHBOARD_BACKFILL_ROW_BOUND_EXCEEDED',
      { observedRows: values.length, maximumRows: maximum },
    );
  }
  const ids = new Set();
  for (const row of values) {
    const reportId = requireText(row?.report_id, 'report_id');
    if (ids.has(reportId)) {
      throw backfillError(
        'Dashboard materialization query returned duplicate report IDs',
        'LARK_DASHBOARD_BACKFILL_DUPLICATE_REPORT_ID',
        { reportId },
      );
    }
    ids.add(reportId);
  }
  return Object.freeze([...values]);
}

export function createInMemoryReportMaterializationD1(rows) {
  const byId = new Map(assertBoundedMaterializationRows(rows, 500)
    .map((row) => [requireText(row.report_id, 'report_id'), row]));
  return Object.freeze({
    prepare(sql) {
      const statement = requireText(sql, 'sql');
      if (!statement.includes('FROM report_materializations') || !statement.includes('report_id = ?')) {
        throw backfillError(
          'In-memory D1 adapter accepts report materialization readById only',
          'LARK_DASHBOARD_BACKFILL_D1_QUERY_UNSUPPORTED',
        );
      }
      return Object.freeze({
        bind(reportId) {
          const normalized = requireText(reportId, 'reportId');
          return Object.freeze({
            async first() {
              return byId.get(normalized) ?? null;
            },
          });
        },
      });
    },
  });
}

export function createBackfillAllowedFieldsByTableId(tables = {}) {
  const result = {};
  for (const [tableKey, fields] of Object.entries(
    LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_FIELDS,
  )) {
    const tableId = tables[tableKey];
    if (typeof tableId === 'string' && tableId.trim()) {
      result[tableId.trim()] = fields;
    }
  }
  return Object.freeze(result);
}

export function createLarkDashboardSharedDimensionsBackfillPlanner(input = {}) {
  const baseEngine = requireBaseEngine(input.baseEngine);
  const allowedFieldsByTableId = requireObject(
    input.allowedFieldsByTableId,
    'allowedFieldsByTableId',
  );
  const planned = [];

  const syncEngine = Object.freeze({
    async planByKey(planInput = {}) {
      const tableId = requireText(planInput.tableId, 'tableId');
      const allowedFields = allowedFieldsByTableId[tableId];
      if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
        throw backfillError(
          'Backfill attempted to plan an unreviewed Lark table',
          'LARK_DASHBOARD_BACKFILL_TABLE_NOT_ALLOWED',
          { tableId },
        );
      }
      const keyField = requireText(planInput.keyField, 'keyField');
      const filteredRows = requireArray(planInput.rows, 'rows').map((row) => (
        pickBackfillFields(row, keyField, allowedFields)
      ));
      const plan = await baseEngine.planByKey({
        ...planInput,
        rows: filteredRows,
      });
      planned.push(Object.freeze({ tableId, keyField, plan }));
      return plan;
    },

    async executePlan(plan) {
      return Object.freeze({
        preview: true,
        created: 0,
        updated: 0,
        skipped: plan.skipped,
        plannedCreate: plan.createRows.length,
        plannedUpdate: plan.updateRows.length,
      });
    },
  });

  return Object.freeze({
    syncEngine,
    summarize() {
      return summarizePlans(planned);
    },
    assertSafeToApply() {
      const summary = summarizePlans(planned);
      if (summary.createRows > 0) {
        throw backfillError(
          'Backfill refuses to create missing Lark report rows',
          'LARK_DASHBOARD_BACKFILL_CREATE_BLOCKED',
          { createRows: summary.createRows },
        );
      }
      return summary;
    },
    async executeAll() {
      const summary = this.assertSafeToApply();
      const results = [];
      for (const item of planned) {
        results.push(Object.freeze({
          tableId: item.tableId,
          result: await baseEngine.executePlan(item.plan),
        }));
      }
      return Object.freeze({ summary, results: Object.freeze(results) });
    },
  });
}

export function assertBackfillVerificationComplete(summary = {}) {
  const value = requireObject(summary, 'summary');
  if (value.createRows !== 0 || value.updateRows !== 0) {
    throw backfillError(
      'Post-apply backfill verification still has pending writes',
      'LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED',
      { createRows: value.createRows, updateRows: value.updateRows },
    );
  }
  return true;
}

function pickBackfillFields(rowInput, keyField, allowedFields) {
  const row = requireObject(rowInput, 'row');
  const result = { [keyField]: requireText(row[keyField], keyField) };
  for (const fieldName of allowedFields) {
    if (Object.hasOwn(row, fieldName)) result[fieldName] = row[fieldName];
  }
  return Object.freeze(result);
}

function summarizePlans(planned) {
  const tables = {};
  let createRows = 0;
  let updateRows = 0;
  let skippedRows = 0;
  for (const item of planned) {
    const current = tables[item.tableId] ?? {
      tableId: item.tableId,
      plans: 0,
      createRows: 0,
      updateRows: 0,
      skippedRows: 0,
    };
    current.plans += 1;
    current.createRows += item.plan.createRows.length;
    current.updateRows += item.plan.updateRows.length;
    current.skippedRows += item.plan.skipped;
    tables[item.tableId] = current;
    createRows += item.plan.createRows.length;
    updateRows += item.plan.updateRows.length;
    skippedRows += item.plan.skipped;
  }
  return Object.freeze({
    planCount: planned.length,
    createRows,
    updateRows,
    skippedRows,
    tables: Object.freeze(Object.values(tables).map((value) => Object.freeze({ ...value }))),
  });
}

function requireBaseEngine(value) {
  if (typeof value?.planByKey !== 'function' || typeof value?.executePlan !== 'function') {
    throw new TypeError('baseEngine requires planByKey() and executePlan()');
  }
  return value;
}

function requireKey(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(text)) {
    throw backfillError(
      `${fieldName} must be a safe lowercase key`,
      'LARK_DASHBOARD_BACKFILL_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireBoundedInteger(value, minimum, maximum, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw backfillError(
      `${fieldName} must be an integer from ${minimum} to ${maximum}`,
      'LARK_DASHBOARD_BACKFILL_INPUT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function backfillError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardSharedDimensionsBackfillError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
