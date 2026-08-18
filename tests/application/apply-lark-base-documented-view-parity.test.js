import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLarkBaseDocumentedViewParity } from '../../packages/application/src/use-cases/apply-lark-base-documented-view-parity.js';

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
