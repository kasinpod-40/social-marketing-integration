import {
  applyLarkReportSchema,
  planLarkReportSchema,
} from '../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  applyDashboardReportSettingsReconciliation,
  planDashboardReportSettingsReconciliation,
} from '../packages/application/src/use-cases/reconcile-dashboard-report-settings.js';
import {
  createReportSettingRowsForProfile,
  LEGACY_REPORT_SETTING_KEYS,
} from '../packages/config/src/report-settings.seed.js';
import { createLocalLarkRuntime, printJson } from './lib/lark-runtime.js';
import { readWranglerStringVars } from './lib/wrangler-sync-config.js';
import {
  DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES,
  resolveDashboardReportSettingsTableEnvironment,
} from './lib/dashboard-report-settings-table-environment.js';

const CONFIRMATION = 'RECONCILE_INTEGRATION_WORKSPACE_REPORT_SETTINGS';
const ALLOWED_SCHEMA_ACTIONS = new Set([
  'update_field:mktReportSettings:period_type',
  'create_field:mktReportSettings:period_kind',
  'create_field:mktReportSettings:window_days',
  'update_field:mktReportSettings:report_type',
  'update_field:mktReportSnapshots:report_type',
  'create_field:mktReportSnapshots:period_kind',
  'create_field:mktReportSnapshots:window_days',
  'update_field:mktReportMetricValues:report_type',
  'update_field:mktReportTopContent:report_type',
]);
const REFERENCE_TABLE_KEYS = Object.freeze([
  'mktReportSnapshots',
  'mktReportMetricValues',
  'mktReportTopContent',
]);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'UNEXPECTED_ERROR',
    message: error?.message ?? String(error),
    details: sanitizeDetails(error?.details),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  if (apply && process.env.CONFIRM_DASHBOARD_REPORT_SETTINGS !== CONFIRMATION) {
    throw new Error(`Apply requires CONFIRM_DASHBOARD_REPORT_SETTINGS=${CONFIRMATION}`);
  }

  const wranglerConfigPath = process.env.MKT_DASHBOARD_REPORT_SETTINGS_WRANGLER_CONFIG
    ?? 'wrangler.sync.jsonc';
  const wrangler = await readWranglerStringVars(
    wranglerConfigPath,
    DASHBOARD_REPORT_SETTINGS_REQUIRED_TABLE_ENV_NAMES,
  );
  const tableEnvironment = resolveDashboardReportSettingsTableEnvironment({
    wranglerEnv: wrangler.values,
    runtimeEnv: process.env,
  });
  if (tableEnvironment.missingTableEnvNames.length > 0) {
    throw new Error(
      `Dashboard report settings config is missing ${tableEnvironment.missingTableEnvNames.join(', ')}`,
    );
  }
  const runtime = await createLocalLarkRuntime([
    'mktReportSettings',
    ...REFERENCE_TABLE_KEYS,
  ], {
    env: tableEnvironment.env,
    runtimeConfigScope: 'administrative',
  });
  if (runtime.runtimeConfig.environment !== 'development'
    || runtime.runtimeConfig.profileKey !== 'integration_workspace') {
    throw new Error('Dashboard report settings reconciliation requires development/integration_workspace');
  }

  const schemaPreview = await planLarkReportSchema({
    client: runtime.client,
    env: runtime.env,
  });
  assertExpectedSchemaPlan(schemaPreview);
  const preAudit = await auditLegacyReferences(runtime);
  const recordPreview = schemaPreview.actions.length === 0
    ? await planDashboardReportSettingsReconciliation({
      repository: runtime.repository,
      syncEngine: runtime.syncEngine,
      tableId: runtime.tables.mktReportSettings,
      profileKey: runtime.runtimeConfig.profileKey,
    })
    : null;

  if (!apply) {
    printJson({
      ok: true,
      mode: 'preview',
      schemaReadyToApply: schemaPreview.readyToApply,
      schemaActionCount: schemaPreview.actions.length,
      schemaActions: schemaPreview.actions.map(sanitizeSchemaAction),
      canonicalExpected: createReportSettingRowsForProfile('integration_workspace').length,
      canonicalCreates: recordPreview?.summary.canonicalCreates ?? null,
      canonicalUpdates: recordPreview?.summary.canonicalUpdates ?? null,
      canonicalSkipped: recordPreview?.summary.canonicalSkipped ?? null,
      legacySettingsFound: preAudit.legacySettingsFound,
      activeLegacySettings: preAudit.activeLegacySettings,
      historicalReferenceCount: preAudit.historicalReferenceCount,
      deleteCount: 0,
      remoteMutationCount: 0,
      nextCommand: `CONFIRM_DASHBOARD_REPORT_SETTINGS=${CONFIRMATION} node scripts/reconcile-dashboard-report-settings.mjs --apply`,
    });
    return;
  }

  const schema = await applyLarkReportSchema({
    client: runtime.client,
    env: runtime.env,
  });
  const plan = await planDashboardReportSettingsReconciliation({
    repository: runtime.repository,
    syncEngine: runtime.syncEngine,
    tableId: runtime.tables.mktReportSettings,
    profileKey: runtime.runtimeConfig.profileKey,
  });
  const records = await applyDashboardReportSettingsReconciliation({
    repository: runtime.repository,
    syncEngine: runtime.syncEngine,
    plan,
  });
  const postAudit = await auditLegacyReferences(runtime);
  if (postAudit.activeLegacySettings !== 0) {
    throw new Error('Post-apply verification found active legacy report settings');
  }

  printJson({
    ok: true,
    mode: 'apply',
    schemaAppliedActions: schema.summary.appliedActions,
    canonicalCreated: records.canonical.created,
    canonicalUpdated: records.canonical.updated,
    canonicalSkipped: records.canonical.skipped,
    canonicalActive: records.verification.canonicalActive,
    legacyDisabled: records.legacyDisabled,
    activeLegacySettings: postAudit.activeLegacySettings,
    legacyRetainedDisabled: records.verification.legacyRetainedDisabled,
    historicalReferenceCount: postAudit.historicalReferenceCount,
    deleteCount: 0,
    remoteMutationCount: schema.summary.appliedActions
      + records.canonical.created
      + records.canonical.updated
      + records.legacyDisabled,
  });
}

