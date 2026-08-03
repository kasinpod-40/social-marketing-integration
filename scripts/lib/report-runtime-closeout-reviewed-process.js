import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createCommandRunner({ execFileAsync, cwd, baseEnv = {} }) {
  async function runCapture(command, args, options = {}) {
    return execFileAsync(command, args, {
      cwd,
      env: { ...baseEnv, ...(options.env ?? {}) },
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  async function run(command, args, options = {}) { await runCapture(command, args, options); }
  async function runText(command, args, options = {}) {
    const result = await runCapture(command, args, options);
    return options.trim === false ? result.stdout : result.stdout.trim();
  }
  return Object.freeze({ run, runText, runCapture });
}

export async function assertReviewedRepositoryState({ run, runText }) {
  await run('git', ['fetch', 'origin', 'main', '--quiet']);
  const [branch, head, originMainHead, dirty] = await Promise.all([
    runText('git', ['branch', '--show-current']),
    runText('git', ['rev-parse', 'HEAD']),
    runText('git', ['rev-parse', 'origin/main']),
    runText('git', ['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  if (branch !== 'main' || head !== originMainHead || dirty.trim() !== '') throw closeoutFailure(
    'Report closeout requires a clean current main checkout equal to origin/main',
    'REPORT_RUNTIME_CLOSEOUT_REPOSITORY_STATE_INVALID',
    { branch, head, originMainHead, clean: dirty.trim() === '' },
  );
  return Object.freeze({ branch, head, reviewedHead: head, originMainHead, clean: true });
}

export async function writeReviewedAttempt(outputRoot, name, value) {
  const path = `${outputRoot}/${name}.attempt.json`;
  try {
    await stat(path);
    throw closeoutFailure(
      `A prior Report closeout ${name} attempt exists; automatic repetition is disabled`,
      'REPORT_RUNTIME_CLOSEOUT_ATTEMPT_ALREADY_EXISTS',
      { name },
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writePrivateJson(path, { ...value, attemptedAt: new Date().toISOString() });
}

export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export function closeoutFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}
export function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
export function sqlText(value) { return String(value).replaceAll("'", "''"); }
export function stableJson(value) { return JSON.stringify(value); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw closeoutFailure(
    `${fieldName} must be a positive integer`,
    'REPORT_RUNTIME_CLOSEOUT_VALUE_INVALID',
    { fieldName },
  );
  return number;
}
export function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
