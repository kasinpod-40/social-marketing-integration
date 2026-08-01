import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
} from './chatwoot-final-30d-daily-uat.js';
import {
  fingerprintChatwootFinalSourceRecovery,
} from './chatwoot-final-source-config-recovery.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const CHATWOOT_INITIAL_FAILURE_WORKER_SAFETY_MODES = Object.freeze({
  allFlagsFalse: 'all_flags_false',
  exactSafeBaselineResumeActiveWindow: 'exact_safe_baseline_resume_active_window',
});

export function classifyChatwootInitialFailureWorkerSafety(input = {}) {
  const versionId = requireVersionId(input.versionId);
  const trueFlags = normalizeTrueFlags(input.trueFlags);
  const versionFingerprint = fingerprintChatwootFinalSourceRecovery(versionId);

  if (trueFlags.length === 0) {
    return Object.freeze({
      mode: CHATWOOT_INITIAL_FAILURE_WORKER_SAFETY_MODES.allFlagsFalse,
      allFlagsFalse: true,
      exactActiveResumeWindow: false,
      trueFlags,
      versionFingerprint,
    });
  }

  const expected = [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort();
  if (stableJson(trueFlags) !== stableJson(expected)) {
    throw workerSafetyError(
      'Worker contains an unapproved true execution flag',
      { trueFlags },
    );
  }

  const selectionHint = input.selectionHint;
  if (!selectionHint || selectionHint.activeVersionFingerprint !== versionFingerprint) {
    throw workerSafetyError(
      'Active Worker is not bound to the verified safe-baseline selection handoff',
      {
        trueFlags,
        selectionHandoffPresent: Boolean(selectionHint),
        activeVersionFingerprintMatches:
          selectionHint?.activeVersionFingerprint === versionFingerprint,
      },
    );
  }

  return Object.freeze({
    mode: CHATWOOT_INITIAL_FAILURE_WORKER_SAFETY_MODES
      .exactSafeBaselineResumeActiveWindow,
    allFlagsFalse: false,
    exactActiveResumeWindow: true,
    trueFlags,
    versionFingerprint,
  });
}

function normalizeTrueFlags(value) {
  if (!Array.isArray(value)) {
    throw workerSafetyError('Worker true flags must be an array');
  }
  const normalized = value.map((item) => String(item ?? '').trim());
  if (normalized.some((item) => !/^MKT_[A-Z0-9_]+_ENABLED$/u.test(item))) {
    throw workerSafetyError('Worker true flags contain an invalid name');
  }
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) {
    throw workerSafetyError('Worker true flags contain duplicates', { trueFlags: unique });
  }
  return Object.freeze(unique);
}

function requireVersionId(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(text)) {
    throw workerSafetyError('Worker version identity is invalid');
  }
  return text;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function workerSafetyError(message, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootInitialFailureWorkerSafetyError';
  error.code = 'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE';
  error.details = details;
  return error;
}