function assertExpectedSchemaPlan(preview) {
  if (preview.readyToApply !== true || preview.conflicts.length > 0) {
    throw new Error('Report schema preview is not safe to apply');
  }
  const unexpected = preview.actions
    .map((action) => schemaActionKey(action))
    .filter((key) => !ALLOWED_SCHEMA_ACTIONS.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected report schema actions: ${unexpected.join(', ')}`);
  }
}

async function auditLegacyReferences(runtime) {
  const settings = await runtime.repository.listByFieldValues(
    runtime.tables.mktReportSettings,
    'report_setting_key',
    LEGACY_REPORT_SETTING_KEYS,
  );
  let historicalReferenceCount = 0;
  for (const tableKey of REFERENCE_TABLE_KEYS) {
    const records = await runtime.repository.listByFieldValues(
      runtime.tables[tableKey],
      'report_setting_key',
      LEGACY_REPORT_SETTING_KEYS,
    );
    historicalReferenceCount += records.length;
  }
  return Object.freeze({
    legacySettingsFound: settings.length,
    activeLegacySettings: settings.filter((record) => readEnabled(record?.fields?.enabled)).length,
    historicalReferenceCount,
  });
}

function sanitizeSchemaAction(action) {
  return Object.freeze({
    kind: action.kind,
    tableKey: action.tableKey,
    fieldName: action.field?.fieldName ?? null,
  });
}

function schemaActionKey(action) {
  return [
    action.kind,
    action.tableKey,
    action.field?.fieldName ?? '',
  ].join(':');
}

function readEnabled(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined || value === '') {
    return false;
  }
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

function sanitizeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = {};
  for (const key of ['expected', 'actual', 'key', 'profile', 'platforms']) {
    if (Object.hasOwn(value, key)) allowed[key] = value[key];
  }
  return allowed;
}
