import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_NOTIFICATION_LOG_FIELDS,
  LARK_NOTIFICATION_LOG_LEGACY_TABLE_NAME,
  LARK_NOTIFICATION_LOG_TABLE_NAME,
  LARK_NOTIFICATION_LOG_VIEWS,
} from '../../packages/config/src/lark-notification-log-schema-contract.js';
import {
  applyLarkNotificationLogSchema,
  createLarkNotificationLogSchemaFetchGuard,
  planLarkNotificationLogSchema,
} from '../../scripts/lib/lark-notification-log-schema.js';

class FakeLarkClient {
  constructor(options = {}) {
    this.tables = structuredClone(options.tables ?? []);
    this.fields = new Map();
    this.views = new Map();
    this.calls = {
      createTable: 0,
      createField: 0,
      createView: 0,
      updateView: 0,
    };

    for (const table of this.tables) {
      this.fields.set(table.tableId, structuredClone(options.fields?.[table.tableId] ?? []));
      this.views.set(table.tableId, structuredClone(options.views?.[table.tableId] ?? []));
    }
  }

  async listTables() {
    return structuredClone(this.tables);
  }

  async createTable({ name, defaultViewName, fields }) {
    this.calls.createTable += 1;
    const table = { tableId: `tbl_${this.tables.length + 1}`, name };
    this.tables.push(table);
    this.fields.set(table.tableId, fields.map((field, index) => normalizeField(field, index === 0)));
    this.views.set(table.tableId, [{
      viewId: 'view_1',
      viewName: defaultViewName,
      property: { filterInfo: null },
    }]);
    return structuredClone(table);
  }

  async listFields({ tableId }) {
    return structuredClone(this.fields.get(tableId) ?? []);
  }

  async createField({ tableId, field }) {
    this.calls.createField += 1;
    const current = this.fields.get(tableId) ?? [];
    current.push(normalizeField(field, false, current.length));
    this.fields.set(tableId, current);
    return structuredClone(current.at(-1));
  }

  async listViews({ tableId }) {
    return structuredClone((this.views.get(tableId) ?? []).map(({ viewId, viewName }) => ({
      viewId,
      viewName,
    })));
  }

  async getView({ tableId, viewId }) {
    const view = (this.views.get(tableId) ?? []).find((item) => item.viewId === viewId);
    if (!view) throw new Error(`Unknown View ${viewId}`);
    return structuredClone(view);
  }

  async createView({ tableId, viewName }) {
    this.calls.createView += 1;
    const current = this.views.get(tableId) ?? [];
    const view = {
      viewId: `view_${current.length + 1}`,
      viewName,
      property: { filterInfo: null },
    };
    current.push(view);
    this.views.set(tableId, current);
    return structuredClone(view);
  }

  async updateView({ tableId, viewId, filterInfo }) {
    this.calls.updateView += 1;
    const current = this.views.get(tableId) ?? [];
    const view = current.find((item) => item.viewId === viewId);
    if (!view) throw new Error(`Unknown View ${viewId}`);
    view.property = { filterInfo: structuredClone(filterInfo) };
    return structuredClone(view);
  }
}

function normalizeField(field, primary, index = 0) {
  const property = field.property ? structuredClone(field.property) : null;
  if (Array.isArray(property?.options)) {
    property.options = property.options.map((option, optionIndex) => ({
      ...option,
      id: option.id ?? `opt_${index}_${optionIndex}_${option.name}`,
    }));
  }
  return {
    fieldId: `fld_${index}_${field.fieldName}`,
    fieldName: field.fieldName,
    type: field.type,
    uiType: field.uiType,
    description: field.description ?? '',
    isPrimary: primary,
    property,
  };
}

