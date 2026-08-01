import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LarkBitableClient } from '../../packages/connectors/src/lark/lark-bitable.client.js';
import {
  LARK_DASHBOARD_WINDOW_DESIRED_ORDER,
  LARK_DASHBOARD_WINDOW_FIELD,
  LARK_DASHBOARD_WINDOW_OPTIONS,
  LARK_DASHBOARD_WINDOW_PRE_APPLY_ORDER,
  assertLarkDashboardWindowOptionOrderConfirmation,
  buildLarkDashboardWindowFieldMutation,
  planLarkDashboardWindowOptionOrder,
} from '../../scripts/lib/lark-dashboard-window-option-order-v1.js';

const PRE_APPLY_OPTIONS = Object.freeze([
  LARK_DASHBOARD_WINDOW_OPTIONS.find((option) => option.name === '3'),
  LARK_DASHBOARD_WINDOW_OPTIONS.find((option) => option.name === '7'),
  LARK_DASHBOARD_WINDOW_OPTIONS.find((option) => option.name === '1'),
  LARK_DASHBOARD_WINDOW_OPTIONS.find((option) => option.name === '30'),
]);

function fieldWithOptions(options) {
  return {
    fieldId: LARK_DASHBOARD_WINDOW_FIELD.fieldId,
    fieldName: LARK_DASHBOARD_WINDOW_FIELD.fieldName,
    type: LARK_DASHBOARD_WINDOW_FIELD.type,
    uiType: LARK_DASHBOARD_WINDOW_FIELD.uiType,
    description: 'จำนวนวันแบบ Inclusive; Custom range เว้นว่าง',
    property: {
      options: options.map((option) => ({ ...option })),
    },
  };
}

test('plans exact 3,7,1,30 to 1,3,7,30 reorder while preserving option IDs', () => {
  const plan = planLarkDashboardWindowOptionOrder(fieldWithOptions(PRE_APPLY_OPTIONS));

  assert.equal(plan.reorderRequired, true);
  assert.equal(plan.converged, false);
  assert.deepEqual(plan.currentOrder, LARK_DASHBOARD_WINDOW_PRE_APPLY_ORDER);
  assert.deepEqual(plan.desiredOrder, LARK_DASHBOARD_WINDOW_DESIRED_ORDER);
  assert.deepEqual(
    new Set(plan.currentOptionIds),
    new Set(plan.desiredOptionIds),
  );
  assert.deepEqual(
    plan.desiredOptions.map((option) => option.name),
    ['1', '3', '7', '30'],
  );
  assert.deepEqual(
    plan.desiredOptions.map((option) => option.id),
    ['opt38OJLF0', 'optGqbHePA', 'optaGcj0mG', 'optmG5Z7M0'],
  );
});

test('accepts the converged 1,3,7,30 state without another mutation', () => {
  const plan = planLarkDashboardWindowOptionOrder(
    fieldWithOptions(LARK_DASHBOARD_WINDOW_OPTIONS),
  );

  assert.equal(plan.reorderRequired, false);
  assert.equal(plan.converged, true);
  assert.deepEqual(plan.currentOrder, ['1', '3', '7', '30']);
});

test('builds a full field update that preserves identity, description, IDs, names and colors', () => {
  const plan = planLarkDashboardWindowOptionOrder(fieldWithOptions(PRE_APPLY_OPTIONS));
  const mutation = buildLarkDashboardWindowFieldMutation(plan);

  assert.equal(mutation.fieldName, LARK_DASHBOARD_WINDOW_FIELD.fieldName);
  assert.equal(mutation.type, 3);
  assert.equal(mutation.uiType, 'SingleSelect');
  assert.equal(mutation.description, 'จำนวนวันแบบ Inclusive; Custom range เว้นว่าง');
  assert.deepEqual(mutation.property.options, [
    { id: 'opt38OJLF0', name: '1', color: 2 },
    { id: 'optGqbHePA', name: '3', color: 0 },
    { id: 'optaGcj0mG', name: '7', color: 1 },
    { id: 'optmG5Z7M0', name: '30', color: 3 },
  ]);
});

