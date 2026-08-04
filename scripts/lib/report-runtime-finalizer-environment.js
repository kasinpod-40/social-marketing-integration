import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT =
  'report_runtime_finalizer_environment_v2';
export const REPORT_RUNTIME_FINALIZER_ENVIRONMENT_FILENAME =
  'report-runtime-finalize-environment.json';

export const REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES = Object.freeze([
  'LARK_TABLE_MKT_METRIC_DEFINITIONS',
  'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  'LARK_TABLE_MKT_REPORT_SETTINGS',
  'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  'LARK_TABLE_MKT_REPORT_TOP_ADS',
  'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
]);
export const REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES = Object.freeze([
  'LARK_TABLE_MKT_AI_REPORT_RUNS',
  'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  'LARK_TABLE_MKT_REPORT_SETTINGS',
  'LARK_TABLE_MKT_NOTIFICATION_LOG',
]);
export const REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS = Object.freeze([
  'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
  'MKT_NOTIFICATION_LARK_SEND_ENABLED',
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
]);

export function buildReportRuntimeFinalizerEnvironment(input = {}) {
  const repositoryHead = requireCommitSha(input.repositoryHead, 'repositoryHead');
  const tableEnvironment = normalizeTableEnvironment(input.environmentUpdates);
  const notificationRuntime = buildNotificationRuntimeEvidence(
    input.notificationRuntimeAuthority,
  );

  return Object.freeze({
    contractVersion: REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
    repositoryHead,
    tableEnvironment,
    tableEnvironmentUpdateCount: REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.length,
    notificationRuntime,
    remoteMutationCount: 0,
  });
}

