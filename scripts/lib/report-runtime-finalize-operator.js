import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const REPORT_RUNTIME_FINALIZE_CONTRACT_VERSION = 'report_runtime_finalize_v1';
export const REPORT_RUNTIME_FINALIZE_CONFIRMATION = 'EXECUTE_REPORT_RUNTIME_FINALIZE';

export const REPORT_RUNTIME_FINALIZE_FALSE_FLAGS = Object.freeze([
  'MKT_REPORT_AI_SUMMARY_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
]);

export function parseReportRuntimeFinalizeArgs(argv = []) {
  const unknown = argv.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw failure(`Unsupported report finalize arguments: ${unknown.join(', ')}`, 'REPORT_RUNTIME_FINALIZE_ARGUMENT_INVALID', {
      arguments: unknown,
    });
  }
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertReportRuntimeFinalizeConfirmation(env = {}) {
  if (env.CONFIRM_REPORT_RUNTIME_FINALIZE !== REPORT_RUNTIME_FINALIZE_CONFIRMATION) {
    throw failure(
      `Execution requires CONFIRM_REPORT_RUNTIME_FINALIZE=${REPORT_RUNTIME_FINALIZE_CONFIRMATION}`,
      'REPORT_RUNTIME_FINALIZE_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertReportRuntimeFinalizeEnvironment(env = {}) {
  const expected = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value) {
      throw failure(`${name} must equal ${value}`, 'REPORT_RUNTIME_FINALIZE_TARGET_INVALID', {
        name,
        expected: value,
        actual: env[name] ?? null,
      });
    }
  }
  for (const name of REPORT_RUNTIME_FINALIZE_FALSE_FLAGS) {
    if (readBoolean(env[name]) !== false) {
      throw failure(`${name} must remain false during Report finalization`, 'REPORT_RUNTIME_FINALIZE_FLAG_NOT_CLOSED', {
        name,
        actual: env[name] ?? null,
      });
    }
  }
  return true;
}

export function assertReportSchemaPreviewSafe(preview, options = {}) {
  if (!preview || typeof preview !== 'object') {
    throw failure('Report schema preview did not return an object', 'REPORT_RUNTIME_FINALIZE_SCHEMA_PREVIEW_INVALID');
  }
  if (preview.readyToApply !== true || !Array.isArray(preview.conflicts) || preview.conflicts.length !== 0) {
    throw failure('Report schema preview is not safe to apply', 'REPORT_RUNTIME_FINALIZE_SCHEMA_PREVIEW_UNSAFE', {
      readyToApply: preview.readyToApply === true,
      conflictCount: Array.isArray(preview.conflicts) ? preview.conflicts.length : null,
    });
  }
  if (options.requireClean === true && Array.isArray(preview.actions) && preview.actions.length !== 0) {
    throw failure('Report schema read-back still contains write actions', 'REPORT_RUNTIME_FINALIZE_SCHEMA_READBACK_DIRTY', {
      actionCount: preview.actions.length,
    });
  }
  return true;
}

export function assertDashboardSettingsPreviewSafe(preview, options = {}) {
  if (!preview || preview.ok !== true || preview.mode !== 'preview') {
    throw failure('Dashboard settings preview is invalid', 'REPORT_RUNTIME_FINALIZE_SETTINGS_PREVIEW_INVALID');
  }
  if (preview.schemaReadyToApply !== true || Number(preview.activeLegacySettings ?? 0) < 0) {
    throw failure('Dashboard settings preview is not safe', 'REPORT_RUNTIME_FINALIZE_SETTINGS_PREVIEW_UNSAFE');
  }
  if (Number(preview.deleteCount ?? 0) !== 0 || Number(preview.remoteMutationCount ?? 0) !== 0) {
    throw failure('Dashboard settings preview attempted mutation', 'REPORT_RUNTIME_FINALIZE_SETTINGS_PREVIEW_MUTATING', {
      deleteCount: preview.deleteCount ?? null,
      remoteMutationCount: preview.remoteMutationCount ?? null,
    });
  }
  if (options.requireClean === true) {
    const pending = Number(preview.canonicalCreates ?? 0) + Number(preview.canonicalUpdates ?? 0);
    if (pending !== 0 || Number(preview.activeLegacySettings ?? 0) !== 0) {
      throw failure('Dashboard settings read-back is not clean', 'REPORT_RUNTIME_FINALIZE_SETTINGS_READBACK_DIRTY', {
        canonicalCreates: preview.canonicalCreates ?? null,
        canonicalUpdates: preview.canonicalUpdates ?? null,
        activeLegacySettings: preview.activeLegacySettings ?? null,
      });
    }
  }
  return true;
}

export function mergeReportSchemaEnvironment(baseEnv = {}, applyResult = {}) {
  const updates = applyResult?.environmentUpdates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw failure('Report schema apply did not return environmentUpdates', 'REPORT_RUNTIME_FINALIZE_ENV_UPDATES_MISSING');
  }
  const normalized = {};
  for (const [name, value] of Object.entries(updates)) {
    if (!/^LARK_TABLE_[A-Z0-9_]+$/u.test(name) || typeof value !== 'string' || value.trim() === '') {
      throw failure('Report schema returned an invalid environment update', 'REPORT_RUNTIME_FINALIZE_ENV_UPDATE_INVALID', {
        name,
      });
    }
    normalized[name] = value.trim();
  }
  return Object.freeze({ ...baseEnv, ...normalized });
}

export function safeReportRuntimeFinalizeEvidence(value) {
  if (Array.isArray(value)) return value.map(safeReportRuntimeFinalizeEvidence);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|authorization|cookie|password|consumer_key|consumer_secret)/iu.test(key)) continue;
    output[key] = safeReportRuntimeFinalizeEvidence(nested);
  }
  return output;
}

function readBoolean(value) {
  if (value === false || value === 'false' || value === 0 || value === '0' || value === undefined || value === null || value === '') return false;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return null;
}

function failure(message, code, details = {}) {
  return permanentError(message, { code, details });
}
