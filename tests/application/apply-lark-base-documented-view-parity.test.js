import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION,
  applyLarkBaseDocumentedViewParity,
  applyLarkBaseDocumentedVisibleFieldOrderParity,
  planLarkBaseDocumentedVisibleFieldOrderParity,
} from '../../packages/application/src/use-cases/apply-lark-base-documented-view-parity.js';

class SourceClient {
  async listTables() {
    return [{ tableId: 'src_tbl', name: 'Accounts' }];
  }
  async listFields() {
    return [
      { fieldId: 'src_key', fieldName: 'account_key', isPrimary: true },
      { fieldId: 'src_parent', fieldName: 'parent_account' },
    ];
  }
  async listViews() {
    return [{ viewId: 'src_view', viewName: 'Hierarchy', viewType: 'grid' }];
  }
  async getView() {
    return {
      viewId: 'src_view',
      viewName: 'Hierarchy',
      viewType: 'grid',
      property: { hierarchyConfig: { fieldId: 'src_parent' } },
    };
  }
}

class TargetClient {
  constructor(initialFieldId = null) {
    this.hierarchyFieldId = initialFieldId;
    this.updates = [];
  }
  async listTables() {
    return [
      { tableId: 'customer_old', name: 'Customer Notes' },
      { tableId: 'target_tbl', name: 'Accounts' },
    ];
  }
  async listFields({ tableId }) {
    assert.equal(tableId, 'target_tbl');
    return [
      { fieldId: 'target_key', fieldName: 'account_key', isPrimary: true },
      { fieldId: 'target_parent', fieldName: 'parent_account' },
    ];
  }
  async listViews({ tableId }) {
    assert.equal(tableId, 'target_tbl');
    return [{ viewId: 'target_view', viewName: 'Hierarchy', viewType: 'grid' }];
  }
  async getViewHierarchy({ tableId, viewId }) {
    assert.equal(tableId, 'target_tbl');
    assert.equal(viewId, 'target_view');
    return { fieldId: this.hierarchyFieldId };
  }
  async updateViewHierarchy(input) {
    this.updates.push(structuredClone(input));
    this.hierarchyFieldId = input.fieldId;
    return {};
  }
}

