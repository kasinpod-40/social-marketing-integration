import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  validateChatwootSafeBaselineSelectionHint,
} from './chatwoot-controller-evidence-arbitration.js';

const CONTRACT_VERSION = 'chatwoot_controller_safe_baseline_resume_v1';
const EXPECTED_FILES = Object.freeze([
  '01-active-window.attempt.json',
  '02-safe-restore.json',
]);
const SHA = /^[0-9a-f]{40}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function loadChatwootSafeBaselinePriorAttempt({
  directory,
  priorHead,
  currentWorker,
}) {
  const head = requireSha(priorHead, 'priorHead');
  await assertRealDirectory(directory);
  const entries = (await readdir(directory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify(EXPECTED_FILES)) {
    throw priorAttemptError(
      'Prior Chatwoot safe-baseline evidence does not contain the exact resumable file set',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_FILE_SET_INVALID',
      { entries },
    );
  }
  const attemptPath = join(directory, EXPECTED_FILES[0]);
  const restorePath = join(directory, EXPECTED_FILES[1]);
  await Promise.all([
    assertPrivateRegularFile(attemptPath),
    assertPrivateRegularFile(restorePath),
  ]);
  const [attempt, restore] = await Promise.all([
    readJson(attemptPath),
    readJson(restorePath),
  ]);
  return validateChatwootSafeBaselinePriorAttempt({
    priorHead: head,
    entries,
    attempt,
    restore,
    currentWorker,
  });
}

export function validateChatwootSafeBaselinePriorAttempt({
  priorHead,
  entries,
  attempt,
  restore,
  currentWorker,
}) {
  const head = requireSha(priorHead, 'priorHead');
  if (JSON.stringify([...(entries ?? [])].sort()) !== JSON.stringify(EXPECTED_FILES)) {
    throw priorAttemptError(
      'Prior Chatwoot safe-baseline evidence file set is not exact',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_FILE_SET_INVALID',
      { entries: [...(entries ?? [])].sort() },
    );
  }

  let selection;
  try {
    selection = validateChatwootSafeBaselineSelectionHint(attempt, head);
  } catch (cause) {
    throw priorAttemptError(
      'Prior Chatwoot active-window attempt is outside the reviewed handoff contract',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_INVALID',
      { handoffCode: cause?.code ?? 'HANDOFF_INVALID' },
    );
  }

  const acceptedRestore = restore?.contractVersion === CONTRACT_VERSION
    && restore?.repositoryHead === head
    && restore?.retainedSessionFingerprint === selection.sessionFingerprint
    && restore?.restoredAllFlagsFalse === true
    && typeof restore?.restoreDeployment === 'boolean'
    && FINGERPRINT.test(String(restore?.finalVersionFingerprint ?? ''))
    && restore?.scheduleEnabled === false
    && restore?.webhookEnabled === false
    && restore?.production === false;
  if (!acceptedRestore) {
    throw priorAttemptError(
      'Prior Chatwoot safe-restore evidence is outside the exact reviewed contract',
      'CHATWOOT_SAFE_BASELINE_PRIOR_RESTORE_INVALID',
    );
  }

  const activeVersion = requireVersionId(currentWorker?.activeVersion, 'currentWorker.activeVersion');
  const enabledFlags = normalizeFlags(currentWorker?.enabledFlags);
  if (enabledFlags.length !== 0) {
    throw priorAttemptError(
      'Current Worker is not all-false after the retained Chatwoot attempt',
      'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_UNSAFE',
      { enabledFlags },
    );
  }
  const currentFingerprint = sha256(activeVersion);
  if (currentFingerprint !== restore.finalVersionFingerprint) {
    throw priorAttemptError(
      'Current Worker version does not match the retained safe-restore evidence',
      'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_DRIFT',
      {
        expectedVersionFingerprint: restore.finalVersionFingerprint,
        observedVersionFingerprint: currentFingerprint,
      },
    );
  }

  return Object.freeze({
    accepted: true,
    priorHead: head,
    retainedSessionFingerprint: selection.sessionFingerprint,
    baselineVersionFingerprint: selection.baselineVersionFingerprint,
    retainedActiveVersionFingerprint: selection.activeVersionFingerprint,
    finalVersionFingerprint: restore.finalVersionFingerprint,
    restoreDeployment: restore.restoreDeployment,
    currentWorkerAllFlagsFalse: true,
    currentWorkerVersionFingerprint: currentFingerprint,
    fileCount: EXPECTED_FILES.length,
  });
}

async function assertRealDirectory(path) {
  let link;
  let info;
  try {
    [link, info] = await Promise.all([lstat(path), stat(path)]);
  } catch (cause) {
    throw priorAttemptError(
      'Prior Chatwoot safe-baseline evidence directory is missing',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_MISSING',
      { errorCode: cause?.code ?? 'STAT_FAILED' },
    );
  }
  if (link.isSymbolicLink() || !info.isDirectory()) {
    throw priorAttemptError(
      'Prior Chatwoot safe-baseline evidence must be a real directory',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_INVALID',
    );
  }
}

async function assertPrivateRegularFile(path) {
  const [link, info] = await Promise.all([lstat(path), stat(path)]);
  if (link.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) {
    throw priorAttemptError(
      'Prior Chatwoot safe-baseline evidence must be a private regular file',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_INVALID',
    );
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw priorAttemptError(
      'Prior Chatwoot safe-baseline evidence JSON is invalid',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_INVALID',
      { errorCode: cause?.code ?? 'JSON_PARSE_FAILED' },
    );
  }
}

function normalizeFlags(value) {
  if (!Array.isArray(value)) {
    throw priorAttemptError(
      'Current Worker flags are invalid',
      'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_UNSAFE',
    );
  }
  return Object.freeze([...new Set(value.map((item) => String(item ?? '').trim()))].sort());
}

function requireSha(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) {
    throw priorAttemptError(
      `${field} must be an exact Git SHA`,
      'CHATWOOT_SAFE_BASELINE_PRIOR_HEAD_INVALID',
      { field },
    );
  }
  return text;
}

function requireVersionId(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(text)) {
    throw priorAttemptError(
      `${field} is invalid`,
      'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_UNSAFE',
      { field },
    );
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function priorAttemptError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeBaselinePriorAttemptError';
  error.code = code;
  error.details = details;
  return error;
}
