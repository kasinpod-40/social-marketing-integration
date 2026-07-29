#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION } from '../packages/application/src/use-cases/repair-lark-report-schema-conflicts.js';
import { readDevVars } from './lib/dev-vars.js';
import { REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION } from './lib/report-metric-value-field-migration.js';
import {
  REPORT_RUNTIME_FINALIZE_CONFIRMATION,
  REPORT_RUNTIME_FINALIZE_CONTRACT_VERSION,
  assertDashboardSettingsPreviewSafe,
  assertReportMetricValueFieldMigrationApplySafe,
  assertReportMetricValueFieldMigrationPreviewSafe,
  assertReportRuntimeFinalizeConfirmation,
  assertReportRuntimeFinalizeEnvironment,
  assertReportSchemaConflictRepairApplySafe,
  assertReportSchemaConflictRepairPreviewSafe,
  assertReportSchemaPreviewSafe,
  mergeReportSchemaEnvironment,
  parseReportRuntimeFinalizeArgs,
  safeReportRuntimeFinalizeEvidence,
} from './lib/report-runtime-finalize-operator.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const evidenceRoot = resolve(process.env.MKT_REPORT_RUNTIME_FINALIZE_EVIDENCE_DIR ?? 'outputs/report-runtime-finalize');
let currentStage = 'init';

