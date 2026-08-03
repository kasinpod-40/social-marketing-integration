import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyLarkNativeAiSchemaAdditive,
} from '../../packages/application/src/reports/apply-lark-native-ai-schema.js';
import {
  buildLarkNativeAiSchemaPreview,
  LARK_NATIVE_AI_TARGET_TABLE,
} from '../../packages/config/src/lark-native-ai-schema-preview.js';
import {
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_EVIDENCE_CONTRACT,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
} from '../../packages/config/src/lark-native-ai-schema-apply-contract.js';

const inventory = JSON.parse(readFileSync(new URL(
  '../fixtures/lark-native-ai-schema-apply-accepted-inventory.json',
  import.meta.url,
), 'utf8'));

function evidence() {
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
    remote: { tokenRequestCount: 1, metadataReadCount: 3, blockedRequestCount: 0 },
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

test('resume Apply sends live Select option IDs and never repeats completed Field writes', async () => {
  const client = new PartialRemoteClient(inventory);
  const result = await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence: evidence(),
    baseName: null,
  });

  assert.equal(result.mode, 'resume_apply');
  assert.equal(result.plannedLogicalActionCount, 5);
  assert.equal(result.appliedLogicalActionCount, 5);
  assert.equal(result.verification.status, 'zero_drift');
  assert.deepEqual(client.writeCounts, {
    fieldCreate: 0,
    fieldUpdate: 0,
    viewCreate: 4,
    viewUpdate: 5,
  });

  const executive = client.viewPatchBodies.find(({ viewName }) => viewName === '📊 Executive Summaries');
  assert.deepEqual(executive.filterInfo.conditions[0].value, ['opt_scope_executive']);
  assert.equal(executive.filterInfo.conditions[0].value.includes('executive'), false);

  const notification = client.viewPatchBodies.find(({ viewName }) => viewName === '✅ Notification Eligible');
  const checkboxValues = notification.filterInfo.conditions.map(({ value }) => value[0]);
  assert.ok(checkboxValues.includes(true));
  assert.ok(checkboxValues.includes(false));
});

class PartialRemoteClient {
  constructor(sourceInventory) {
    this.tableId = 'tbl_target_ai';
    this.sequence = 1000;
    this.tables = sourceInventory.tables.map((table, index) => ({
      tableId: table.tableName === LARK_NATIVE_AI_TARGET_TABLE
        ? this.tableId
        : `tbl_${index}`,
      name: table.tableName,
      revision: 0,
    }));
    const target = sourceInventory.tables.find(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);
    this.fields = target.fields.map((field, index) => toRawField(field, `existing_${index}`));

    const preview = buildLarkNativeAiSchemaPreview({ inventory: sourceInventory });
    for (const action of preview.actions.filter(({ action }) => action === 'add_field')) {
      this.fields.push(toRawField({
        fieldName: action.fieldName,
        fieldType: action.fieldType,
        ...(action.options ? { options: action.options } : {}),
      }, `created_${this.sequence++}`));
    }
    for (const action of preview.actions.filter(({ action }) => action === 'extend_select_options')) {
      const field = this.fields.find(({ fieldName }) => fieldName === action.fieldName);
      for (const name of action.optionsToAdd) {
        field.property.options.push({
          id: `opt_${action.fieldName}_${name}`,
          name,
          color: field.property.options.length % 10,
        });
      }
    }

    this.views = target.views.map((view, index) => rawView(`vew_existing_${index}`, view.viewName));
    this.views.push(rawView('vew_all_channel', '🌐 All Channel Readiness'));
    this.views.push(rawView('vew_executive', '📊 Executive Summaries'));
    this.writeCounts = { fieldCreate: 0, fieldUpdate: 0, viewCreate: 0, viewUpdate: 0 };
    this.viewPatchBodies = [];
  }

  async listTables() { return structuredClone(this.tables); }
  async listFields({ tableId }) { assert.equal(tableId, this.tableId); return structuredClone(this.fields); }
  async listViews({ tableId }) { assert.equal(tableId, this.tableId); return structuredClone(this.views); }
  async getView({ tableId, viewId }) {
    assert.equal(tableId, this.tableId);
    return structuredClone(this.views.find((view) => view.viewId === viewId));
  }
  async createField() { this.writeCounts.fieldCreate += 1; throw new Error('Field create must not run'); }
  async updateField() { this.writeCounts.fieldUpdate += 1; throw new Error('Field update must not run'); }
  async createView({ tableId, viewName, viewType }) {
    assert.equal(tableId, this.tableId);
    this.writeCounts.viewCreate += 1;
    const view = rawView(`vew_created_${this.sequence++}`, viewName, viewType);
    this.views.push(view);
    return structuredClone(view);
  }
  async updateView({ tableId, viewId, filterInfo }) {
    assert.equal(tableId, this.tableId);
    this.writeCounts.viewUpdate += 1;
    const view = this.views.find((item) => item.viewId === viewId);
    view.property.filterInfo = {
      conjunction: filterInfo.conjunction,
      conditions: filterInfo.conditions.map((condition) => ({
        fieldId: condition.fieldId,
        fieldType: condition.fieldType,
        operator: condition.operator,
        value: JSON.stringify(condition.value),
      })),
    };
    this.viewPatchBodies.push({ viewName: view.viewName, filterInfo: structuredClone(filterInfo) });
    return structuredClone(view);
  }
}

function rawView(viewId, viewName, viewType = 'grid') {
  return {
    viewId,
    viewName,
    viewType,
    property: { hiddenFields: [], filterInfo: null },
  };
}

function toRawField(field, identity) {
  const type = ({ Text: 1, Number: 2, SingleSelect: 3, MultiSelect: 4, DateTime: 5, Checkbox: 7 })[field.fieldType];
  const uiType = field.fieldType;
  return {
    fieldId: `fld_${identity}`,
    fieldName: field.fieldName,
    type,
    uiType,
    description: '',
    property: Array.isArray(field.options)
      ? {
        options: field.options.map((name, index) => ({
          id: `opt_${field.fieldName}_${name}`,
          name,
          color: index % 10,
        })),
      }
      : null,
  };
}
