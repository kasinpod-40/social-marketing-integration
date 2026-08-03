import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyLarkNativeAiSchemaAdditive,
  assertAcceptedLarkNativeAiSchemaApplyEvidence,
  planLarkNativeAiSchemaAdditiveApply,
} from '../../packages/application/src/reports/apply-lark-native-ai-schema.js';
import {
  LARK_NATIVE_AI_TARGET_TABLE,
  buildLarkNativeAiSchemaPreview,
} from '../../packages/config/src/lark-native-ai-schema-preview.js';
import {
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_EVIDENCE_CONTRACT,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
} from '../../packages/config/src/lark-native-ai-schema-apply-contract.js';

const inventory = JSON.parse(readFileSync(new URL(
  '../fixtures/lark-native-ai-schema-apply-accepted-inventory.json',
  import.meta.url,
), 'utf8'));

function acceptedEvidence() {
  return {
    ok: true,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_EVIDENCE_CONTRACT,
    repository: {
      branch: 'main',
      head: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
      reviewedHead: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
      clean: true,
    },
    baseIdentityHash: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
    inventory: structuredClone(inventory),
    preview: buildLarkNativeAiSchemaPreview({ inventory }),
    remote: {
      tokenRequestCount: 1,
      metadataReadCount: 3,
      blockedRequestCount: 0,
    },
    safety: {
      persistedRemoteIds: 0,
      recordReadCount: 0,
      remoteLarkWriteCount: 0,
      automationCreateCount: 0,
      notificationSendCount: 0,
      aiCallCount: 0,
      remoteD1QueueWorkerProviderCount: 0,
      applyAuthorized: false,
      production: 'BLOCKED',
    },
  };
}

test('accepts only the exact retained 72-table inventory authority', async () => {
  const accepted = await assertAcceptedLarkNativeAiSchemaApplyEvidence(
    acceptedEvidence(),
  );
  assert.equal(
    accepted.inventorySha256,
    LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
  );
  assert.equal(accepted.preview.status, 'ready_to_apply');
  assert.equal(accepted.preview.actions.length, 31);

  const drifted = acceptedEvidence();
  drifted.inventory.tables[0].tableName = 'unexpected';
  await assert.rejects(
    assertAcceptedLarkNativeAiSchemaApplyEvidence(drifted),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_INVENTORY_HASH_MISMATCH',
  );
});

test('applies exact 31 logical actions and replays to zero remote writes', async () => {
  const client = new FakeLarkClient(inventory);
  const result = await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'apply');
  assert.equal(result.plannedLogicalActionCount, 31);
  assert.equal(result.appliedLogicalActionCount, 31);
  assert.equal(result.verification.status, 'zero_drift');
  assert.deepEqual(client.writeCounts, {
    fieldCreate: 23,
    fieldUpdate: 2,
    viewCreate: 6,
    viewUpdate: 5,
  });

  client.resetWriteCounts();
  const replay = await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });
  assert.equal(replay.mode, 'already_zero_drift');
  assert.equal(replay.appliedLogicalActionCount, 0);
  assert.deepEqual(client.writeCounts, {
    fieldCreate: 0,
    fieldUpdate: 0,
    viewCreate: 0,
    viewUpdate: 0,
  });
});

test('resumes a partial View phase without repeating completed Field actions', async () => {
  const client = new FakeLarkClient(inventory);
  await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });

  const required = new Set([
    '🌐 All Channel Readiness',
    '📊 Executive Summaries',
    '⚠️ Missing / Partial Data',
    '✅ Notification Eligible',
    '❌ AI Generation Failures',
    '🧪 Preview Runs',
  ]);
  const keepEmpty = '📊 Executive Summaries';
  client.views = client.views.filter((view) => (
    !required.has(view.viewName) || view.viewName === keepEmpty
  ));
  client.views.find(({ viewName }) => viewName === keepEmpty).property.filterInfo = null;
  client.resetWriteCounts();

  const plan = await planLarkNativeAiSchemaAdditiveApply({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });
  assert.equal(plan.status, 'resume_ready');
  assert.equal(plan.remainingLogicalActionCount, 6);

  const resumed = await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });
  assert.equal(resumed.mode, 'resume_apply');
  assert.equal(resumed.appliedLogicalActionCount, 6);
  assert.equal(resumed.verification.status, 'zero_drift');
  assert.deepEqual(client.writeCounts, {
    fieldCreate: 0,
    fieldUpdate: 0,
    viewCreate: 5,
    viewUpdate: 5,
  });
});

