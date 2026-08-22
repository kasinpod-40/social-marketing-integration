import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibleFieldOrderNoOperationGuard } from '../../scripts/lib/lark-visible-field-order-no-operation-guard.js';

const PATH = '/open-apis/base/v3/bases/app_target/tables/tbl_target/views/viw_target/visible_fields';

class FakeTargetClient {
  constructor({ readback, putError }) {
    this.appToken = 'app_target';
    this.readback = [...readback];
    this.putError = putError;
    this.requests = [];
  }

  async requestBitableJson(path, options = {}) {
    this.requests.push({ path, options: structuredClone(options) });
    if (options.method === 'PUT' && this.putError) throw this.putError;
    if (options.method === 'GET') return { code: 0, data: [...this.readback] };
    return { code: 0, data: options?.body?.visible_fields ?? [] };
  }
}

function noOperationError() {
  const error = new Error('Lark API error 800070003: api_error: no operation produced');
  error.code = 'LARK_PERMANENT_API_ERROR';
  error.details = { larkCode: 800070003 };
  return error;
}

const STEPS = [{
  tableName: 'Content',
  viewName: 'All Content',
  targetTableId: 'tbl_target',
  targetViewId: 'viw_target',
}];

test('visible-field no-operation is accepted only when immediate readback is exact', async () => {
  const expected = ['content_key', 'platform', 'published_at'];
  const raw = new FakeTargetClient({ readback: expected, putError: noOperationError() });
  const guarded = createVisibleFieldOrderNoOperationGuard(raw, STEPS);

  const result = await guarded.client.requestBitableJson(PATH, {
    method: 'PUT',
    body: { visible_fields: expected },
  });

  assert.deepEqual(result.data, expected);
  assert.equal(result.verifiedNoOperation, true);
  assert.equal(guarded.stats.verifiedNoOperationCount, 1);
  assert.deepEqual(raw.requests.map((item) => item.options.method), ['PUT', 'GET']);
});

test('visible-field no-operation remains fail-closed when readback differs', async () => {
  const expected = ['content_key', 'platform', 'published_at'];
  const actual = ['content_key', 'published_at', 'platform'];
  const raw = new FakeTargetClient({ readback: actual, putError: noOperationError() });
  const guarded = createVisibleFieldOrderNoOperationGuard(raw, STEPS);

  await assert.rejects(
    () => guarded.client.requestBitableJson(PATH, {
      method: 'PUT',
      body: { visible_fields: expected },
    }),
    (error) => error?.code === 'VISIBLE_FIELD_ORDER_LARK_NO_OPERATION_NOT_APPLIED'
      && error?.details?.tableName === 'Content'
      && error?.details?.viewName === 'All Content'
      && error?.details?.larkCode === 800070003,
  );

  assert.equal(guarded.stats.verifiedNoOperationCount, 0);
  assert.deepEqual(raw.requests.map((item) => item.options.method), ['PUT', 'GET']);
});

test('guard does not swallow unrelated permanent Lark errors', async () => {
  const error = new Error('different failure');
  error.code = 'LARK_PERMANENT_API_ERROR';
  error.details = { larkCode: 1254001 };
  const raw = new FakeTargetClient({ readback: [], putError: error });
  const guarded = createVisibleFieldOrderNoOperationGuard(raw, STEPS);

  await assert.rejects(
    () => guarded.client.requestBitableJson(PATH, {
      method: 'PUT',
      body: { visible_fields: ['content_key'] },
    }),
    (caught) => caught === error,
  );
  assert.deepEqual(raw.requests.map((item) => item.options.method), ['PUT']);
});
