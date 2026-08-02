import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_TARGET_TABLE,
  buildLarkNativeAiSchemaPreview,
  simulateLarkNativeAiSchemaPreviewApply,
} from '../../packages/config/src/lark-native-ai-schema-preview.js';

function base14Inventory(overrides = {}) {
  const target = {
    tableName: LARK_NATIVE_AI_TARGET_TABLE,
    fields: [
      field('report_id', 'Text'),
      field('platforms', 'MultiSelect', [
        'facebook', 'google_ads', 'instagram', 'meta_ads', 'tiktok', 'tiktok_ads', 'youtube',
      ]),
      field('report_type', 'SingleSelect', [
        'daily_organic_report', 'weekly_organic_report', 'dashboard_performance_report',
      ]),
      field('period_start', 'DateTime'),
      field('period_end', 'DateTime'),
      field('compare_start', 'DateTime'),
      field('compare_end', 'DateTime'),
      field('comparison_mode', 'SingleSelect', ['none', 'previous_period']),
      field('metric_summary_json', 'Text'),
      field('insight_summary', 'Text'),
      field('strengths', 'Text'),
      field('weaknesses', 'Text'),
      field('recommendations', 'Text'),
      field('sent_to_group', 'Checkbox'),
      field('sent_at', 'DateTime'),
    ],
    views: ['All'],
    ...overrides.target,
  };
  return {
    baseName: 'Social MKT Data Hub',
    baseRevision: 141,
    sourceSha256: '6dab2da7a8184d65c9e257747aa65ef3717f8d015b44214e199ddaebd165d128',
    tables: [target, ...overrides.extraTables ?? []],
  };
}

function field(fieldName, fieldType, options) {
  return options === undefined ? { fieldName, fieldType } : { fieldName, fieldType, options };
}

test('builds the exact additive Phase 1 Preview for the audited Base without mutation actions', () => {
  const preview = buildLarkNativeAiSchemaPreview({ inventory: base14Inventory() });

  assert.equal(preview.ok, true);
  assert.equal(preview.status, 'ready_to_apply');
  assert.equal(preview.applyAuthorized, false);
  assert.deepEqual(preview.counts, {
    addField: 23,
    extendSelectOptions: 2,
    createView: 6,
    blockers: 0,
    totalActions: 31,
  });
  assert.equal(preview.safety.renameField, 0);
  assert.equal(preview.safety.deleteField, 0);
  assert.equal(preview.safety.changeFieldType, 0);
  assert.equal(preview.safety.remoteLarkWrite, 0);
  assert.equal(preview.safety.notificationSend, 0);

  const platforms = preview.actions.find((action) => (
    action.action === 'extend_select_options' && action.fieldName === 'platforms'
  ));
  assert.deepEqual(platforms.optionsToAdd, ['woocommerce', 'chatwoot']);
  assert.equal(platforms.preserveExistingOptions, true);

  const reportType = preview.actions.find((action) => (
    action.action === 'extend_select_options' && action.fieldName === 'report_type'
  ));
  assert.deepEqual(reportType.optionsToAdd, ['dashboard_channel_status', 'dashboard_executive_summary']);
});

test('replay after a simulated additive Apply reaches zero drift', () => {
  const inventory = base14Inventory();
  const first = buildLarkNativeAiSchemaPreview({ inventory });
  const simulated = simulateLarkNativeAiSchemaPreviewApply(inventory, first);
  const second = buildLarkNativeAiSchemaPreview({ inventory: simulated });

  assert.equal(second.ok, true);
  assert.equal(second.status, 'zero_drift');
  assert.equal(second.counts.totalActions, 0);
  assert.equal(second.counts.blockers, 0);
});

test('fails closed on an existing additive field type conflict', () => {
  const inventory = base14Inventory();
  inventory.tables[0].fields.push(field('ai_run_key', 'Number'));
  const preview = buildLarkNativeAiSchemaPreview({ inventory });

  assert.equal(preview.ok, false);
  assert.equal(preview.status, 'blocked');
  assert.ok(preview.blockers.some(({ code, subject }) => (
    code === 'ADDITIVE_FIELD_TYPE_CONFLICT' && subject === 'ai_run_key'
  )));
  assert.equal(preview.applyAuthorized, false);
});

test('fails closed when the reused AI table is duplicated', () => {
  const inventory = base14Inventory({
    extraTables: [{ tableName: LARK_NATIVE_AI_TARGET_TABLE, fields: [], views: [] }],
  });
  const preview = buildLarkNativeAiSchemaPreview({ inventory });

  assert.equal(preview.status, 'blocked');
  assert.ok(preview.blockers.some(({ code }) => code === 'TARGET_TABLE_DUPLICATE'));
  assert.equal(preview.actions.length, 0);
});

test('preserves existing options and Views while adding only missing values', () => {
  const inventory = base14Inventory();
  inventory.tables[0].fields.find(({ fieldName }) => fieldName === 'platforms').options.push('legacy_platform');
  inventory.tables[0].views.push('🧪 Preview Runs');
  const preview = buildLarkNativeAiSchemaPreview({ inventory });

  assert.equal(preview.ok, true);
  assert.equal(preview.counts.createView, 5);
  const optionAction = preview.actions.find((action) => action.fieldName === 'platforms');
  assert.deepEqual(optionAction.optionsToAdd, ['woocommerce', 'chatwoot']);
  assert.equal(optionAction.preserveExistingOptions, true);
  assert.equal(preview.actions.some((action) => action.action.includes('delete')), false);
});

test('fails closed when select options cannot be read back', () => {
  const inventory = base14Inventory();
  delete inventory.tables[0].fields.find(({ fieldName }) => fieldName === 'platforms').options;
  const preview = buildLarkNativeAiSchemaPreview({ inventory });

  assert.equal(preview.status, 'blocked');
  assert.ok(preview.blockers.some(({ code, subject }) => (
    code === 'SELECT_OPTIONS_UNAVAILABLE' && subject === 'platforms'
  )));
});
