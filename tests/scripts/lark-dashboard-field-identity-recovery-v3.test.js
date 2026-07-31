import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_CONFIRMATION,
  LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
  LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION,
  REPORT_METRIC_FIELD_IDENTITIES,
  REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES,
  assertFieldIdentityRecoveryConfirmation,
  assertFieldIdentityScopeConfirmation,
  assertPreservedWindowSelectConverged,
  assertSupportedOrganicMetricBlockType,
  buildPreservedWindowSelectFieldMutation,
  buildRetiredNumberFieldMutation,
  planPreservedWindowSelectBackfill,
} from '../../scripts/lib/lark-dashboard-field-identity-recovery-v3.js';

const NUMBER = 'window_days';
const PRESERVED = '__mkt_legacy_window_days_single_select_v1';
const V2 = '__mkt_legacy_window_days_single_select_v2';

test('scope contract declares every read and write used by field-identity recovery', () => {
  assert.deepEqual(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES, [
    'base:dashboard:read',
    'base:dashboard:update',
    'base:field:read',
    'base:field:update',
    'base:field:delete',
    'base:record:retrieve',
    'base:record:update',
  ]);
  assert.equal(
    assertFieldIdentityScopeConfirmation(LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION),
    true,
  );
  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:update'), false);
  assert.equal(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES.includes('base:block:read'), false);
  assert.equal(
    assertFieldIdentityRecoveryConfirmation(LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_CONFIRMATION),
    true,
  );
  assert.throws(
    () => assertFieldIdentityScopeConfirmation('wrong'),
    (error) => error.code === 'LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => assertFieldIdentityRecoveryConfirmation('wrong'),
    (error) => error.code === 'LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_CONFIRMATION_REQUIRED',
  );
});

test('field identity contract matches the audited live Report Metric table', () => {
  assert.equal(
    LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    'lark_dashboard_field_identity_recovery_v3_3',
  );
  assert.deepEqual(REPORT_METRIC_FIELD_IDENTITIES, {
    metricKey: { fieldId: 'fldGvd3tw8', fieldName: 'metric_key', type: 1 },
    displayName: { fieldId: 'fldE4Nezjd', fieldName: 'display_name', type: 1 },
    canonicalWindowNumber: {
      fieldId: 'fldbPCldTL',
      fieldName: 'window_days',
      type: 2,
      retiredName: '__mkt_retired_window_days_number_v3',
    },
    preservedWindowSelect: {
      fieldId: 'fldMlTUP3Z',
      legacyName: '__mkt_legacy_window_days_single_select_v1',
      canonicalName: 'window_days',
      type: 3,
    },
    windowSelectV2: {
      fieldId: 'fldraj0QP8',
      fieldName: '__mkt_legacy_window_days_single_select_v2',
      type: 3,
    },
    displaySelectV1: {
      fieldId: 'fldZB452Z2',
      fieldName: '__mkt_legacy_display_name_single_select_v1',
      type: 3,
    },
    displaySelectV2: {
      fieldId: 'fldHNUhCfl',
      fieldName: '__mkt_legacy_display_name_single_select_v2',
      type: 3,
    },
  });

  const serialized = JSON.stringify(REPORT_METRIC_FIELD_IDENTITIES);
  assert.doesNotMatch(serialized, /flduyym9cs|fldvLDwEHo|fldczhcM6r/u);
  const ids = Object.values(REPORT_METRIC_FIELD_IDENTITIES).map((identity) => identity.fieldId);
  assert.equal(new Set(ids).size, ids.length);
});

test('Number window values backfill only missing slicer-bound Select cells', () => {
  const plan = planPreservedWindowSelectBackfill({
    records: [
      row('rec-1', 1, null, null),
      row('rec-2', 3, '3', null),
      row('rec-3', 7, null, '7'),
      row('rec-4', 30, '30', '30'),
      row('rec-null', null, null, null),
    ],
    numberFieldName: NUMBER,
    preservedFieldName: PRESERVED,
    v2FieldName: V2,
  });

  assert.equal(plan.recordCount, 5);
  assert.equal(plan.populatedNumberCount, 4);
  assert.equal(plan.populatedPreservedCount, 2);
  assert.equal(plan.populatedV2Count, 2);
  assert.equal(plan.pendingUpdateCount, 2);
  assert.equal(plan.conflictCount, 0);
  assert.deepEqual(plan.updates, [
    { recordId: 'rec-1', fields: { [PRESERVED]: '1' } },
    { recordId: 'rec-3', fields: { [PRESERVED]: '7' } },
  ]);
});