test('blocks a conflicting existing required View before any remote write', async () => {
  const client = new FakeLarkClient(inventory);
  await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });
  const view = client.views.find(({ viewName }) => viewName === '📊 Executive Summaries');
  view.property.filterInfo = {
    conjunction: 'and',
    conditions: [{
      fieldId: client.fields.find(({ fieldName }) => fieldName === 'scope_type').fieldId,
      fieldType: 3,
      operator: 'isNot',
      value: JSON.stringify(['executive']),
    }],
  };
  client.resetWriteCounts();

  await assert.rejects(
    planLarkNativeAiSchemaAdditiveApply({
      client,
      retainedEvidence: acceptedEvidence(),
      baseName: null,
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT',
  );
  assert.deepEqual(client.writeCounts, {
    fieldCreate: 0,
    fieldUpdate: 0,
    viewCreate: 0,
    viewUpdate: 0,
  });
});

test('includes View name in filter PATCH and retains only sanitized remote diagnostics', async () => {
  const client = new FakeLarkClient(inventory);
  await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: acceptedEvidence(),
    baseName: null,
  });

  const view = client.views.find(({ viewName }) => viewName === '📊 Executive Summaries');
  view.property.filterInfo = null;
  client.updateView = async ({ tableId, viewId, viewName, filterInfo }) => {
    assert.equal(tableId, client.tableId);
    assert.equal(viewId, view.viewId);
    assert.equal(viewName, view.viewName);
    assert.equal(filterInfo.conditions.length, 1);
    const error = new Error('Lark API error 1254001: WrongRequestBody');
    error.code = 'LARK_PERMANENT_API_ERROR';
    error.details = {
      status: 400,
      larkCode: 1254001,
      viewMutationBody: {
        view_name: viewName,
        property: {
          filter_info: {
            conjunction: filterInfo.conjunction,
            conditions: [{
              field_id: 'fld_sensitive_identity',
              operator: 'is',
              value: JSON.stringify(['executive']),
            }],
          },
        },
      },
    };
    throw error;
  };

  await assert.rejects(
    applyLarkNativeAiSchemaAdditive({
      client,
      retainedEvidence: acceptedEvidence(),
      baseName: null,
    }),
    (error) => {
      assert.equal(error?.code, 'LARK_NATIVE_AI_SCHEMA_APPLY_REMOTE_ACTION_FAILED');
      assert.equal(error.details.causeStatus, 400);
      assert.equal(error.details.causeLarkCode, 1254001);
      assert.deepEqual(error.details.viewMutation, {
        hasViewName: true,
        hasFilterInfo: true,
        conjunction: 'and',
        conditionCount: 1,
        operators: ['is'],
      });
      const serialized = JSON.stringify(error.details);
      assert.doesNotMatch(serialized, /fld_sensitive_identity|executive|viewMutationBody/u);
      return true;
    },
  );
});

