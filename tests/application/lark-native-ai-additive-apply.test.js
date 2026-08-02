import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLarkNativeAiAdditiveSchema,
  assertLiveTargetIsMonotonic,
  LARK_NATIVE_AI_REMOTE_EVIDENCE_VERSION,
  validateLarkNativeAiRemoteInventoryEvidence,
} from '../../packages/application/src/reports/apply-lark-native-ai-additive-schema.js';
import { collectLarkNativeAiSchemaInventory } from '../../packages/application/src/reports/collect-lark-native-ai-schema-inventory.js';
import { LARK_NATIVE_AI_TARGET_TABLE } from '../../packages/config/src/lark-native-ai-schema-preview.js';

const TYPE_IDS = Object.freeze({ Text: 1, Number: 2, SingleSelect: 3, MultiSelect: 4, DateTime: 5, Checkbox: 7 });

const ORIGINAL_FIELDS = Object.freeze([
  field('compare_end', 'DateTime'),
  field('compare_start', 'DateTime'),
  field('comparison_mode', 'SingleSelect', ['custom_range', 'none', 'previous_period', 'year_over_year']),
  field('course_filter', 'Text'),
  field('insight_summary', 'Text'),
  field('metric_summary_json', 'Text'),
  field('period_end', 'DateTime'),
  field('period_start', 'DateTime'),
  field('platforms', 'MultiSelect', ['facebook', 'google_ads', 'instagram', 'meta_ads', 'tiktok', 'tiktok_ads', 'youtube']),
  field('recommendations', 'Text'),
  field('report_id', 'Text'),
  field('report_type', 'SingleSelect', [
    'ads_performance_report', 'course_campaign_report', 'executive_summary_report',
    'monthly_organic_report', 'platform_strength_weakness_report', 'top_content_report',
    'weekly_organic_report', 'yoy_report',
  ]),
  field('sent_at', 'DateTime'),
  field('sent_to_group', 'Checkbox'),
  field('strengths', 'Text'),
  field('weaknesses', 'Text'),
]);

const ORIGINAL_VIEWS = Object.freeze([
  '📅 Daily Reports', '📆 Monthly Reports', '🕘 Latest Reports', '🗓️ Weekly Reports', '🧾 Yearly Reports',
]);

test('applies the reviewed 31 additive actions and converges to zero drift', async () => {
  const client = new FakeLarkClient();
  const evidence = await buildEvidence(client);
  assert.equal(evidence.preview.counts.totalActions, 31);

  const result = await applyLarkNativeAiAdditiveSchema({ client, evidence });
  assert.equal(result.ok, true);
  assert.equal(result.counts.completed, 31);
  assert.equal(result.replay.status, 'zero_drift');
  assert.equal(client.stats.createField, 23);
  assert.equal(client.stats.updateField, 2);
  assert.equal(client.stats.createView, 6);
  assert.equal(client.stats.updateView, 5);
  assert.equal(client.stats.recordRead, 0);

  const writesBeforeReplay = { ...client.stats };
  const replay = await applyLarkNativeAiAdditiveSchema({ client, evidence });
  assert.equal(replay.replay.status, 'zero_drift');
  assert.equal(client.stats.createField, writesBeforeReplay.createField);
  assert.equal(client.stats.updateField, writesBeforeReplay.updateField);
  assert.equal(client.stats.createView, writesBeforeReplay.createView);
  assert.equal(client.stats.updateView, writesBeforeReplay.updateView);
});

test('accepts an exact monotonic partial state for safe resume', async () => {
  const client = new FakeLarkClient();
  const evidence = await buildEvidence(client);
  const first = evidence.preview.actions.find(({ action }) => action === 'add_field');
  await client.createField({ tableId: 'tbl-ai', field: mutationFromAction(first) });
  const live = await collectLarkNativeAiSchemaInventory({ client });
  assert.equal(assertLiveTargetIsMonotonic(evidence, live), true);
  const result = await applyLarkNativeAiAdditiveSchema({ client, evidence });
  assert.equal(result.replay.status, 'zero_drift');
  assert.equal(client.stats.createField, 23);
});

test('blocks unexpected target drift before any schema write', async () => {
  const client = new FakeLarkClient();
  const evidence = await buildEvidence(client);
  client.fields.push(rawField('unexpected_field', 'Text'));
  await assert.rejects(
    () => applyLarkNativeAiAdditiveSchema({ client, evidence }),
    (error) => error.code === 'LARK_NATIVE_AI_APPLY_UNEXPECTED_FIELD_DRIFT',
  );
  assert.equal(client.stats.createField, 0);
  assert.equal(client.stats.updateField, 0);
  assert.equal(client.stats.createView, 0);
  assert.equal(client.stats.updateView, 0);
});

test('rejects tampered action counts and non-additive actions', async () => {
  const client = new FakeLarkClient();
  const evidence = await buildEvidence(client);
  const wrongCounts = structuredClone(evidence);
  wrongCounts.preview.counts.totalActions = 30;
  assert.throws(
    () => validateLarkNativeAiRemoteInventoryEvidence(wrongCounts),
    (error) => error.code === 'LARK_NATIVE_AI_APPLY_EVIDENCE_COUNTS_INVALID',
  );

  const nonAdditive = structuredClone(evidence);
  nonAdditive.preview.actions[0].additiveOnly = false;
  assert.throws(
    () => validateLarkNativeAiRemoteInventoryEvidence(nonAdditive),
    (error) => error.code === 'LARK_NATIVE_AI_APPLY_ACTION_NOT_ADDITIVE',
  );
});