test('window backfill fails closed on disagreement, unsupported preset or legacy-only value', () => {
  const plan = planPreservedWindowSelectBackfill({
    records: [
      row('disagree-v1', 3, '7', null),
      row('disagree-v2', 7, null, '30'),
      row('unsupported', 9, null, null),
      row('legacy-only', null, '3', null),
    ],
    numberFieldName: NUMBER,
    preservedFieldName: PRESERVED,
    v2FieldName: V2,
  });

  assert.equal(plan.pendingUpdateCount, 0);
  assert.equal(plan.conflictCount, 4);
  assert.deepEqual(plan.conflicts.map((item) => item.reason).sort(), [
    'legacy_value_without_canonical_number',
    'number_outside_dashboard_presets',
    'preserved_select_disagrees_with_number',
    'v2_select_disagrees_with_number',
  ]);
});

test('convergence assertion accepts complete 1/3/7/30 Select parity and rejects gaps', () => {
  const complete = [1, 3, 7, 30].map((value) => row(`rec-${value}`, value, String(value), null));
  const result = assertPreservedWindowSelectConverged({
    records: complete,
    numberFieldName: NUMBER,
    preservedFieldName: PRESERVED,
    v2FieldName: V2,
  });
  assert.equal(result.pendingUpdateCount, 0);
  assert.equal(result.conflictCount, 0);

  assert.throws(
    () => assertPreservedWindowSelectConverged({
      records: [row('missing', 30, null, null)],
      numberFieldName: NUMBER,
      preservedFieldName: PRESERVED,
      v2FieldName: V2,
    }),
    (error) => error.code === 'LARK_DASHBOARD_FIELD_IDENTITY_WINDOW_BACKFILL_NOT_CONVERGED',
  );
});

test('field mutations preserve types and Select options while changing names only', () => {
  const select = buildPreservedWindowSelectFieldMutation({
    type: 3,
    uiType: 'SingleSelect',
    description: 'window',
    property: {
      options: ['1', '3', '7', '30'].map((name, index) => ({ name, color: index })),
    },
  });
  assert.equal(select.fieldName, 'window_days');
  assert.equal(select.type, 3);
  assert.deepEqual(select.property.options.map((option) => option.name), ['1', '3', '7', '30']);

  const number = buildRetiredNumberFieldMutation({
    type: 2,
    uiType: 'Number',
    description: 'window',
    property: { formatter: '0' },
  });
  assert.equal(number.fieldName, '__mkt_retired_window_days_number_v3');
  assert.equal(number.type, 2);
  assert.equal(number.property.formatter, '0');
});

test('only Statistics is accepted for Organic metric block mutation', () => {
  assert.equal(assertSupportedOrganicMetricBlockType('statistics'), 'statistics');
  assert.throws(
    () => assertSupportedOrganicMetricBlockType('slicer'),
    (error) => error.code === 'LARK_DASHBOARD_FIELD_IDENTITY_BLOCK_TYPE_UNSUPPORTED',
  );
  assert.throws(
    () => assertSupportedOrganicMetricBlockType('column'),
    (error) => error.code === 'LARK_DASHBOARD_FIELD_IDENTITY_BLOCK_TYPE_UNSUPPORTED',
  );
});

test('operator source contains zero Slicer PATCH path and uses filter delta only for Statistics', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-dashboard-field-identity-recovery-v3.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /assertSupportedOrganicMetricBlockType\(liveBlock\.type/);
  assert.match(source, /body:\s*\{\s*data_config:\s*rewrite\.patch\s*\}/);
  assert.match(source, /slicerPatchCount:\s*0/);
  assert.match(source, /preservedSlicerCount\s*!==\s*5/);
  assert.match(source, /isBoundedPromotionGap/);
  assert.match(source, /containsText\(block\.dataConfig,\s*'window_days'\)/);
  assert.doesNotMatch(source, /blockType:\s*'slicer'[\s\S]{0,300}method:\s*'PATCH'/);
});

function row(recordId, numberValue, preservedValue, v2Value) {
  return {
    recordId,
    fields: {
      [NUMBER]: numberValue,
      [PRESERVED]: preservedValue,
      [V2]: v2Value,
    },
  };
}
