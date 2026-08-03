import {
  LARK_NOTIFICATION_LOG_DEFAULT_VIEW_NAME,
  LARK_NOTIFICATION_LOG_EXPECTED_COUNTS,
  LARK_NOTIFICATION_LOG_FIELDS,
  LARK_NOTIFICATION_LOG_LEGACY_TABLE_NAME,
  LARK_NOTIFICATION_LOG_TABLE_NAME,
  LARK_NOTIFICATION_LOG_VIEWS,
  buildLarkNotificationLogCreateTableFields,
} from '../../packages/config/src/lark-notification-log-schema-contract.js';
import {
  canonicalSchemaValue,
  isEmptyFilter,
  normalizeComparableFilter,
} from '../../packages/application/src/reports/lark-native-ai-schema-apply-model.js';
import {
  buildLarkNativeAiSchemaViewFilter,
  normalizeLarkNativeAiSchemaComparableViewFilter,
} from '../../packages/application/src/reports/lark-native-ai-schema-view-filters.js';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const FIELDS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields$/u;
const VIEWS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views$/u;
const VIEW_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views\/[^/]+$/u;

const REQUEST_LIMITS = Object.freeze({
  token: 2,
  tableRead: 10,
  fieldRead: 20,
  viewListRead: 20,
  viewGetRead: 40,
  createTable: LARK_NOTIFICATION_LOG_EXPECTED_COUNTS.maximumCreateTableRequests,
  createField: LARK_NOTIFICATION_LOG_EXPECTED_COUNTS.maximumCreateFieldRequests,
  createView: LARK_NOTIFICATION_LOG_EXPECTED_COUNTS.maximumCreateViewRequests,
  updateView: LARK_NOTIFICATION_LOG_EXPECTED_COUNTS.maximumUpdateViewRequests,
});

export async function planLarkNotificationLogSchema(input = {}) {
  const client = requireClient(input.client, false);
  const tables = await client.listTables();
  const exact = tables.filter(({ name }) => name === LARK_NOTIFICATION_LOG_TABLE_NAME);
  const legacy = tables.filter(({ name }) => name === LARK_NOTIFICATION_LOG_LEGACY_TABLE_NAME);

  if (exact.length > 1) throw schemaError(
    'Notification Log table identity is duplicated',
    'LARK_NOTIFICATION_LOG_TABLE_DUPLICATE',
    { count: exact.length },
  );
  if (legacy.length > 1) throw schemaError(
    'Legacy Notification Log table identity is duplicated',
    'LARK_NOTIFICATION_LOG_LEGACY_TABLE_DUPLICATE',
    { count: legacy.length },
  );
  if (exact.length === 0 && legacy.length === 1) throw schemaError(
    'A legacy table without the approved icon already exists; automatic rename is intentionally blocked',
    'LARK_NOTIFICATION_LOG_LEGACY_TABLE_CONFLICT',
    { legacyTableName: LARK_NOTIFICATION_LOG_LEGACY_TABLE_NAME },
  );
  if (exact.length === 1 && legacy.length === 1) throw schemaError(
    'Both approved and legacy Notification Log table names exist',
    'LARK_NOTIFICATION_LOG_TABLE_ALIAS_CONFLICT',
  );

  if (exact.length === 0) return freeze({
    ok: true,
    status: 'ready_to_create_table',
    table: null,
    fieldActions: [],
    viewPlans: [],
    counts: {
      createTable: 1,
      createField: 0,
      createView: LARK_NOTIFICATION_LOG_VIEWS.length - 1,
      updateView: LARK_NOTIFICATION_LOG_VIEWS.length - 1,
    },
  });

  const table = exact[0];
  const tableId = requireText(table.tableId, 'table.tableId');
  const fields = await client.listFields({ tableId });
  const views = await client.listViews({ tableId });
  const fieldActions = buildFieldActions(fields);
  const viewPlans = await buildViewPlans(client, { table, fields, views });
  const remaining = fieldActions.length + viewPlans.filter(({ state }) => state !== 'complete').length;

  return freeze({
    ok: true,
    status: remaining === 0 ? 'zero_drift' : 'resume_ready',
    table,
    fields,
    views,
    fieldActions,
    viewPlans,
    counts: {
      createTable: 0,
      createField: fieldActions.length,
      createView: viewPlans.filter(({ state }) => state === 'create').length,
      updateView: viewPlans.filter(({ state }) => ['create', 'configure'].includes(state)
        && contractByName(viewPlans, stateViewName(viewPlans, state)) !== null).length,
    },
  });
}