test('creates one icon-prefixed Notification Log table with all fields and filtered Views', async () => {
  const client = new FakeLarkClient();
  const result = await applyLarkNotificationLogSchema({ client });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'applied');
  assert.equal(result.verification.status, 'zero_drift');
  assert.equal(client.calls.createTable, 1);
  assert.equal(client.calls.createField, 0);
  assert.equal(client.calls.createView, 5);
  assert.equal(client.calls.updateView, 5);

  const [table] = await client.listTables();
  assert.equal(table.name, LARK_NOTIFICATION_LOG_TABLE_NAME);
  assert.equal(table.name.startsWith('🔔 '), true);

  const fields = await client.listFields({ tableId: table.tableId });
  assert.equal(fields.length, 15);
  assert.deepEqual(fields.map(({ fieldName }) => fieldName),
    LARK_NOTIFICATION_LOG_FIELDS.map(({ fieldName }) => fieldName));
  assert.equal(fields[0].fieldName, 'notification_attempt_key');
  assert.equal(fields[0].isPrimary, true);
  assert.deepEqual(
    fields.find(({ fieldName }) => fieldName === 'attempt_status').property.options
      .map(({ name }) => name),
    ['pending', 'sending', 'previewed', 'sent', 'deduped', 'blocked', 'failed'],
  );
  assert.deepEqual(
    fields.find(({ fieldName }) => fieldName === 'window_days').property.options
      .map(({ name }) => name),
    ['1', '3', '7', '30'],
  );

  const views = client.views.get(table.tableId);
  assert.equal(views.length, 6);
  assert.deepEqual(views.map(({ viewName }) => viewName),
    LARK_NOTIFICATION_LOG_VIEWS.map(({ viewName }) => viewName));
  assert.equal(views[0].property.filterInfo, null);
  assert.equal(views.slice(1).every(({ property }) => (
    Array.isArray(property.filterInfo?.conditions)
      && property.filterInfo.conditions.length > 0
  )), true);

  const preview = views.find(({ viewName }) => viewName === '🧪 Preview Attempts');
  assert.equal(preview.property.filterInfo.conditions[0].fieldType, 7);
  assert.deepEqual(preview.property.filterInfo.conditions[0].value, [true]);

  const pending = views.find(({ viewName }) => viewName === '⏳ Pending / Sending');
  assert.equal(pending.property.filterInfo.conjunction, 'or');
  assert.equal(pending.property.filterInfo.conditions.length, 2);
  assert.equal(pending.property.filterInfo.conditions.every(({ fieldType }) => fieldType === 3), true);
});

test('same-input replay reaches zero drift without another schema write', async () => {
  const client = new FakeLarkClient();
  await applyLarkNotificationLogSchema({ client });
  client.calls = { createTable: 0, createField: 0, createView: 0, updateView: 0 };

  const replay = await applyLarkNotificationLogSchema({ client });
  assert.equal(replay.mode, 'already_zero_drift');
  assert.deepEqual(client.calls, { createTable: 0, createField: 0, createView: 0, updateView: 0 });
});

test('blocks a legacy plain-name table instead of renaming or creating a duplicate', async () => {
  const client = new FakeLarkClient({
    tables: [{ tableId: 'tbl_legacy', name: LARK_NOTIFICATION_LOG_LEGACY_TABLE_NAME }],
  });

  await assert.rejects(
    () => planLarkNotificationLogSchema({ client }),
    (error) => error.code === 'LARK_NOTIFICATION_LOG_LEGACY_TABLE_CONFLICT',
  );
  assert.equal(client.calls.createTable, 0);
});

test('blocks conflicting existing Field types and View filters without destructive repair', async () => {
  const client = new FakeLarkClient();
  await applyLarkNotificationLogSchema({ client });
  const [table] = await client.listTables();
  client.fields.get(table.tableId)
    .find(({ fieldName }) => fieldName === 'payload_checksum').type = 2;

  await assert.rejects(
    () => planLarkNotificationLogSchema({ client }),
    (error) => error.code === 'LARK_NOTIFICATION_LOG_FIELD_TYPE_CONFLICT',
  );
});

test('HTTP guard blocks Record, rename, delete, Automation and webhook paths before fetch', async () => {
  let underlyingCalls = 0;
  const guard = createLarkNotificationLogSchemaFetchGuard(async () => {
    underlyingCalls += 1;
    return new Response(JSON.stringify({ code: 0, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const root = 'https://open.larksuite.com';
  const blocked = [
    [`${root}/open-apis/bitable/v1/apps/app/tables/tbl/records`, 'GET'],
    [`${root}/open-apis/base/v3/bases/app/tables/tbl`, 'PATCH'],
    [`${root}/open-apis/bitable/v1/apps/app/tables/tbl/fields/fld`, 'PUT'],
    [`${root}/open-apis/bitable/v1/apps/app/tables/tbl/views/view`, 'DELETE'],
    [`${root}/open-apis/bitable/v1/apps/app/automations`, 'POST'],
    [`${root}/open-apis/bot/v2/hook/secret`, 'POST'],
  ];

  for (const [url, method] of blocked) {
    await assert.rejects(
      () => guard.fetchImpl(url, { method }),
      (error) => error.code === 'LARK_NOTIFICATION_LOG_REQUEST_BLOCKED',
    );
  }
  assert.equal(underlyingCalls, 0);
  assert.equal(guard.snapshot().blocked, blocked.length);
});
