import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const SAFE_BASELINE_SELECTION_AUTHORITIES = Object.freeze([
  'current_safe_baseline_version',
  'verified_prior_safe_baseline_attempt',
]);

export function selectChatwootControllerEvidence(
  candidates = [],
  currentActiveVersion,
  safeBaselineSelectionHint = null,
) {
  const activeVersion = requireVersionId(currentActiveVersion, 'currentActiveVersion');
  const selectionHint = safeBaselineSelectionHint === null
    ? null
    : normalizeSelectionHint(safeBaselineSelectionHint);
  const identities = new Map();

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    const existing = identities.get(normalized.evidenceIdentity);
    if (!existing || normalized.modifiedAt > existing.modifiedAt) {
      identities.set(normalized.evidenceIdentity, normalized);
    }
  }

  if (identities.size === 0) {
    throw arbitrationError(
      'No incomplete Chatwoot controller evidence is available',
      'CHATWOOT_CONTROLLER_EVIDENCE_MISSING',
    );
  }

  const activeMatches = [...identities.values()].filter(
    (candidate) => candidate.activeVersion === activeVersion,
  );
  const matches = selectionHint
    ? activeMatches.filter((candidate) => matchesSelectionHint(candidate, selectionHint))
    : activeMatches;
  if (matches.length !== 1) {
    throw arbitrationError(
      selectionHint
        ? 'Incomplete Chatwoot controller evidence cannot be bound to the verified safe-baseline selection handoff'
        : 'Incomplete Chatwoot controller evidence cannot be bound to one current active Worker version',
      selectionHint
        ? 'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_AMBIGUOUS'
        : 'CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS',
      {
        candidateCount: identities.size,
        activeVersionMatchCount: activeMatches.length,
        selectionHandoffMatchCount: selectionHint ? matches.length : undefined,
      },
    );
  }

  return Object.freeze({
    ...matches[0],
    candidateCount: identities.size,
    selectedBy: selectionHint
      ? 'verified_safe_baseline_handoff_and_current_active_worker_version'
      : 'current_active_worker_version',
  });
}

export function validateChatwootSafeBaselineSelectionHint(value = {}, repositoryHead) {
  const head = requireSha(repositoryHead, 'repositoryHead');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw arbitrationError(
      'Chatwoot safe-baseline selection handoff is invalid',
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
    );
  }
  const selectionAuthority = String(value.selectedBy ?? '');
  const verifiedPriorAttempt = selectionAuthority === 'verified_prior_safe_baseline_attempt';
  if (value.contractVersion !== 'chatwoot_controller_safe_baseline_resume_v1'
      || value.repositoryHead !== head
      || value.controllerBoundary !== 'queue_retry_exhausted_terminal_v1'
      || !SAFE_BASELINE_SELECTION_AUTHORITIES.includes(selectionAuthority)
      || value.secondInitialAdmission !== false
      || value.queueAction !== false
      || value.d1Mutation !== false
      || value.larkMutation !== false
      || value.scheduleEnabled !== false
      || value.webhookEnabled !== false
      || value.production !== false) {
    throw arbitrationError(
      'Chatwoot safe-baseline selection handoff does not match the exact reviewed contract',
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
    );
  }
  let priorAttemptHead = null;
  if (verifiedPriorAttempt) {
    priorAttemptHead = requireSha(value.priorAttemptHead, 'priorAttemptHead');
    if (priorAttemptHead === head || value.priorAttemptValidated !== true) {
      throw arbitrationError(
        'Chatwoot prior-attempt selection handoff is invalid',
        'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
      );
    }
  } else if (value.priorAttemptHead !== undefined || value.priorAttemptValidated !== undefined) {
    throw arbitrationError(
      'Ordinary safe-baseline selection handoff contains prior-attempt fields',
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
    );
  }
  const candidateCount = Number(value.candidateCount);
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 1) {
    throw arbitrationError(
      'Chatwoot safe-baseline selection handoff candidate count is invalid',
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
    );
  }
  return Object.freeze({
    repositoryHead: head,
    selectionAuthority,
    priorAttemptHead,
    sessionFingerprint: requireFingerprint(
      value.retainedSessionFingerprint,
      'retainedSessionFingerprint',
    ),
    baselineVersionFingerprint: requireFingerprint(
      value.baselineVersionFingerprint,
      'baselineVersionFingerprint',
    ),
    activeVersionFingerprint: requireFingerprint(
      value.retainedActiveVersionFingerprint,
      'retainedActiveVersionFingerprint',
    ),
    candidateCount,
  });
}

