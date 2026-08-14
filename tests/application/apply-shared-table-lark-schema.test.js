import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applySharedTableLarkSchema } from '../../packages/application/src/use-cases/apply-shared-table-lark-schema.js';
import {
  SHARED_TABLE_LARK_SCHEMA_VERSION,
  buildSharedTableLarkSchemaFromCsv,
  buildSharedTableViewContractFromCsv,
  validateSharedTableLarkSchema,
} from '../../packages/config/src/shared-table-lark-schema.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const ROOT = new URL('../../', import.meta.url);
const DIR = 'docs/shared-table-blueprint-v0.12.1/';
const REUSE = Object.freeze([
  ['RAW_TikTok_Business_Campaigns', 'tblCampaigns', 'campaign_id'],
  ['RAW_TikTok_Business_AdGroups', 'tblAdgroups', 'ad_group_id'],
  ['RAW_TikTok_Business_Ads', 'tblAds', 'ad_id'],
  ['RAW_Google_Campaigns', 'tblGoogleCampaigns', 'campaign_id'],
  ['RAW_Google_Customer_Lists', 'tblGoogleLists', 'customer_list_id'],
]);

async function loadContract() {
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv, viewPlanCsv] = await Promise.all([
    read('table-inventory.csv'), read('fields.csv'), read('migration-map.csv'), read('view-plan.csv'),
  ]);
  return {
    schema: buildSharedTableLarkSchemaFromCsv({ tableInventoryCsv, fieldsCsv, migrationMapCsv }),
    views: buildSharedTableViewContractFromCsv({ viewPlanCsv }),
  };
}

function read(name) {
  return readFile(new URL(`${DIR}${name}`, ROOT), 'utf8');
}

test('applies the exact Shared-table plan and verifies zero drift without touching records or protected TikTok', async () => {
  const { schema, views } = await loadContract();
  const state = createState();
  const client = statefulClient(state);
  const result = await applySharedTableLarkSchema({
    client,
    env: {},
    schema,
    views,
    schemaVersion: SHARED_TABLE_LARK_SCHEMA_VERSION,
    validateSchema: validateSharedTableLarkSchema,
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.renamedTables, 0);
  assert.equal(result.summary.createdTables, 2);
  assert.equal(result.summary.updatedPrimaryFields, 0);
  assert.equal(result.summary.createdViews, 0);
  assert.equal(result.summary.remainingActions, 0);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.summary.manualActions, 0);
  assert.equal(result.summary.protectedActions, 0);
  assert.equal(result.summary.deleteActions, 0);
  assert.equal(result.summary.recordWrites, 0);
  assert.equal(state.tables.find((table) => table.tableId === 'tblTikTokNative').name, '🎵 RAW_TikTok_Creator_Videos');
  assert.equal(state.writes.some((write) => write.kind === 'record_write'), false);
  assert.ok(state.tables.some((table) => table.name === 'MKT_Account_Daily'));
  assert.ok(state.tables.some((table) => table.name === 'MKT_Ads_Ads'));
  assert.equal(Object.keys(result.environmentUpdates).length, 2);
});

test('is idempotent after a successful Apply', async () => {
  const { schema, views } = await loadContract();
  const state = createState();
  const client = statefulClient(state);
  await applySharedTableLarkSchema({ client, env: {}, schema, views });
  const writesBefore = state.writes.length;
  const rerun = await applySharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.summary.appliedSchemaActions, 0);
  assert.equal(rerun.summary.createdViews, 0);
  assert.equal(rerun.summary.updatedViews, 0);
  assert.equal(state.writes.length, writesBefore);
});

test('legacy RAW records do not block customer-facing canonical table creation', async () => {
  const { schema, views } = await loadContract();
  const state = createState({ nonEmptyTableId: 'tblAds' });
  const result = await applySharedTableLarkSchema({ client: statefulClient(state), env: {}, schema, views });
  assert.equal(result.ok, true);
  assert.equal(result.summary.createdTables, 2);
  assert.equal(state.writes.some((write) => write.kind === 'rename_table'), false);
});