export async function writeReportRuntimeFinalizerEnvironment(input = {}) {
  const evidenceRoot = requireText(input.evidenceRoot, 'evidenceRoot');
  const evidence = buildReportRuntimeFinalizerEnvironment(input);
  const environmentPath = resolve(
    evidenceRoot,
    REPORT_RUNTIME_FINALIZER_ENVIRONMENT_FILENAME,
  );
  await writeFile(environmentPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze({ evidence, environmentPath });
}

export function loadReportRuntimeFinalizerEnvironment(input = {}) {
  const finalizerEvidencePath = resolve(requireText(
    input.finalizerEvidencePath,
    'finalizerEvidencePath',
  ));
  const environmentPath = resolve(
    dirname(finalizerEvidencePath),
    REPORT_RUNTIME_FINALIZER_ENVIRONMENT_FILENAME,
  );

  let summary;
  let environment;
  try {
    summary = JSON.parse(readFileSync(finalizerEvidencePath, 'utf8'));
    environment = JSON.parse(readFileSync(environmentPath, 'utf8'));
  } catch (cause) {
    throw environmentError(
      'Report Runtime Finalizer private environment cannot be loaded',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_LOAD_FAILED',
      { sourceCode: cause?.code ?? null },
    );
  }

  if (summary?.ok !== true
    || summary?.contractVersion !== 'report_runtime_finalize_v1'
    || summary?.repository?.branch !== 'main'
    || summary?.repository?.clean !== true) {
    throw environmentError(
      'Report Runtime Finalizer summary is not a safe exact-main authority',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_INVALID',
    );
  }

  const normalized = Object.freeze({
    contractVersion: REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
    repositoryHead: requireCommitSha(environment?.repositoryHead, 'repositoryHead'),
    tableEnvironment: normalizeTableEnvironment(environment?.tableEnvironment),
    tableEnvironmentUpdateCount: REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.length,
    notificationRuntime: normalizeStoredNotificationRuntime(
      environment?.notificationRuntime,
    ),
    remoteMutationCount: 0,
  });
  const summaryState = summary?.settings?.notificationRuntimeState;
  const summaryCount = Number(
    summary?.settings?.preservedNotificationRuntimeSettingCount ?? -1,
  );
  if (environment?.contractVersion !== REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT
    || normalized.repositoryHead !== summary.repository.head
    || normalized.tableEnvironmentUpdateCount
      !== Number(environment?.tableEnvironmentUpdateCount)
    || Number(environment?.remoteMutationCount ?? -1) !== 0
    || normalized.notificationRuntime.state !== summaryState
    || normalized.notificationRuntime.settingCount !== summaryCount
    || summary?.runtime?.notificationAdmissionEnabled !== false) {
    throw environmentError(
      'Report Runtime Finalizer private environment does not match its summary',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
      {
        headMatched: normalized.repositoryHead === summary?.repository?.head,
        notificationRuntimeStateMatched:
          normalized.notificationRuntime.state === summaryState,
        notificationRuntimeSettingCountMatched:
          normalized.notificationRuntime.settingCount === summaryCount,
      },
    );
  }

  const expectedRepositoryHead = input.expectedRepositoryHead;
  if (expectedRepositoryHead !== undefined
    && normalized.repositoryHead !== requireCommitSha(
      expectedRepositoryHead,
      'expectedRepositoryHead',
    )) {
    throw environmentError(
      'Report Runtime Finalizer private environment does not match the expected repository Head',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
      { headMatched: false },
    );
  }

  return Object.freeze({
    ...normalized,
    finalizerEvidencePath,
    environmentPath,
  });
}

function normalizeTableEnvironment(value) {
  const updates = requireObject(value, 'environmentUpdates');
  const tableEnvironment = {};
  for (const envName of REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES) {
    tableEnvironment[envName] = requireTableId(updates[envName], envName);
  }
  return Object.freeze(tableEnvironment);
}

function buildNotificationRuntimeEvidence(authority) {
  if (authority === undefined || authority === null || authority.state === 'inactive') {
    return inactiveNotificationRuntime();
  }
  const value = requireObject(authority, 'notificationRuntimeAuthority');
  if (value.state !== 'active') {
    throw environmentError(
      'notificationRuntimeAuthority.state must be active or inactive',
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
    );
  }
  const settingKeys = [...new Set(requireArray(
    value.settingKeys,
    'notificationRuntimeAuthority.settingKeys',
  ).map((item) => requireText(item, 'notificationRuntimeAuthority.settingKey')))].sort();
  if (settingKeys.length !== 4) {
    throw environmentError(
      'Active Notification Runtime requires exactly four Setting keys',
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { settingCount: settingKeys.length },
    );
  }
  const workerEnvironment = requireObject(
    value.workerEnvironment,
    'notificationRuntimeAuthority.workerEnvironment',
  );
  const tableEnvironment = Object.freeze(Object.fromEntries(
    REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES.map((envName) => [
      envName,
      requireTableId(workerEnvironment[envName], envName),
    ]),
  ));
  return Object.freeze({
    state: 'active',
    mode: 'runtime',
    trueFlags: Object.freeze([...REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS]),
    tableEnvironment,
    tableEnvironmentUpdateCount: REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES.length,
    settingCount: settingKeys.length,
    settingKeyFingerprint: sha256(JSON.stringify(settingKeys)),
    destinationKeyHash: requireHash(
      value.destinationKeyHash,
      'notificationRuntimeAuthority.destinationKeyHash',
    ),
  });
}

function normalizeStoredNotificationRuntime(value) {
  const runtime = requireObject(value, 'notificationRuntime');
  if (runtime.state === 'inactive') {
    if (runtime.mode !== 'disabled'
      || Number(runtime.settingCount ?? -1) !== 0
      || Number(runtime.tableEnvironmentUpdateCount ?? -1) !== 0
      || !Array.isArray(runtime.trueFlags)
      || runtime.trueFlags.length !== 0
      || runtime.settingKeyFingerprint !== null
      || runtime.destinationKeyHash !== null
      || !runtime.tableEnvironment
      || Object.keys(runtime.tableEnvironment).length !== 0) {
      throw environmentError(
        'Inactive Notification Runtime private evidence is invalid',
        'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      );
    }
    return inactiveNotificationRuntime();
  }
  if (runtime.state !== 'active'
    || runtime.mode !== 'runtime'
    || Number(runtime.settingCount ?? -1) !== 4
    || Number(runtime.tableEnvironmentUpdateCount ?? -1)
      !== REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES.length
    || JSON.stringify(runtime.trueFlags)
      !== JSON.stringify(REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS)) {
    throw environmentError(
      'Active Notification Runtime private evidence is invalid',
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
    );
  }
  const storedEnvironment = requireObject(
    runtime.tableEnvironment,
    'notificationRuntime.tableEnvironment',
  );
  const tableEnvironment = Object.freeze(Object.fromEntries(
    REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES.map((envName) => [
      envName,
      requireTableId(storedEnvironment[envName], envName),
    ]),
  ));
  return Object.freeze({
    state: 'active',
    mode: 'runtime',
    trueFlags: Object.freeze([...REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS]),
    tableEnvironment,
    tableEnvironmentUpdateCount: REPORT_RUNTIME_NOTIFICATION_TABLE_ENV_NAMES.length,
    settingCount: 4,
    settingKeyFingerprint: requireHash(
      runtime.settingKeyFingerprint,
      'notificationRuntime.settingKeyFingerprint',
    ),
    destinationKeyHash: requireHash(
      runtime.destinationKeyHash,
      'notificationRuntime.destinationKeyHash',
    ),
  });
}

function inactiveNotificationRuntime() {
  return Object.freeze({
    state: 'inactive',
    mode: 'disabled',
    trueFlags: Object.freeze([]),
    tableEnvironment: Object.freeze({}),
    tableEnvironmentUpdateCount: 0,
    settingCount: 0,
    settingKeyFingerprint: null,
    destinationKeyHash: null,
  });
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw environmentError(
      `${field} must be an object`,
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { field },
    );
  }
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw environmentError(
      `${field} must be an array`,
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { field },
    );
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw environmentError(
      `${field} is required`,
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { field },
    );
  }
  return value.trim();
}

function requireHash(value, field) {
  const text = requireText(value, field).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw environmentError(
      `${field} must be SHA-256 hex`,
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { field },
    );
  }
  return text;
}

function requireTableId(value, field) {
  const text = requireText(value, field);
  if (/^(?:replace[-_]|your[-_]|todo$|changeme$)/iu.test(text)) {
    throw environmentError(
      `${field} is not a real Table mapping`,
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { field },
    );
  }
  return text;
}

function requireCommitSha(value, field) {
  const text = requireText(value, field).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw environmentError(
      `${field} must be a full commit SHA`,
      'REPORT_RUNTIME_FINALIZER_ENVIRONMENT_INVALID',
      { field },
    );
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function environmentError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeFinalizerEnvironmentError';
  error.code = code;
  error.details = details;
  return error;
}