test('documented View parity remaps hierarchy field by name, writes once and verifies read-back', async () => {
  const targetClient = new TargetClient();
  const result = await applyLarkBaseDocumentedViewParity({
    sourceClient: new SourceClient(),
    targetClient,
    expectedTableNames: ['Accounts'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.representedHierarchyViews, 1);
  assert.equal(result.updatedHierarchyViews, 1);
  assert.equal(result.verifiedHierarchyViews, 1);
  assert.deepEqual(targetClient.updates, [{
    tableId: 'target_tbl',
    viewId: 'target_view',
    viewName: 'Hierarchy',
    fieldId: 'target_parent',
  }]);
});

test('documented View parity is idempotent when hierarchy mapping already matches', async () => {
  const targetClient = new TargetClient('target_parent');
  const result = await applyLarkBaseDocumentedViewParity({
    sourceClient: new SourceClient(),
    targetClient,
    expectedTableNames: ['Accounts'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.updatedHierarchyViews, 0);
  assert.equal(result.verifiedHierarchyViews, 1);
  assert.deepEqual(targetClient.updates, []);
});

test('documented View parity fails closed when hierarchy read-back does not persist', async () => {
  class NonPersistingTarget extends TargetClient {
    async updateViewHierarchy(input) {
      this.updates.push(structuredClone(input));
      return {};
    }
  }
  const targetClient = new NonPersistingTarget();
  const result = await applyLarkBaseDocumentedViewParity({
    sourceClient: new SourceClient(),
    targetClient,
    expectedTableNames: ['Accounts'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((item) => item.code === 'DOCUMENTED_VIEW_PARITY_HIERARCHY_READBACK_MISMATCH'));
  assert.equal(result.verifiedHierarchyViews, 0);
});

class VisibleOrderSourceClient {
  async listTables() {
    return [{ tableId: 'src_tbl', name: 'Content' }];
  }
  async listFields() {
    return [
      { fieldId: 'src_key', fieldName: 'content_key', isPrimary: true },
      { fieldId: 'src_platform', fieldName: 'platform' },
      { fieldId: 'src_internal', fieldName: 'internal_note' },
      { fieldId: 'src_date', fieldName: 'published_at' },
    ];
  }
  async listViews() {
    return [{ viewId: 'src_view', viewName: 'All Content', viewType: 'grid' }];
  }
  async getView() {
    return {
      viewId: 'src_view',
      viewName: 'All Content',
      viewType: 'grid',
      property: {
        fieldOrder: ['src_key', 'src_platform', 'src_internal', 'src_date'],
        hiddenFields: ['src_internal'],
      },
    };
  }
}

class VisibleOrderTargetClient {
  constructor({ initial = ['target_key', 'target_date', 'target_platform'], transformAfterPut = null } = {}) {
    this.appToken = 'app_target';
    this.visibleFields = [...initial];
    this.transformAfterPut = transformAfterPut;
    this.puts = [];
  }
  async listTables() {
    return [
      { tableId: 'customer_tbl', name: 'Customer Notes' },
      { tableId: 'target_tbl', name: 'Content' },
    ];
  }
  async listFields({ tableId }) {
    assert.equal(tableId, 'target_tbl');
    return [
      { fieldId: 'target_key', fieldName: 'content_key', isPrimary: true },
      { fieldId: 'target_platform', fieldName: 'platform' },
      { fieldId: 'target_internal', fieldName: 'internal_note' },
      { fieldId: 'target_date', fieldName: 'published_at' },
    ];
  }
  async listViews({ tableId }) {
    assert.equal(tableId, 'target_tbl');
    return [{ viewId: 'target_view', viewName: 'All Content', viewType: 'grid' }];
  }
  async requestBitableJson(path, options = {}) {
    assert.equal(path, '/open-apis/base/v3/bases/app_target/tables/target_tbl/views/target_view/visible_fields');
    if (options.method === 'GET') {
      return { code: 0, data: { visible_fields: [...this.visibleFields] } };
    }
    if (options.method === 'PUT') {
      const requested = [...options.body.visible_fields];
      this.puts.push(requested);
      this.visibleFields = this.transformAfterPut
        ? [...this.transformAfterPut(requested, this.puts.length)]
        : requested;
      return { code: 0, data: { visible_fields: [...this.visibleFields] } };
    }
    throw new Error(`unexpected request ${options.method} ${path}`);
  }
}

test('visible-field order plan detects order drift without changing hidden membership', async () => {
  const targetClient = new VisibleOrderTargetClient();
  const result = await planLarkBaseDocumentedVisibleFieldOrderParity({
    sourceClient: new VisibleOrderSourceClient(),
    targetClient,
    expectedTableNames: ['Content'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.representedViews, 1);
  assert.equal(result.exactViews, 0);
  assert.equal(result.mismatchedViews, 1);
  assert.deepEqual(result.steps[0].beforeVisibleFields, ['content_key', 'published_at', 'platform']);
  assert.deepEqual(result.steps[0].desiredVisibleFields, ['content_key', 'platform', 'published_at']);
  assert.deepEqual(targetClient.puts, []);
});

test('visible-field order apply uses documented visible_fields PUT and verifies exact ordered readback', async () => {
  const targetClient = new VisibleOrderTargetClient();
  const result = await applyLarkBaseDocumentedVisibleFieldOrderParity({
    confirmation: CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION,
    sourceClient: new VisibleOrderSourceClient(),
    targetClient,
    expectedTableNames: ['Content'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.updatedViews, 1);
  assert.equal(result.verifiedExactViews, 1);
  assert.equal(result.remoteMutationCount, 1);
  assert.deepEqual(targetClient.puts, [['target_key', 'target_platform', 'target_date']]);
  assert.deepEqual(targetClient.visibleFields, ['target_key', 'target_platform', 'target_date']);
});

test('visible-field order preflight blocks membership drift before any write', async () => {
  const targetClient = new VisibleOrderTargetClient({ initial: ['target_key', 'target_date'] });
  const result = await planLarkBaseDocumentedVisibleFieldOrderParity({
    sourceClient: new VisibleOrderSourceClient(),
    targetClient,
    expectedTableNames: ['Content'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.mismatchedViews, 0);
  assert.ok(result.blockers.some((item) => item.code === 'VISIBLE_FIELD_ORDER_MEMBERSHIP_DRIFT'));
  assert.deepEqual(targetClient.puts, []);
});

test('visible-field order apply rolls back if ordered readback does not persist', async () => {
  const initial = ['target_key', 'target_date', 'target_platform'];
  const targetClient = new VisibleOrderTargetClient({
    initial,
    transformAfterPut: (requested, putCount) => putCount === 1 ? [...requested].reverse() : requested,
  });

  await assert.rejects(
    () => applyLarkBaseDocumentedVisibleFieldOrderParity({
      confirmation: CUSTOMER_BASE_VISIBLE_FIELD_ORDER_CONFIRMATION,
      sourceClient: new VisibleOrderSourceClient(),
      targetClient,
      expectedTableNames: ['Content'],
    }),
    (error) => error?.code === 'VISIBLE_FIELD_ORDER_APPLY_FAILED_ROLLED_BACK'
      && error?.details?.changedViewCount === 1
      && error?.details?.rollbackMutationCount === 1,
  );

  assert.deepEqual(targetClient.puts, [
    ['target_key', 'target_platform', 'target_date'],
    initial,
  ]);
  assert.deepEqual(targetClient.visibleFields, initial);
});