export async function applyLarkNotificationLogSchema(input = {}) {
  const client = requireClient(input.client, true);
  const progress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  let plan = await planLarkNotificationLogSchema({ client });
  const appliedActions = [];

  if (plan.status === 'ready_to_create_table') {
    progress({ stage: 'create_table_start', tableName: LARK_NOTIFICATION_LOG_TABLE_NAME });
    await client.createTable({
      name: LARK_NOTIFICATION_LOG_TABLE_NAME,
      defaultViewName: LARK_NOTIFICATION_LOG_DEFAULT_VIEW_NAME,
      fields: buildLarkNotificationLogCreateTableFields(),
    });
    appliedActions.push(freeze({ action: 'create_table', tableName: LARK_NOTIFICATION_LOG_TABLE_NAME }));
    progress({ stage: 'create_table_complete', tableName: LARK_NOTIFICATION_LOG_TABLE_NAME });
    plan = await planLarkNotificationLogSchema({ client });
  }

  if (plan.status === 'zero_drift') return freeze({
    ok: true,
    mode: appliedActions.length === 0 ? 'already_zero_drift' : 'applied',
    appliedActions,
    verification: verificationSummary(plan),
  });

  for (const action of plan.fieldActions) {
    progress({ stage: 'create_field_start', fieldName: action.field.fieldName });
    await client.createField({ tableId: plan.table.tableId, field: action.field });
    appliedActions.push(freeze({ action: 'create_field', fieldName: action.field.fieldName }));
    progress({ stage: 'create_field_complete', fieldName: action.field.fieldName });
  }

  plan = await planLarkNotificationLogSchema({ client });
  for (const item of plan.viewPlans) {
    if (item.state === 'complete') continue;
    let view = item.view;
    if (item.state === 'create') {
      progress({ stage: 'create_view_start', viewName: item.viewName });
      view = await client.createView({
        tableId: plan.table.tableId,
        viewName: item.viewName,
        viewType: 'grid',
      });
      appliedActions.push(freeze({ action: 'create_view', viewName: item.viewName }));
      progress({ stage: 'create_view_complete', viewName: item.viewName });
    }

    const expected = buildLarkNativeAiSchemaViewFilter(item.contract, plan.fields);
    if (expected !== null) {
      const viewId = requireText(view?.viewId, `${item.viewName}.viewId`);
      const hydrated = await client.getView({ tableId: plan.table.tableId, viewId });
      const actual = comparableFilter(hydrated?.property?.filterInfo);
      if (canonicalSchemaValue(actual) !== canonicalSchemaValue(expected.comparable)) {
        if (!isEmptyFilter(actual)) throw viewConflict(item.viewName);
        progress({ stage: 'configure_view_start', viewName: item.viewName });
        await client.updateView({
          tableId: plan.table.tableId,
          viewId,
          filterInfo: expected.mutation,
        });
        appliedActions.push(freeze({ action: 'configure_view', viewName: item.viewName }));
        progress({ stage: 'configure_view_complete', viewName: item.viewName });
      }
    }
    plan = await planLarkNotificationLogSchema({ client });
  }

  const verification = await planLarkNotificationLogSchema({ client });
  if (verification.status !== 'zero_drift') throw schemaError(
    'Notification Log schema did not reach zero drift',
    'LARK_NOTIFICATION_LOG_VERIFICATION_FAILED',
    { status: verification.status, counts: verification.counts },
  );

  return freeze({
    ok: true,
    mode: 'applied',
    appliedActions,
    verification: verificationSummary(verification),
  });
}

export function createLarkNotificationLogSchemaFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    token: 0,
    tableRead: 0,
    fieldRead: 0,
    viewListRead: 0,
    viewGetRead: 0,
    createTable: 0,
    createField: 0,
    createView: 0,
    updateView: 0,
    blocked: 0,
  };

  async function guardedFetch(url, options = {}) {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = String(options.method ?? 'GET').toUpperCase();
    let kind = null;

    if (method === 'POST' && path === AUTH_PATH) kind = 'token';
    else if (method === 'GET' && TABLES_PATH.test(path)) kind = 'tableRead';
    else if (method === 'POST' && TABLES_PATH.test(path)) kind = 'createTable';
    else if (method === 'GET' && FIELDS_PATH.test(path)) kind = 'fieldRead';
    else if (method === 'POST' && FIELDS_PATH.test(path)) kind = 'createField';
    else if (method === 'GET' && VIEWS_PATH.test(path)) kind = 'viewListRead';
    else if (method === 'POST' && VIEWS_PATH.test(path)) kind = 'createView';
    else if (method === 'GET' && VIEW_PATH.test(path)) kind = 'viewGetRead';
    else if (method === 'PATCH' && VIEW_PATH.test(path)) kind = 'updateView';

    if (!kind) {
      counters.blocked += 1;
      throw schemaError(
        'Lark Notification Log schema request is outside the reviewed allowlist',
        'LARK_NOTIFICATION_LOG_REQUEST_BLOCKED',
        { method, path: sanitizePath(path) },
      );
    }

    counters[kind] += 1;
    if (counters[kind] > REQUEST_LIMITS[kind]) {
      counters.blocked += 1;
      throw schemaError(
        'Lark Notification Log schema request limit exceeded',
        'LARK_NOTIFICATION_LOG_REQUEST_LIMIT_EXCEEDED',
        { kind, observed: counters[kind], maximum: REQUEST_LIMITS[kind] },
      );
    }
    return fetchImpl(url, options);
  }

  return freeze({
    fetchImpl: guardedFetch,
    snapshot: () => freeze({ ...counters }),
  });
}

function buildFieldActions(fields) {
  const grouped = groupBy(fields, 'fieldName');
  const expectedNames = new Set(LARK_NOTIFICATION_LOG_FIELDS.map(({ fieldName }) => fieldName));
  const unexpected = [...grouped.keys()].filter((name) => !expectedNames.has(name)).sort();
  if (unexpected.length > 0) throw schemaError(
    'Notification Log contains unaccepted Fields; no destructive cleanup is attempted',
    'LARK_NOTIFICATION_LOG_UNACCEPTED_FIELD_DRIFT',
    { fields: unexpected },
  );

  const actions = [];
  for (const [index, contract] of LARK_NOTIFICATION_LOG_FIELDS.entries()) {
    const matches = grouped.get(contract.fieldName) ?? [];
    if (matches.length > 1) throw schemaError(
      'Notification Log Field identity is duplicated',
      'LARK_NOTIFICATION_LOG_FIELD_DUPLICATE',
      { fieldName: contract.fieldName, count: matches.length },
    );
    if (matches.length === 0) {
      if (index === 0) throw schemaError(
        'Primary notification_attempt_key Field is missing and cannot be repaired additively',
        'LARK_NOTIFICATION_LOG_PRIMARY_FIELD_MISSING',
      );
      actions.push(freeze({ action: 'create_field', field: fieldMutation(contract) }));
      continue;
    }
    assertFieldMatchesContract(matches[0], contract, index === 0);
  }
  return freeze(actions);
}

async function buildViewPlans(client, raw) {
  const grouped = groupBy(raw.views, 'viewName');
  const expectedNames = new Set(LARK_NOTIFICATION_LOG_VIEWS.map(({ viewName }) => viewName));
  const unexpected = [...grouped.keys()].filter((name) => !expectedNames.has(name)).sort();
  if (unexpected.length > 0) throw schemaError(
    'Notification Log contains unaccepted Views; no View is deleted',
    'LARK_NOTIFICATION_LOG_UNACCEPTED_VIEW_DRIFT',
    { views: unexpected },
  );

  const plans = [];
  for (const contract of LARK_NOTIFICATION_LOG_VIEWS) {
    const matches = grouped.get(contract.viewName) ?? [];
    if (matches.length > 1) throw schemaError(
      'Notification Log View identity is duplicated',
      'LARK_NOTIFICATION_LOG_VIEW_DUPLICATE',
      { viewName: contract.viewName, count: matches.length },
    );
    if (matches.length === 0) {
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'create', view: null }));
      continue;
    }
    const view = matches[0];
    const viewId = requireText(view.viewId, `${contract.viewName}.viewId`);
    const hydrated = await client.getView({ tableId: raw.table.tableId, viewId });
    const actual = comparableFilter(hydrated?.property?.filterInfo);
    const expected = buildLarkNativeAiSchemaViewFilter(contract, raw.fields);
    if (expected === null) {
      if (!isEmptyFilter(actual)) throw viewConflict(contract.viewName);
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'complete', view }));
    } else if (canonicalSchemaValue(actual) === canonicalSchemaValue(expected.comparable)) {
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'complete', view }));
    } else if (isEmptyFilter(actual)) {
      plans.push(freeze({ viewName: contract.viewName, contract, state: 'configure', view }));
    } else throw viewConflict(contract.viewName);
  }
  return freeze(plans);
}

