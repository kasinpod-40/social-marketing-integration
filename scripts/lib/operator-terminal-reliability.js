import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const OPERATOR_TERMINAL_RELIABILITY_CONTRACT =
  'operator_terminal_reliability_v1';

export const OPERATOR_TERMINAL_EXIT_CODES = Object.freeze({
  success: 0,
  precheckBlocked: 2,
  executionFailed: 1,
});

const PREFLIGHT_STAGES = new Set([
  'confirmation',
  'repository-read-only-preflight',
  'meta-remote-lock-release-preflight',
  'local-terminal-acceptance',
]);
const BLOCKED_KEY = /(?:token|secret|authorization|cookie|password|consumer[_-]?key|consumer[_-]?secret|table.?id|database.?id|queue.?id|version.?id|uuid|raw)/iu;

export function classifyOperatorTerminalExit(stage, error = null) {
  if (PREFLIGHT_STAGES.has(stage)) return Object.freeze({
    exitCode: OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked,
    exitClass: 'PRECHECK_BLOCKED',
  });
  if (error?.code === 'YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION_REQUIRED'
    || error?.code === 'YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD_REQUIRED'
    || error?.code?.startsWith?.('YOUTUBE_REPORT_REMOTE_REPOSITORY_')
    || error?.code?.startsWith?.('YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_')) {
    return Object.freeze({
      exitCode: OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked,
      exitClass: 'PRECHECK_BLOCKED',
    });
  }
  return Object.freeze({
    exitCode: OPERATOR_TERMINAL_EXIT_CODES.executionFailed,
    exitClass: 'EXECUTION_FAILED',
  });
}

export function buildShellFreeCommandSpec(input = {}) {
  const executable = requireText(input.executable, 'executable');
  const args = Array.isArray(input.args) ? input.args.map((value) => requireText(value, 'argument')) : [];
  const requiredEnv = Array.isArray(input.requiredEnv)
    ? input.requiredEnv.map((value) => requireText(value, 'requiredEnv')).sort()
    : [];
  if (args.some((value) => /[\r\n\0]/u.test(value))) throw reliabilityError(
    'Terminal command arguments must not contain line breaks or NUL bytes',
    'OPERATOR_TERMINAL_ARGUMENT_UNSAFE',
  );
  return Object.freeze({
    executable,
    args: Object.freeze(args),
    requiredEnv: Object.freeze(requiredEnv),
    shell: false,
  });
}

export function runJsonProcess(command, options = {}) {
  const spec = buildShellFreeCommandSpec(command);
  const result = spawnSync(spec.executable, spec.args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw reliabilityError(
    'Unable to start terminal subprocess',
    'OPERATOR_TERMINAL_PROCESS_START_FAILED',
    { errorCode: result.error.code ?? null },
  );
  const output = parseJsonStream(result.stdout, 'stdout');
  return Object.freeze({
    status: result.status,
    signal: result.signal ?? null,
    stdout: output,
    stderrPresent: String(result.stderr ?? '').trim() !== '',
  });
}

export async function inspectPrivateJsonFile(path, options = {}) {
  const resolvedPath = resolve(requireText(path, options.field ?? 'path'));
  const requiredMode = options.requiredMode ?? 0o600;
  let file;
  try {
    file = await stat(resolvedPath);
  } catch (error) {
    throw reliabilityError(
      `${options.label ?? 'Evidence'} file is unavailable`,
      'OPERATOR_TERMINAL_FILE_UNAVAILABLE',
      { field: options.field ?? 'path', sourceCode: error?.code ?? null },
    );
  }
  if (!file.isFile()) throw reliabilityError(
    `${options.label ?? 'Evidence'} path must be a regular file`,
    'OPERATOR_TERMINAL_FILE_INVALID',
    { field: options.field ?? 'path' },
  );
  if ((file.mode & 0o077) !== (requiredMode & 0o077)) throw reliabilityError(
    `${options.label ?? 'Evidence'} file must use private mode 0600`,
    'OPERATOR_TERMINAL_FILE_MODE_INVALID',
    { field: options.field ?? 'path', expectedMode: '0600' },
  );
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolvedPath, 'utf8'));
  } catch (error) {
    throw reliabilityError(
      `${options.label ?? 'Evidence'} file must contain valid JSON`,
      'OPERATOR_TERMINAL_FILE_JSON_INVALID',
      { field: options.field ?? 'path', sourceCode: error?.code ?? null },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw reliabilityError(
    `${options.label ?? 'Evidence'} JSON must be an object`,
    'OPERATOR_TERMINAL_FILE_JSON_INVALID',
    { field: options.field ?? 'path' },
  );
  return Object.freeze({ path: resolvedPath, value: parsed });
}

export async function assertWritableEvidencePath(path) {
  const resolvedPath = resolve(requireText(path, 'evidencePath'));
  const parent = dirname(resolvedPath);
  await mkdir(parent, { recursive: true });
  try {
    await access(parent, fsConstants.W_OK);
  } catch (error) {
    throw reliabilityError(
      'Terminal evidence directory is not writable',
      'OPERATOR_TERMINAL_EVIDENCE_DIRECTORY_NOT_WRITABLE',
      { sourceCode: error?.code ?? null },
    );
  }
  return Object.freeze({ path: resolvedPath, parentWritable: true });
}

export async function writePrivateJson(path, value) {
  const resolvedPath = resolve(requireText(path, 'path'));
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(resolvedPath, 0o600);
  return resolvedPath;
}

export async function collectAcceptanceGate(gates, name, operation) {
  try {
    const evidence = await operation();
    gates.push(Object.freeze({
      name,
      status: 'pass',
      evidence: sanitizeOperatorTerminalValue(evidence ?? {}),
    }));
    return evidence;
  } catch (error) {
    gates.push(Object.freeze({
      name,
      status: 'blocked',
      code: error?.code ?? 'OPERATOR_TERMINAL_ACCEPTANCE_BLOCKED',
      message: String(error?.message ?? error),
      details: sanitizeOperatorTerminalValue(error?.details ?? {}),
    }));
    return null;
  }
}

export function sanitizeOperatorTerminalValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeOperatorTerminalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_KEY.test(key))
    .map(([key, nested]) => [key, sanitizeOperatorTerminalValue(nested)]));
}

export function parseJsonStream(value, label = 'output') {
  const text = String(value ?? '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  throw reliabilityError(
    `Terminal ${label} did not contain valid JSON`,
    'OPERATOR_TERMINAL_JSON_INVALID',
    { label },
  );
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw reliabilityError(
    `${field} is required`,
    'OPERATOR_TERMINAL_INPUT_INVALID',
    { field },
  );
  return value.trim();
}

function reliabilityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'OperatorTerminalReliabilityError';
  error.code = code;
  error.details = details;
  return error;
}