test('Lark client serializes the exact full PUT body without dropping option IDs or order', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/tenant_access_token/internal')) {
      return new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 7200,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      code: 0,
      msg: 'success',
      data: {
        field: {
          field_id: LARK_DASHBOARD_WINDOW_FIELD.fieldId,
          field_name: LARK_DASHBOARD_WINDOW_FIELD.fieldName,
          type: 3,
          ui_type: 'SingleSelect',
          description: { text: 'จำนวนวันแบบ Inclusive; Custom range เว้นว่าง' },
          property: { options: LARK_DASHBOARD_WINDOW_OPTIONS },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'base-token',
    fetchImpl,
    minRequestIntervalMs: 0,
    maxAttempts: 1,
  });
  const plan = planLarkDashboardWindowOptionOrder(fieldWithOptions(PRE_APPLY_OPTIONS));
  const mutation = buildLarkDashboardWindowFieldMutation(plan);

  await client.updateField({
    tableId: 'tbl7rJypEU2ryAcr',
    fieldId: LARK_DASHBOARD_WINDOW_FIELD.fieldId,
    field: mutation,
  });

  assert.equal(requests.length, 2);
  const request = requests[1];
  assert.equal(request.options.method, 'PUT');
  assert.match(
    request.url,
    /\/fields\/fldMlTUP3Z$/u,
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    field_name: LARK_DASHBOARD_WINDOW_FIELD.fieldName,
    type: 3,
    ui_type: 'SingleSelect',
    description: { text: 'จำนวนวันแบบ Inclusive; Custom range เว้นว่าง' },
    property: {
      options: [
        { id: 'opt38OJLF0', name: '1', color: 2 },
        { id: 'optGqbHePA', name: '3', color: 0 },
        { id: 'optaGcj0mG', name: '7', color: 1 },
        { id: 'optmG5Z7M0', name: '30', color: 3 },
      ],
    },
  });
});

test('rejects unexpected order instead of guessing', () => {
  const unexpected = [
    LARK_DASHBOARD_WINDOW_OPTIONS[0],
    LARK_DASHBOARD_WINDOW_OPTIONS[2],
    LARK_DASHBOARD_WINDOW_OPTIONS[1],
    LARK_DASHBOARD_WINDOW_OPTIONS[3],
  ];

  assert.throws(
    () => planLarkDashboardWindowOptionOrder(fieldWithOptions(unexpected)),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_OPTION_ORDER_STATE_DRIFT',
  );
});

test('rejects changed option IDs, names, colors, extras and missing options', () => {
  const cases = [
    PRE_APPLY_OPTIONS.map((option, index) => index === 0
      ? { ...option, id: 'optChanged' }
      : option),
    PRE_APPLY_OPTIONS.map((option, index) => index === 0
      ? { ...option, name: '03' }
      : option),
    PRE_APPLY_OPTIONS.map((option, index) => index === 0
      ? { ...option, color: 9 }
      : option),
    [...PRE_APPLY_OPTIONS, { id: 'optExtra', name: '90', color: 4 }],
    PRE_APPLY_OPTIONS.slice(0, 3),
  ];

  for (const options of cases) {
    assert.throws(
      () => planLarkDashboardWindowOptionOrder(fieldWithOptions(options)),
      (error) => error.code === 'LARK_DASHBOARD_WINDOW_OPTIONS_INVALID',
    );
  }
});

test('requires the exact one-time confirmation', () => {
  assert.throws(
    () => assertLarkDashboardWindowOptionOrderConfirmation('wrong'),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_OPTION_ORDER_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertLarkDashboardWindowOptionOrderConfirmation(
      'REORDER_WINDOW_OPTIONS_PRESERVE_IDS_1_3_7_30',
    ),
    true,
  );
});

test('operator exposes only one field update path and no Record or Dashboard mutation path', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-dashboard-window-option-order.mjs', import.meta.url),
    'utf8',
  );

  assert.equal((source.match(/client\.updateField\(/gu) ?? []).length, 1);
  assert.equal(source.includes('batchUpdateRecords('), false);
  assert.equal(source.includes('createField('), false);
  assert.equal(source.includes('deleteField('), false);
  assert.equal(source.includes('updateView('), false);
  assert.equal(source.includes('/dashboards'), false);
  assert.equal(source.includes('current_value'), false);
  assert.equal(source.includes('fieldMetadataMutationCount: 1'), true);
  assert.equal(source.includes('recordMutationCount: 0'), true);
  assert.equal(source.includes('dashboardPatchCount: 0'), true);
});