function assertFieldMatchesContract(field, contract, primary) {
  if (Number(field.type) !== contract.type) throw schemaError(
    'Notification Log Field type conflicts with the approved contract',
    'LARK_NOTIFICATION_LOG_FIELD_TYPE_CONFLICT',
    { fieldName: contract.fieldName, expectedType: contract.type, actualType: Number(field.type) },
  );
  if (primary && field.isPrimary !== true) throw schemaError(
    'notification_attempt_key is not the Primary field',
    'LARK_NOTIFICATION_LOG_PRIMARY_FIELD_INVALID',
  );
  if (!contract.options) return;
  const actual = Array.isArray(field.property?.options)
    ? field.property.options.map(({ name }) => name).sort()
    : [];
  const expected = [...contract.options].sort();
  if (canonicalSchemaValue(actual) !== canonicalSchemaValue(expected)) throw schemaError(
    'Notification Log Select options conflict with the approved contract',
    'LARK_NOTIFICATION_LOG_SELECT_OPTIONS_CONFLICT',
    { fieldName: contract.fieldName, expected, actual },
  );
}

function fieldMutation(contract) {
  return {
    fieldName: contract.fieldName,
    type: contract.type,
    uiType: contract.uiType,
    description: contract.description,
    ...(contract.options ? {
      property: {
        options: contract.options.map((name, index) => ({ name, color: index % 10 })),
      },
    } : contract.fieldType === 'DateTime' ? {
      property: { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false },
    } : {}),
  };
}

function comparableFilter(value) {
  return normalizeLarkNativeAiSchemaComparableViewFilter(normalizeComparableFilter(value));
}

function verificationSummary(plan) {
  return freeze({
    status: plan.status,
    tableName: LARK_NOTIFICATION_LOG_TABLE_NAME,
    fieldCount: plan.fields?.length ?? LARK_NOTIFICATION_LOG_FIELDS.length,
    viewCount: plan.views?.length ?? LARK_NOTIFICATION_LOG_VIEWS.length,
    recordReadCount: 0,
    recordWriteCount: 0,
    automationCount: 0,
    notificationCount: 0,
  });
}

function viewConflict(viewName) {
  return schemaError(
    'Existing Notification Log View filter conflicts with the approved contract',
    'LARK_NOTIFICATION_LOG_VIEW_FILTER_CONFLICT',
    { viewName },
  );
}

function groupBy(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const name = requireText(item?.[key], key);
    const current = grouped.get(name) ?? [];
    current.push(item);
    grouped.set(name, current);
  }
  return grouped;
}

function contractByName(plans, name) {
  return plans.find(({ viewName }) => viewName === name)?.contract ?? null;
}

function stateViewName(plans, state) {
  return plans.find((item) => item.state === state)?.viewName ?? '';
}

function requireClient(value, apply) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('client is required');
  const methods = ['listTables', 'listFields', 'listViews', 'getView',
    ...(apply ? ['createTable', 'createField', 'createView', 'updateView'] : [])];
  for (const method of methods) if (typeof value[method] !== 'function') {
    throw new TypeError(`client.${method} is required`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}

function sanitizePath(path) {
  return String(path).replace(/\/apps\/[^/]+/u, '/apps/[redacted]')
    .replace(/\/tables\/[^/]+/u, '/tables/[redacted]')
    .replace(/\/views\/[^/]+/u, '/views/[redacted]');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}

export function schemaError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationLogSchemaError';
  error.code = code;
  error.details = freeze({ ...details });
  return error;
}