test('blocks option drift outside the accepted additive authority', async () => {
  const client = new FakeLarkClient(inventory);
  client.fields
    .find(({ fieldName }) => fieldName === 'platforms')
    .property.options.push({ id: 'opt_unexpected', name: 'unexpected', color: 0 });

  await assert.rejects(
    planLarkNativeAiSchemaAdditiveApply({
      client,
      retainedEvidence: acceptedEvidence(),
      baseName: null,
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_OPTION_DRIFT',
  );
});

class FakeLarkClient {
  constructor(sourceInventory) {
    this.tableId = 'tbl_target_ai';
    this.tables = sourceInventory.tables.map((table, index) => ({
      tableId: table.tableName === LARK_NATIVE_AI_TARGET_TABLE
        ? this.tableId
        : `tbl_${String(index).padStart(3, '0')}`,
      name: table.tableName,
      revision: table.tableName === LARK_NATIVE_AI_TARGET_TABLE ? 0 : null,
    }));
    const target = sourceInventory.tables.find(
      ({ tableName }) => table.tableName === LARK_NATIVE_AI_TARGET_TABLE,
    );
    this.fields = target.fields.map((field, index) => toRawField(field, index));
    this.views = target.views.map((view, index) => ({
      viewId: `vew_existing_${index}`,
      viewName: view.viewName,
      viewType: 'grid',
      property: { hiddenFields: [], filterInfo: null },
    }));
    this.sequence = 1000;
    this.resetWriteCounts();
  }

  async listTables() {
    return structuredClone(this.tables);
  }

  async listFields({ tableId }) {
    assert.equal(tableId, this.tableId);
    return structuredClone(this.fields);
  }

  async listViews({ tableId }) {
    assert.equal(tableId, this.tableId);
    return structuredClone(this.views);
  }

  async getView({ tableId, viewId }) {
    assert.equal(tableId, this.tableId);
    const view = this.views.find((entry) => entry.viewId === viewId);
    assert.ok(view);
    return structuredClone(view);
  }

  async createField({ tableId, field }) {
    assert.equal(tableId, this.tableId);
    this.writeCounts.fieldCreate += 1;
    const created = {
      fieldId: `fld_created_${this.sequence++}`,
      fieldName: field.fieldName,
      type: field.type,
      uiType: field.uiType,
      description: field.description ?? '',
      property: field.property ? structuredClone(field.property) : null,
    };
    if (created.property?.options) {
      created.property.options = created.property.options.map((option, index) => ({
        id: `opt_created_${this.sequence}_${index}`,
        ...option,
      }));
    }
    this.fields.push(created);
    return structuredClone(created);
  }

  async updateField({ tableId, fieldId, field }) {
    assert.equal(tableId, this.tableId);
    this.writeCounts.fieldUpdate += 1;
    const index = this.fields.findIndex((entry) => entry.fieldId === fieldId);
    assert.notEqual(index, -1);
    this.fields[index] = {
      ...this.fields[index],
      fieldName: field.fieldName,
      type: field.type,
      uiType: field.uiType,
      description: field.description ?? '',
      property: structuredClone(field.property ?? null),
    };
    return structuredClone(this.fields[index]);
  }

  async createView({ tableId, viewName, viewType }) {
    assert.equal(tableId, this.tableId);
    this.writeCounts.viewCreate += 1;
    const created = {
      viewId: `vew_created_${this.sequence++}`,
      viewName,
      viewType,
      property: { hiddenFields: [], filterInfo: null },
    };
    this.views.push(created);
    return structuredClone(created);
  }

  async updateView({ tableId, viewId, viewName, filterInfo }) {
    assert.equal(tableId, this.tableId);
    this.writeCounts.viewUpdate += 1;
    const view = this.views.find((entry) => entry.viewId === viewId);
    assert.ok(view);
    assert.equal(viewName, view.viewName);
    view.property.filterInfo = {
      conjunction: filterInfo.conjunction,
      conditions: filterInfo.conditions.map((condition) => ({
        fieldId: condition.fieldId,
        fieldType: condition.fieldType,
        operator: condition.operator,
        value: JSON.stringify(condition.value),
      })),
    };
    return structuredClone(view);
  }

  resetWriteCounts() {
    this.writeCounts = {
      fieldCreate: 0,
      fieldUpdate: 0,
      viewCreate: 0,
      viewUpdate: 0,
    };
  }
}

function toRawField(field, index) {
  const contract = ({
    Text: { type: 1, uiType: 'Text' },
    Number: { type: 2, uiType: 'Number' },
    SingleSelect: { type: 3, uiType: 'SingleSelect' },
    MultiSelect: { type: 4, uiType: 'MultiSelect' },
    DateTime: { type: 5, uiType: 'DateTime' },
    Checkbox: { type: 7, uiType: 'Checkbox' },
  })[field.fieldType];
  return {
    fieldId: `fld_existing_${index}`,
    fieldName: field.fieldName,
    type: contract.type,
    uiType: contract.uiType,
    description: '',
    property: Array.isArray(field.options)
      ? {
        options: field.options.map((name, optionIndex) => ({
          id: `opt_existing_${index}_${optionIndex}`,
          name,
          color: optionIndex % 10,
        })),
      }
      : null,
  };
}
