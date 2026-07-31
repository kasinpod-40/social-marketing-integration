import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
import {
  LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
  LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
  buildLarkDashboardCompatibilityFreezeAudit,
  buildLarkDashboardMutationBlockedFailure,
  hasRetiredDashboardMutationArgument,
} from '../../scripts/lib/lark-dashboard-compatibility-freeze-v1.js';

const NUMBER = 'window_days';
const PRESERVED = '__mkt_legacy_window_days_single_select_v1';
const V2 = '__mkt_legacy_window_days_single_select_v2';

test('historical v3 scope contract remains explicit while its public runtime is retired', () => {
  assert.deepEqual(REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES, [
    'base:dashboard:read',
    'base:dashboard:update',
    'base:block:read',
    'base:block:update',
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

test('historical field mutation builders remain deterministic but are not publicly executable', () => {
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

  const number = buildRetiredNumberFieldMutation({
    type: 2,
    uiType: 'Number',
    description: 'window',
    property: { formatter: '0' },
  });
  assert.equal(number.fieldName, '__mkt_retired_window_days_number_v3');
  assert.equal(number.type, 2);
});

test('historical organic mutation helper remains type-bounded', () => {
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

test('compatibility freeze preserves every audited field identity and business-fact boundary', () => {
  const audit = buildLarkDashboardCompatibilityFreezeAudit();
  assert.equal(audit.ok, true);
  assert.equal(audit.contractVersion, LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION);
  assert.equal(audit.decision, 'LARK_DASHBOARD_COMPATIBILITY_FREEZE_ACTIVE');
  assert.equal(audit.dashboardPatchAllowed, false);
  assert.equal(audit.fieldRenameAllowed, false);
  assert.equal(audit.fieldDeleteAllowed, false);
  assert.equal(audit.recordDeleteAllowed, false);
  assert.equal(audit.reportRecordCountPreserved, 86);
  assert.equal(audit.baselineIncompleteNullRecordCountPreserved, 24);
  assert.deepEqual(audit.compatibilityFields, LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES);
});

test('retired mutation flags return a zero-mutation unsupported-contract failure', () => {
  assert.equal(hasRetiredDashboardMutationArgument(['--execute']), true);
  assert.equal(hasRetiredDashboardMutationArgument(['--statistics-probe-only']), true);
  assert.equal(hasRetiredDashboardMutationArgument([]), false);

  const failure = buildLarkDashboardMutationBlockedFailure({
    entrypoint: 'test-entrypoint',
    args: ['--execute'],
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.code, 'LARK_DASHBOARD_WRITE_CONTRACT_UNSUPPORTED');
  assert.equal(failure.details.remoteMutationCount, 0);
  assert.equal(failure.details.dashboardPatchAllowed, false);
  assert.equal(failure.details.fieldMutationAllowed, false);
  assert.equal(failure.details.recordMutationAllowed, false);
});

test('public v3 entrypoints fail before environment or Lark access and audit remains local-only', async () => {
  const scripts = [
    '../../scripts/lark-dashboard-field-identity-recovery-terminal-v3.mjs',
    '../../scripts/lark-dashboard-field-identity-recovery-v3.mjs',
  ];

  for (const relativePath of scripts) {
    const scriptPath = fileURLToPath(new URL(relativePath, import.meta.url));
    const result = spawnSync(process.execPath, [scriptPath, '--execute'], {
      encoding: 'utf8',
      env: {},
    });
    assert.equal(result.status, 1);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.code, 'LARK_DASHBOARD_WRITE_CONTRACT_UNSUPPORTED');
    assert.equal(failure.details.remoteMutationCount, 0);

    const source = await readFile(scriptPath, 'utf8');
    assert.doesNotMatch(source, /readDevVars|createLarkBitableClient|requestBitableJson/u);
  }

  const auditPath = fileURLToPath(
    new URL('../../scripts/lark-dashboard-compatibility-freeze-audit.mjs', import.meta.url),
  );
  const auditResult = spawnSync(process.execPath, [auditPath], {
    encoding: 'utf8',
    env: {},
  });
  assert.equal(auditResult.status, 0);
  assert.equal(JSON.parse(auditResult.stdout).decision, 'LARK_DASHBOARD_COMPATIBILITY_FREEZE_ACTIVE');
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