test('fails closed when the protected TikTok source is missing but ignores a missing legacy RAW slot', async () => {
  const { schema, views } = await loadContract();
  const missingProtected = createState({ omitProtected: true });
  await assert.rejects(
    applySharedTableLarkSchema({ client: statefulClient(missingProtected), env: {}, schema, views }),
    (error) => error.code === 'SHARED_TABLE_APPLY_PLAN_INVALID'
      && error.details.problems.includes('warnings_present'),
  );
  assert.equal(missingProtected.writes.length, 0);

  const missingReuse = createState({ omitTableId: 'tblGoogleLists' });
  const result = await applySharedTableLarkSchema({ client: statefulClient(missingReuse), env: {}, schema, views });
  assert.equal(result.ok, true);
  assert.equal(result.summary.createdTables, 2);
});



test('does not invoke the legacy RAW View installer', async () => {
  const { schema, views } = await loadContract();
  const state = createState({ failFirstViewUpdate: true });
  const client = statefulClient(state);

  const result = await applySharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.ok, true);
  assert.equal(result.summary.createdViews, 0);
  assert.equal(state.writes.some((write) => write.kind === 'create_view'), false);
  assert.equal(state.writes.some((write) => write.kind === 'update_view'), false);
});

test('reports zero standalone Field creates for create-new canonical tables', async () => {
  const { schema, views } = await loadContract();
  const state = createState({ failFirstCreateField: true });
  const result = await applySharedTableLarkSchema({ client: statefulClient(state), env: {}, schema, views });
  assert.equal(result.ok, true);
  assert.equal(result.summary.createdFields, 0);
  assert.equal(state.writes.filter((write) => write.kind === 'rename_table').length, 0);
  assert.equal(state.writes.filter((write) => write.kind === 'update_field').length, 0);
  assert.equal(state.writes.some((write) => write.kind === 'create_view'), false);
});

function createState(input = {}) {
  const tables = [];
  if (!input.omitProtected) tables.push({ tableId: 'tblTikTokNative', name: '🎵 RAW_TikTok_Creator_Videos' });
  for (const [name, tableId, primaryName] of REUSE) {
    if (tableId === input.omitTableId) continue;
    tables.push({ tableId, name: `🧪 ${name}` });
  }
  const fields = new Map();
  const views = new Map();
  const records = new Map();
  for (const [name, tableId, primaryName] of REUSE) {
    if (tableId === input.omitTableId) continue;
    fields.set(tableId, [fieldShape({
      fieldId: `fld_primary_${tableId}`,
      fieldName: primaryName,
      type: 1,
      isPrimary: true,
      description: '',
    })]);
    views.set(tableId, [{
      viewId: `vew_default_${tableId}`,
      viewName: '📋 All Records',
      viewType: 'grid',
      property: { hiddenFields: [], filterInfo: null },
    }]);
    records.set(tableId, tableId === input.nonEmptyTableId ? [{ recordId: 'rec1', fields: {} }] : []);
  }
  fields.set('tblTikTokNative', []);
  views.set('tblTikTokNative', []);
  records.set('tblTikTokNative', []);
  return {
    tables,
    fields,
    views,
    records,
    writes: [],
    nextTable: 1,
    nextField: 1,
    nextView: 1,
    failFirstCreateField: input.failFirstCreateField === true,
    failFirstViewUpdate: input.failFirstViewUpdate === true,
  };
}