try {
  const options = parseReportRuntimeFinalizeArgs(process.argv.slice(2));
  if (!options.execute) {
    printPlan();
  } else {
    await executeFinalization();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_FINALIZE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeReportRuntimeFinalizeEvidence(error?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: REPORT_RUNTIME_FINALIZE_CONTRACT_VERSION,
    command: `CONFIRM_REPORT_RUNTIME_FINALIZE=${REPORT_RUNTIME_FINALIZE_CONFIRMATION} node scripts/report-runtime-finalize-operator.mjs --execute`,
    stages: [
      'repository-clean-main-preflight',
      'repository-gates',
      'value-preserving-report-metric-field-migration',
      'report-schema-preview',
      'bounded-empty-field-conflict-recovery-if-needed',
      'report-schema-apply',
      'dashboard-settings-preview',
      'dashboard-settings-apply',
      'schema-and-settings-readback',
      'sanitized-evidence',
    ],
    safety: {
      defaultMode: 'plan_only',
      environment: 'development',
      customerProfile: 'integration_workspace',
      populatedFieldMigration: 'rename_legacy_create_canonical_lossless_copy',
      legacyValuesPreserved: true,
      conflictRecovery: 'empty_non_primary_fields_or_empty_tables_only',
      workerDeploy: false,
      remoteD1Mutation: false,
      queueSend: false,
      scheduleActivation: false,
      aiEnabled: false,
      deleteBusinessFacts: false,
    },
  }, null, 2)}\n`);
}

async function executeFinalization() {
  const env = await loadEnvironment();
  assertReportRuntimeFinalizeConfirmation(env);
  assertReportRuntimeFinalizeEnvironment(env);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  currentStage = 'repository-clean-main-preflight';
  const repository = await assertRepositoryState();

  currentStage = 'repository-gates';
  const gates = [];
  for (const [command, args] of [
    ['npm', ['ci']],
    ['npm', ['run', 'check']],
    ['npm', ['test']],
    ['npm', ['run', 'test:report-reliability']],
    ['npm', ['audit']],
    ['npm', ['run', 'deploy:dry-run']],
  ]) {
    await run(command, args, { env });
    gates.push({ command: [command, ...args].join(' '), status: 'pass' });
  }

  currentStage = 'report-metric-value-field-migration-preview';
  const metricFieldMigrationPreview = await runJson(
    'node',
    ['scripts/migrate-report-metric-value-field-types.mjs'],
    { env },
  );
  assertReportMetricValueFieldMigrationPreviewSafe(metricFieldMigrationPreview);
  let metricFieldMigration = {
    mode: 'preview',
    migrationCount: metricFieldMigrationPreview.migrationCount,
    pendingMigrationCount: metricFieldMigrationPreview.pendingMigrationCount,
    convergedMigrationCount: metricFieldMigrationPreview.convergedMigrationCount,
    notRequiredMigrationCount: metricFieldMigrationPreview.notRequiredMigrationCount,
    plannedFieldMutationCount: metricFieldMigrationPreview.plannedFieldMutationCount,
    plannedCanonicalValueWriteCount: metricFieldMigrationPreview.plannedCanonicalValueWriteCount,
    migrations: metricFieldMigrationPreview.migrations ?? [],
    legacyValueMutationCount: 0,
    deleteCount: 0,
  };
  if (Number(metricFieldMigrationPreview.pendingMigrationCount) > 0) {
    currentStage = 'report-metric-value-field-migration-apply';
    const metricFieldMigrationApply = await runJson(
      'node',
      ['scripts/migrate-report-metric-value-field-types.mjs', '--apply'],
      {
        env: {
          ...env,
          CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION:
            REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
        },
      },
    );
    assertReportMetricValueFieldMigrationApplySafe(
      metricFieldMigrationApply,
      metricFieldMigrationPreview,
    );
    metricFieldMigration = {
      mode: 'apply',
      migrationCount: metricFieldMigrationApply.migrationCount,
      pendingMigrationCount: metricFieldMigrationApply.pendingMigrationCount,
      convergedMigrationCount: metricFieldMigrationApply.convergedMigrationCount,
      notRequiredMigrationCount: metricFieldMigrationApply.notRequiredMigrationCount,
      fieldMutationCount: metricFieldMigrationApply.fieldMutationCount,
      canonicalValueWriteCount: metricFieldMigrationApply.canonicalValueWriteCount,
      recordBatchWriteCount: metricFieldMigrationApply.recordBatchWriteCount,
      remoteMutationCount: metricFieldMigrationApply.remoteMutationCount,
      legacyValueMutationCount: metricFieldMigrationApply.legacyValueMutationCount,
      deleteCount: metricFieldMigrationApply.deleteCount,
      migrations: metricFieldMigrationApply.migrations ?? [],
    };
  }

  currentStage = 'report-schema-preview';
  let schemaPreview = await runJson('node', ['scripts/setup-report-schema.mjs'], { env });
  let conflictRecovery = null;
  const conflictCount = Array.isArray(schemaPreview.conflicts) ? schemaPreview.conflicts.length : 0;
  if (conflictCount > 0) {
    currentStage = 'report-schema-conflict-recovery-preview';
    const repairPreview = await runJson('node', ['scripts/repair-report-schema-conflicts.mjs'], { env });
    assertReportSchemaConflictRepairPreviewSafe(repairPreview, conflictCount);

    currentStage = 'report-schema-conflict-recovery-apply';
    const repairApply = await runJson('node', ['scripts/repair-report-schema-conflicts.mjs', '--apply'], {
      env: {
        ...env,
        CONFIRM_REPORT_SCHEMA_CONFLICT_REPAIR: REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION,
      },
    });
    assertReportSchemaConflictRepairApplySafe(repairApply, conflictCount);
    conflictRecovery = {
      conflictCount,
      repairedConflictCount: repairApply.repairedConflictCount,
      appliedRepairCount: repairApply.appliedRepairCount,
      remainingConflictCount: repairApply.remainingConflictCount,
      repairs: repairApply.repairs ?? [],
      businessValueMutationCount: repairApply.businessValueMutationCount,
      deleteCount: repairApply.deleteCount,
    };

    currentStage = 'report-schema-preview-after-conflict-recovery';
    schemaPreview = await runJson('node', ['scripts/setup-report-schema.mjs'], { env });
  }
  assertReportSchemaPreviewSafe(schemaPreview);

  currentStage = 'report-schema-apply';
  const schemaApply = await runJson('node', ['scripts/setup-report-schema.mjs', '--apply'], {
    env: { ...env, CONFIRM_WRITE: 'YES' },
  });
  const postSchemaEnv = mergeReportSchemaEnvironment(env, schemaApply);

  currentStage = 'dashboard-settings-preview';
  const settingsPreview = await runJson('node', ['scripts/reconcile-dashboard-report-settings.mjs'], {
    env: postSchemaEnv,
  });
  assertDashboardSettingsPreviewSafe(settingsPreview);

  currentStage = 'dashboard-settings-apply';
  const settingsApply = await runJson('node', ['scripts/reconcile-dashboard-report-settings.mjs', '--apply'], {
    env: {
      ...postSchemaEnv,
      CONFIRM_DASHBOARD_REPORT_SETTINGS: 'RECONCILE_INTEGRATION_WORKSPACE_REPORT_SETTINGS',
    },
  });
  if (settingsApply?.ok !== true || settingsApply?.mode !== 'apply' || Number(settingsApply?.deleteCount ?? 0) !== 0) {
    throw new Error('Dashboard settings apply result is invalid');
  }

  currentStage = 'schema-and-settings-readback';
  const schemaReadback = await runJson('node', ['scripts/setup-report-schema.mjs'], { env: postSchemaEnv });
  assertReportSchemaPreviewSafe(schemaReadback, { requireClean: true });
  const settingsReadback = await runJson('node', ['scripts/reconcile-dashboard-report-settings.mjs'], { env: postSchemaEnv });
  assertDashboardSettingsPreviewSafe(settingsReadback, { requireClean: true });

  currentStage = 'sanitized-evidence';
  const summary = safeReportRuntimeFinalizeEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_FINALIZE_CONTRACT_VERSION,
    repository,
    gates,
    schema: {
      version: schemaApply.schemaVersion,
      metricFieldMigration,
      conflictRecovery,
      plannedActions: schemaApply.summary?.plannedActions ?? null,
      appliedActions: schemaApply.summary?.appliedActions ?? null,
      createdTables: schemaApply.summary?.createdTables ?? null,
      createdFields: schemaApply.summary?.createdFields ?? null,
      updatedFields: schemaApply.summary?.updatedFields ?? null,
      readbackActions: schemaReadback.actions?.length ?? null,
      conflicts: schemaReadback.conflicts?.length ?? null,
      environmentUpdateNames: Object.keys(schemaApply.environmentUpdates ?? {}).sort(),
    },
    settings: {
      canonicalExpected: settingsPreview.canonicalExpected ?? null,
      canonicalCreated: settingsApply.canonicalCreated ?? null,
      canonicalUpdated: settingsApply.canonicalUpdated ?? null,
      canonicalSkipped: settingsApply.canonicalSkipped ?? null,
      canonicalActive: settingsApply.canonicalActive ?? null,
      legacyDisabled: settingsApply.legacyDisabled ?? null,
      activeLegacySettings: settingsApply.activeLegacySettings ?? null,
      deleteCount: settingsApply.deleteCount ?? null,
      readbackCreates: settingsReadback.canonicalCreates ?? null,
      readbackUpdates: settingsReadback.canonicalUpdates ?? null,
    },
    runtime: {
      reportD1ReadEnabled: false,
      presetMaterializationEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
      workerDeployed: false,
      queueMessageSent: false,
      remoteD1Mutated: false,
    },
    nextStep: 'merge/deploy/runtime activation remain separately controlled; Lark Report schema and canonical settings are ready',
  });
  const evidencePath = resolve(evidenceRoot, 'report-runtime-finalize-summary.json');
  await writeFile(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

async function assertRepositoryState() {
  const branch = (await runCapture('git', ['branch', '--show-current'])).trim();
  if (branch !== 'main') throw new Error('Report finalization must run from the main branch after PR merge');
  const status = (await runCapture('git', ['status', '--porcelain'])).trim();
  if (status !== '') throw new Error('Report finalization requires a clean working tree');
  const head = (await runCapture('git', ['rev-parse', 'HEAD'])).trim();
  return Object.freeze({ branch, head, clean: true });
}

async function runJson(command, args, options = {}) {
  const stdout = await runCapture(command, args, options);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Command did not return JSON: ${[command, ...args].join(' ')}`);
  }
}

async function run(command, args, options = {}) {
  await execFileAsync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function runCapture(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}