async function buildEvidence(client) {
  const collected = await collectLarkNativeAiSchemaInventory({ client });
  return {
    ok: true,
    contractVersion: LARK_NATIVE_AI_REMOTE_EVIDENCE_VERSION,
    repository: {
      branch: 'main',
      head: 'a'.repeat(40),
      reviewedHead: 'a'.repeat(40),
      clean: true,
    },
    baseIdentityHash: 'b'.repeat(64),
    collectedAt: '2026-08-02T16:41:50.080Z',
    inventory: collected.inventory,
    preview: collected.preview,
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

class FakeLarkClient {
  constructor() {
    this.tables = [{ tableId: 'tbl-ai', name: LARK_NATIVE_AI_TARGET_TABLE, revision: 0 }];
    this.fields = ORIGINAL_FIELDS.map(({ fieldName, fieldType, options }) => rawField(fieldName, fieldType, options));
    this.views = ORIGINAL_VIEWS.map((viewName, index) => ({
      viewId: `vew-${index + 1}`,
      viewName,
      viewType: 'grid',
      property: { hiddenFields: [], filterInfo: null },
    }));
    this.stats = {
      listTables: 0,
      listFields: 0,
      listViews: 0,
      createField: 0,
      updateField: 0,
      createView: 0,
      updateView: 0,
      getView: 0,
      recordRead: 0,
    };
  }
  async listTables() {
    this.stats.listTables += 1;
    return structuredClone(this.tables);
  }
  async listFields() {
    this.stats.listFields += 1;
    return structuredClone(this.fields);
  }
  async listViews() {
    this.stats.listViews += 1;
    return structuredClone(this.views);
  }
  async createField({ field: input }) {
    this.stats.createField += 1;
    const created = {
      fieldId: `fld-${this.fields.length + 1}`,
      fieldName: input.fieldName,
      type: input.type,
      uiType: uiTypeFor(input.type),
      description: input.description ?? '',
      property: normalizeProperty(input.property),
    };
    this.fields.push(created);
    return structuredClone(created);
  }
  async updateField({ fieldId, field: input }) {
    this.stats.updateField += 1;
    const index = this.fields.findIndex((fieldValue) => fieldValue.fieldId === fieldId);
    assert.notEqual(index, -1);
    const updated = {
      ...this.fields[index],
      fieldName: input.fieldName,
      type: input.type,
      uiType: input.uiType ?? uiTypeFor(input.type),
      description: input.description ?? '',
      property: normalizeProperty(input.property),
    };
    this.fields[index] = updated;
    return structuredClone(updated);
  }
  async createView({ viewName, viewType }) {
    this.stats.createView += 1;
    const view = {
      viewId: `vew-${this.views.length + 1}`,
      viewName,
      viewType,
      property: { hiddenFields: [], filterInfo: null },
    };
    this.views.push(view);
    return structuredClone(view);
  }
  async updateView({ viewId, filterInfo }) {
    this.stats.updateView += 1;
    const index = this.views.findIndex((view) => view.viewId === viewId);
    assert.notEqual(index, -1);
    this.views[index] = {
      ...this.views[index],
      property: {
        hiddenFields: [],
        filterInfo: {
          conjunction: filterInfo.conjunction,
          conditions: filterInfo.conditions.map((condition) => ({
            fieldId: condition.fieldId,
            fieldType: condition.fieldType,
            operator: condition.operator,
            value: JSON.stringify(condition.value),
          })),
        },
      },
    };
    return structuredClone(this.views[index]);
  }
  async getView({ viewId }) {
    this.stats.getView += 1;
    return structuredClone(this.views.find((view) => view.viewId === viewId));
  }
}

function field(fieldName, fieldType, options = undefined) {
  return Object.freeze({ fieldName, fieldType, ...(options ? { options: Object.freeze([...options]) } : {}) });
}
function rawField(fieldName, fieldType, options = undefined) {
  return {
    fieldId: `fld-${fieldName}`,
    fieldName,
    type: TYPE_IDS[fieldType],
    uiType: uiTypeFor(TYPE_IDS[fieldType]),
    description: '',
    property: options
      ? { options: options.map((name, index) => ({ id: `opt-${fieldName}-${index}`, name, color: index % 8 })) }
      : (fieldType === 'Number' ? { formatter: '0.00' }
        : (fieldType === 'DateTime' ? { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false } : null)),
  };
}
function mutationFromAction(action) {
  return {
    fieldName: action.fieldName,
    type: TYPE_IDS[action.fieldType],
    property: action.options ? { options: action.options.map((name) => ({ name })) } : null,
  };
}
function normalizeProperty(value) {
  if (!value) return null;
  const property = structuredClone(value);
  if (Array.isArray(property.options)) {
    property.options = property.options.map((option, index) => ({
      id: option.id ?? `opt-new-${index}`,
      name: option.name,
      color: option.color ?? index % 8,
    }));
  }
  return property;
}
function uiTypeFor(type) {
  return ({ 1: 'Text', 2: 'Number', 3: 'SingleSelect', 4: 'MultiSelect', 5: 'DateTime', 7: 'Checkbox' })[type];
}