function statefulClient(state) {
  return {
    async listTables() { return structuredClone(state.tables); },
    async listFields({ tableId }) { return structuredClone(state.fields.get(tableId) ?? []); },
    async listViews({ tableId }) { return structuredClone(state.views.get(tableId) ?? []); },
    async getView({ tableId, viewId }) {
      return structuredClone((state.views.get(tableId) ?? []).find((view) => view.viewId === viewId));
    },
    async listRecordsPage({ tableId }) {
      const items = state.records.get(tableId) ?? [];
      return { records: structuredClone(items.slice(0, 1)), hasMore: items.length > 1, nextPageToken: null };
    },
    async renameTable({ tableId, name }) {
      const table = requireTable(state, tableId);
      table.name = name;
      state.writes.push({ kind: 'rename_table', tableId, name });
      return structuredClone(table);
    },
    async createTable({ name, fields, defaultViewName }) {
      const tableId = `tblNew${state.nextTable++}`;
      const table = { tableId, name };
      state.tables.push(table);
      state.fields.set(tableId, fields.map((field, index) => fieldShape({
        ...field,
        fieldId: `fld_new_${state.nextField++}`,
        isPrimary: index === 0,
      })));
      state.views.set(tableId, [{
        viewId: `vew_default_${state.nextView++}`,
        viewName: defaultViewName,
        viewType: 'grid',
        property: { hiddenFields: [], filterInfo: null },
      }]);
      state.records.set(tableId, []);
      state.writes.push({ kind: 'create_table', tableId, name });
      return structuredClone(table);
    },
    async createField({ tableId, field }) {
      if (state.failFirstCreateField) {
        state.failFirstCreateField = false;
        throw permanentError('simulated field failure', { code: 'TEST_FIELD_CREATE_FAILED' });
      }
      const created = fieldShape({ ...field, fieldId: `fld_new_${state.nextField++}`, isPrimary: false });
      const fields = state.fields.get(tableId) ?? [];
      fields.push(created);
      state.fields.set(tableId, fields);
      state.writes.push({ kind: 'create_field', tableId, fieldName: field.fieldName });
      return structuredClone(created);
    },
    async updateField({ tableId, fieldId, field }) {
      const fields = state.fields.get(tableId) ?? [];
      const index = fields.findIndex((candidate) => candidate.fieldId === fieldId);
      if (index < 0) throw new Error(`missing field ${fieldId}`);
      fields[index] = fieldShape({
        ...field,
        fieldId,
        isPrimary: fields[index].isPrimary === true,
      });
      state.writes.push({ kind: 'update_field', tableId, fieldId, fieldName: field.fieldName });
      return structuredClone(fields[index]);
    },
    async createView({ tableId, viewName, viewType }) {
      const view = {
        viewId: `vew_new_${state.nextView++}`,
        viewName,
        viewType,
        property: { hiddenFields: [], filterInfo: null },
      };
      const views = state.views.get(tableId) ?? [];
      views.push(view);
      state.views.set(tableId, views);
      state.writes.push({ kind: 'create_view', tableId, viewName });
      return structuredClone(view);
    },
    async updateView({ tableId, viewId, filterInfo, hiddenFields }) {
      if (state.failFirstViewUpdate) {
        state.failFirstViewUpdate = false;
        throw permanentError('simulated view update failure', { code: 'TEST_VIEW_UPDATE_FAILED' });
      }
      const view = (state.views.get(tableId) ?? []).find((candidate) => candidate.viewId === viewId);
      if (!view) throw new Error(`missing view ${viewId}`);
      if (filterInfo !== undefined) view.property.filterInfo = structuredClone(filterInfo);
      if (hiddenFields !== undefined) view.property.hiddenFields = structuredClone(hiddenFields);
      state.writes.push({ kind: 'update_view', tableId, viewId });
      return structuredClone(view);
    },
  };
}

function fieldShape(input) {
  const property = input.property ? structuredClone(input.property) : null;
  if (Array.isArray(property?.options)) {
    property.options = property.options.map((option, index) => ({
      ...option,
      id: option.id ?? `opt_${normalizeToken(input.fieldName)}_${index + 1}`,
    }));
  }
  return {
    fieldId: input.fieldId,
    fieldName: input.fieldName,
    type: input.type,
    uiType: input.uiType ?? null,
    description: input.description ?? '',
    isPrimary: input.isPrimary === true,
    property,
  };
}

function requireTable(state, tableId) {
  const table = state.tables.find((candidate) => candidate.tableId === tableId);
  if (!table) throw new Error(`missing table ${tableId}`);
  return table;
}

function normalizeToken(value) {
  return String(value).replace(/[^A-Za-z0-9]+/gu, '_');
}
