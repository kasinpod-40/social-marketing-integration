import { isAbsolute, resolve } from 'node:path';

export const REPORT_RUNTIME_SEALED_MARKER = 'MKT_REPORT_RUNTIME_WINDOW_REPAIR_SEALED';
export const REPORT_RUNTIME_SEALED_ROOT = 'MKT_REPORT_RUNTIME_WINDOW_REPAIR_SEALED_ROOT';
export const REPORT_RUNTIME_SEALED_HEAD = 'MKT_REPORT_RUNTIME_WINDOW_REPAIR_SEALED_HEAD';
export const REPORT_RUNTIME_SEALED_VALUE = '1';

const SHA_40 = /^[0-9a-f]{40}$/u;
const GIT_CONTEXT_ENV_NAMES = Object.freeze([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG_COUNT',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
]);

export function sanitizeReportRuntimeGitEnvironment(baseEnv = {}) {
  const clean = { ...baseEnv };
  for (const name of GIT_CONTEXT_ENV_NAMES) delete clean[name];
  for (const name of Object.keys(clean)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name)) delete clean[name];
  }
  return clean;
}

export function readReportRuntimeSealedContext(env = {}, repositoryRoot = process.cwd()) {
  const marker = optionalText(env[REPORT_RUNTIME_SEALED_MARKER]);
  if (marker === null) return null;
  if (marker !== REPORT_RUNTIME_SEALED_VALUE) throw sealedFailure(
    'Report runtime sealed execution marker is invalid',
    'REPORT_RUNTIME_SEALED_CONTEXT_INVALID',
  );

  const expectedRoot = requireAbsolutePath(env[REPORT_RUNTIME_SEALED_ROOT], REPORT_RUNTIME_SEALED_ROOT);
  const actualRoot = resolve(repositoryRoot);
  if (resolve(expectedRoot) !== actualRoot) throw sealedFailure(
    'Report runtime sealed execution root differs from the current checkout',
    'REPORT_RUNTIME_SEALED_ROOT_MISMATCH',
  );

  const expectedHead = requireHead(env[REPORT_RUNTIME_SEALED_HEAD]);
  return Object.freeze({
    sealed: true,
    root: actualRoot,
    expectedHead,
  });
}

export function assertReportRuntimeSealedHead(context, actualHead) {
  if (!context) return true;
  const head = requireHead(actualHead);
  if (head !== context.expectedHead) throw sealedFailure(
    'Report runtime sealed checkout HEAD differs from the pinned origin/main commit',
    'REPORT_RUNTIME_SEALED_HEAD_MISMATCH',
    { expectedHead: context.expectedHead, actualHead: head },
  );
  return true;
}

export function buildReportRuntimeSealedChildEnvironment(baseEnv = {}, input = {}) {
  const root = requireAbsolutePath(input.root, 'root');
  const head = requireHead(input.head);
  const evidenceDir = requireAbsolutePath(input.evidenceDir, 'evidenceDir');
  const devVarsFile = requireAbsolutePath(input.devVarsFile, 'devVarsFile');
  const wranglerConfigFile = requireAbsolutePath(input.wranglerConfigFile, 'wranglerConfigFile');
  const env = sanitizeReportRuntimeGitEnvironment(baseEnv);
  env[REPORT_RUNTIME_SEALED_MARKER] = REPORT_RUNTIME_SEALED_VALUE;
  env[REPORT_RUNTIME_SEALED_ROOT] = root;
  env[REPORT_RUNTIME_SEALED_HEAD] = head;
  env.MKT_REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_DIR = evidenceDir;
  env.DEV_VARS_FILE = devVarsFile;
  env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG = wranglerConfigFile;
  return Object.freeze(env);
}

export function buildReportRuntimeSealedCloneArgs(originUrl, clonePath) {
  const remote = requireText(originUrl, 'originUrl');
  const destination = requireAbsolutePath(clonePath, 'clonePath');
  return Object.freeze([
    'clone',
    '--no-local',
    '--single-branch',
    '--branch',
    'main',
    '--',
    remote,
    destination,
  ]);
}

function requireAbsolutePath(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!isAbsolute(text)) throw sealedFailure(
    `Report runtime sealed execution requires an absolute ${fieldName}`,
    'REPORT_RUNTIME_SEALED_PATH_INVALID',
    { fieldName },
  );
  return resolve(text);
}

function requireHead(value) {
  const text = requireText(value, REPORT_RUNTIME_SEALED_HEAD).toLowerCase();
  if (!SHA_40.test(text)) throw sealedFailure(
    'Report runtime sealed execution requires a full 40-character Git SHA',
    'REPORT_RUNTIME_SEALED_HEAD_INVALID',
  );
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw sealedFailure(
    `Report runtime sealed execution requires ${fieldName}`,
    'REPORT_RUNTIME_SEALED_VALUE_INVALID',
    { fieldName },
  );
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sealedFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeSealedExecutionError';
  error.code = code;
  error.details = details;
  return error;
}