export function readChatwootExecutionFlags(versionView = {}) {
  const item = Array.isArray(versionView) ? versionView[0] : versionView;
  const bindings = item?.bindings ?? item?.resources?.bindings ?? [];
  return Object.freeze(bindings
    .filter((binding) => {
      const name = String(binding?.name ?? binding?.binding ?? '');
      const value = binding?.text ?? binding?.value;
      return /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
        && (value === true || String(value).toLowerCase() === 'true');
    })
    .map((binding) => String(binding?.name ?? binding?.binding))
    .sort());
}

function matchesSelectionHint(candidate, selectionHint) {
  return candidate.sessionFingerprint === selectionHint.sessionFingerprint
    && sha256(candidate.baselineVersion) === selectionHint.baselineVersionFingerprint
    && sha256(candidate.activeVersion) === selectionHint.activeVersionFingerprint;
}

function normalizeSelectionHint(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw arbitrationError(
      'safeBaselineSelectionHint is invalid',
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
    );
  }
  return Object.freeze({
    sessionFingerprint: requireFingerprint(
      value.sessionFingerprint,
      'safeBaselineSelectionHint.sessionFingerprint',
    ),
    baselineVersionFingerprint: requireFingerprint(
      value.baselineVersionFingerprint,
      'safeBaselineSelectionHint.baselineVersionFingerprint',
    ),
    activeVersionFingerprint: requireFingerprint(
      value.activeVersionFingerprint,
      'safeBaselineSelectionHint.activeVersionFingerprint',
    ),
  });
}

function normalizeCandidate(candidate = {}) {
  const sessionFingerprint = requireFingerprint(
    candidate.sessionFingerprint,
    'candidate.sessionFingerprint',
  );
  const baselineVersion = requireVersionId(
    candidate.baselineVersion,
    'candidate.baselineVersion',
  );
  const activeVersion = requireVersionId(
    candidate.activeVersion,
    'candidate.activeVersion',
  );
  const directory = requireText(candidate.directory, 'candidate.directory');
  const directoryName = requireText(candidate.directoryName, 'candidate.directoryName');
  const modifiedAt = Number(candidate.modifiedAt);
  if (!Number.isFinite(modifiedAt) || modifiedAt < 0) {
    throw arbitrationError(
      'candidate.modifiedAt is invalid',
      'CHATWOOT_CONTROLLER_EVIDENCE_INVALID',
    );
  }
  const baseline = requireObject(candidate.baseline, 'candidate.baseline');
  const evidenceIdentity = JSON.stringify({
    sessionFingerprint,
    baselineVersion,
    activeVersion,
    baseline,
  });
  return Object.freeze({
    ...candidate,
    directory,
    directoryName,
    sessionFingerprint,
    baselineVersion,
    activeVersion,
    baseline,
    modifiedAt,
    evidenceIdentity,
  });
}

function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID.test(text)) {
    throw arbitrationError(
      `${fieldName} is invalid`,
      'CHATWOOT_CONTROLLER_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return text.toLowerCase();
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!FINGERPRINT.test(text)) {
    throw arbitrationError(
      `${fieldName} is invalid`,
      'CHATWOOT_CONTROLLER_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireSha(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA.test(text)) {
    throw arbitrationError(
      `${fieldName} is invalid`,
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw arbitrationError(
      `${fieldName} is invalid`,
      'CHATWOOT_CONTROLLER_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw arbitrationError(
      `${fieldName} is required`,
      'CHATWOOT_CONTROLLER_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function arbitrationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootControllerEvidenceArbitrationError';
  error.code = code;
  error.details = details;
  return error;
}
