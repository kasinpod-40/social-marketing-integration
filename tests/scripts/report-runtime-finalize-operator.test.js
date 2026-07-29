import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPORT_RUNTIME_FINALIZE_CONFIRMATION,
  assertDashboardSettingsPreviewSafe,
  assertReportRuntimeFinalizeConfirmation,
  assertReportRuntimeFinalizeEnvironment,
  assertReportSchemaConflictRepairApplySafe,
  assertReportSchemaConflictRepairPreviewSafe,
  assertReportSchemaPreviewSafe,
  mergeReportSchemaEnvironment,
  parseReportRuntimeFinalizeArgs,
  safeReportRuntimeFinalizeEvidence,
} from '../../scripts/lib/report-runtime-finalize-operator.js';

function safeEnv(overrides = {}) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_REPORT_AI_SUMMARY_ENABLED: 'false',
    MKT_REPORT_D1_READ_ENABLED: 'false',
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'false',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    ...overrides,
  };
}

test('final operator stays plan-only and requires exact execution confirmation', () => {
  assert.deepEqual(parseReportRuntimeFinalizeArgs([]), { execute: false });
  assert.deepEqual(parseReportRuntimeFinalizeArgs(['--execute']), { execute: true });
  assert.throws(() => parseReportRuntimeFinalizeArgs(['--phase=apply']));
  assert.throws(() => assertReportRuntimeFinalizeConfirmation({}));
  assert.equal(assertReportRuntimeFinalizeConfirmation({
    CONFIRM_REPORT_RUNTIME_FINALIZE: REPORT_RUNTIME_FINALIZE_CONFIRMATION,
  }), true);
});

test('final operator accepts only Integration Workspace with every runtime flag closed', () => {
  assert.equal(assertReportRuntimeFinalizeEnvironment(safeEnv()), true);
  assert.throws(() => assertReportRuntimeFinalizeEnvironment(safeEnv({ MKT_ENV: 'production' })));
  assert.throws(() => assertReportRuntimeFinalizeEnvironment(safeEnv({ MKT_REPORT_D1_READ_ENABLED: 'true' })));
  assert.throws(() => assertReportRuntimeFinalizeEnvironment(safeEnv({ MKT_REPORT_AI_SUMMARY_ENABLED: 'true' })));
});

test('schema and settings previews fail closed on conflicts, mutations and dirty read-back', () => {
  const schema = { readyToApply: true, conflicts: [], actions: [] };
  assert.equal(assertReportSchemaPreviewSafe(schema, { requireClean: true }), true);
  assert.throws(
    () => assertReportSchemaPreviewSafe({
      ...schema,
      readyToApply: false,
      conflicts: [{ code: 'FIELD_TYPE_MISMATCH', tableKey: 'mktReportSnapshots', fieldName: 'coverage_rate', expectedType: 2, actualType: 1 }],
    }),
    (error) => error.details.conflicts[0].fieldName === 'coverage_rate'
      && !Object.hasOwn(error.details.conflicts[0], 'tableId'),
  );
  assert.throws(() => assertReportSchemaPreviewSafe({ ...schema, actions: [{}] }, { requireClean: true }));

  const settings = {
    ok: true,
    mode: 'preview',
    schemaReadyToApply: true,
    canonicalCreates: 0,
    canonicalUpdates: 0,
    activeLegacySettings: 0,
    deleteCount: 0,
    remoteMutationCount: 0,
  };
  assert.equal(assertDashboardSettingsPreviewSafe(settings, { requireClean: true }), true);
  assert.throws(() => assertDashboardSettingsPreviewSafe({ ...settings, remoteMutationCount: 1 }));
  assert.throws(() => assertDashboardSettingsPreviewSafe({ ...settings, canonicalCreates: 1 }, { requireClean: true }));
});

test('bounded conflict recovery requires complete preview scope and zero Business-value mutation', () => {
  const preview = {
    ok: true,
    mode: 'preview',
    conflictCount: 2,
    repairConflictCount: 2,
    repairActionCount: 2,
    blockerCount: 0,
    repairable: true,
    remoteMutationCount: 0,
    businessValueMutationCount: 0,
    deleteCount: 0,
  };
  assert.equal(assertReportSchemaConflictRepairPreviewSafe(preview, 2), true);
  assert.throws(() => assertReportSchemaConflictRepairPreviewSafe({ ...preview, repairable: false, blockerCount: 1 }, 2));
  assert.throws(() => assertReportSchemaConflictRepairPreviewSafe({ ...preview, businessValueMutationCount: 1 }, 2));
  assert.throws(() => assertReportSchemaConflictRepairPreviewSafe(preview, 3));
});

test('bounded conflict recovery apply must verify all conflicts removed without deletes', () => {
  const result = {
    ok: true,
    mode: 'apply',
    conflictCount: 2,
    repairedConflictCount: 2,
    appliedRepairCount: 2,
    remainingConflictCount: 0,
    remoteMutationCount: 2,
    businessValueMutationCount: 0,
    deleteCount: 0,
  };
  assert.equal(assertReportSchemaConflictRepairApplySafe(result, 2), true);
  assert.throws(() => assertReportSchemaConflictRepairApplySafe({ ...result, remainingConflictCount: 1 }, 2));
  assert.throws(() => assertReportSchemaConflictRepairApplySafe({ ...result, deleteCount: 1 }, 2));
});

test('finalizer runs conflict recovery between first schema preview and schema apply', () => {
  const source = readFileSync(
    new URL('../../scripts/report-runtime-finalize-operator.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /report-schema-preview[\s\S]*repair-report-schema-conflicts\.mjs[\s\S]*report-schema-preview-after-conflict-recovery[\s\S]*report-schema-apply/u);
  assert.match(source, /CONFIRM_REPORT_SCHEMA_CONFLICT_REPAIR/u);
  assert.match(source, /businessValueMutationCount/u);
  assert.match(source, /deleteCount/u);
});

test('schema environment updates are allowlisted and evidence strips secret-shaped keys', () => {
  const merged = mergeReportSchemaEnvironment(safeEnv(), {
    environmentUpdates: {
      LARK_TABLE_MKT_REPORT_TOP_ADS: 'tbl_top_ads',
      LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
    },
  });
  assert.equal(merged.LARK_TABLE_MKT_REPORT_TOP_ADS, 'tbl_top_ads');
  assert.throws(() => mergeReportSchemaEnvironment({}, { environmentUpdates: { OTHER: 'value' } }));
  assert.deepEqual(safeReportRuntimeFinalizeEvidence({
    ok: true,
    accessToken: 'nope',
    nested: { LARK_APP_SECRET: 'nope', tableId: 'tbl' },
  }), { ok: true, nested: { tableId: 'tbl' } });
});
