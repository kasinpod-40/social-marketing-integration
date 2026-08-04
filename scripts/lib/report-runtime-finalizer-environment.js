import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT =
  'report_runtime_finalizer_environment_v1';
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

export function buildReportRuntimeFinalizerEnvironment(input = {}) {
  const repositoryHead = requireCommitSha(input.repositoryHead, 'repositoryHead');
  const updates = requireObject(input.environmentUpdates, 'environmentUpdates');
  const tableEnvironment = {};

  for (const envName of REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES) {
    tableEnvironment[envName] = requireTableId(updates[envName], envName);
  }

  return Object.freeze({
    contractVersion: REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
    repositoryHead,
    tableEnvironment: Object.freeze(tableEnvironment),
    tableEnvironmentUpdateCount: REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.length,
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
  return Object.freeze({
    evidence,
    environmentPath,
  });
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

  const normalized = buildReportRuntimeFinalizerEnvironment({
    repositoryHead: environment?.repositoryHead,
    environmentUpdates: environment?.tableEnvironment,
  });
  if (environment?.contractVersion !== REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT
    || normalized.repositoryHead !== summary.repository.head
    || normalized.tableEnvironmentUpdateCount
      !== Number(environment?.tableEnvironmentUpdateCount)) {
    throw environmentError(
      'Report Runtime Finalizer private environment does not match its summary',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_HEAD_MISMATCH',
      { headMatched: normalized.repositoryHead === summary?.repository?.head },
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

function environmentError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeFinalizerEnvironmentError';
  error.code = code;
  error.details = details;
  return error;
}
