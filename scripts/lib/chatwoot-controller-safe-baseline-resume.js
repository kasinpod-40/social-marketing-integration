import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT = /^[0-9a-f]{64}$/u;

export function selectChatwootControllerSafeBaselineEvidence(
  candidates = [],
  currentActiveVersion,
  enabledFlags = [],
  verifiedPriorSelectionHint = null,
) {
  const baselineVersion = requireVersionId(currentActiveVersion, 'currentActiveVersion');
  const selectionHint = verifiedPriorSelectionHint === null
    ? null
    : normalizeSelectionHint(verifiedPriorSelectionHint);
  if (!Array.isArray(enabledFlags) || enabledFlags.length !== 0) {
    throw safeBaselineError(
      'Current Worker must have every execution flag false before safe-baseline resume',
      'CHATWOOT_SAFE_BASELINE_WORKER_FLAGS_INVALID',
      { enabledFlags: normalizeFlags(enabledFlags) },
    );
  }

  const identities = new Map();
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    const existing = identities.get(normalized.evidenceIdentity);
    if (!existing || normalized.modifiedAt > existing.modifiedAt) {
      identities.set(normalized.evidenceIdentity, normalized);
    }
  }

  if (identities.size === 0) {
    throw safeBaselineError(
      'No incomplete Chatwoot controller evidence is available',
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_MISSING',
    );
  }

  const values = [...identities.values()];
  const baselineMatches = values.filter(
    (candidate) => candidate.baselineVersion === baselineVersion,
  );
  const matches = selectionHint
    ? values.filter((candidate) => matchesSelectionHint(candidate, selectionHint))
    : baselineMatches;
  if (matches.length !== 1) {
    throw safeBaselineError(
      selectionHint
        ? 'Incomplete Chatwoot controller evidence cannot be bound to the verified prior safe-baseline attempt'
        : 'Incomplete Chatwoot controller evidence cannot be bound to one current safe baseline',
      selectionHint
        ? 'CHATWOOT_SAFE_BASELINE_PRIOR_SELECTION_AMBIGUOUS'
        : 'CHATWOOT_SAFE_BASELINE_EVIDENCE_AMBIGUOUS',
      {
        candidateCount: identities.size,
        baselineVersionMatchCount: baselineMatches.length,
        priorSelectionMatchCount: selectionHint ? matches.length : undefined,
      },
    );
  }
  if (matches[0].activeVersion === matches[0].baselineVersion) {
    throw safeBaselineError(
      'Retained Chatwoot active version must differ from the safe baseline version',
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
    );
  }

  return Object.freeze({
    ...matches[0],
    candidateCount: identities.size,
    selectedBy: selectionHint
      ? 'verified_prior_safe_baseline_attempt'
      : 'current_safe_baseline_version',
  });
}

function matchesSelectionHint(candidate, selectionHint) {
  return candidate.sessionFingerprint === selectionHint.sessionFingerprint
    && sha256(candidate.baselineVersion) === selectionHint.baselineVersionFingerprint
    && sha256(candidate.activeVersion) === selectionHint.activeVersionFingerprint;
}

function normalizeSelectionHint(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw safeBaselineError(
      'verifiedPriorSelectionHint is invalid',
      'CHATWOOT_SAFE_BASELINE_PRIOR_SELECTION_INVALID',
    );
  }
  return Object.freeze({
    sessionFingerprint: requireFingerprint(
      value.sessionFingerprint,
      'verifiedPriorSelectionHint.sessionFingerprint',
    ),
    baselineVersionFingerprint: requireFingerprint(
      value.baselineVersionFingerprint,
      'verifiedPriorSelectionHint.baselineVersionFingerprint',
    ),
    activeVersionFingerprint: requireFingerprint(
      value.activeVersionFingerprint,
      'verifiedPriorSelectionHint.activeVersionFingerprint',
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
    throw safeBaselineError(
      'candidate.modifiedAt is invalid',
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
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

function normalizeFlags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .sort();
}

function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID.test(text)) {
    throw safeBaselineError(
      `${fieldName} is invalid`,
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return text.toLowerCase();
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!FINGERPRINT.test(text)) {
    throw safeBaselineError(
      `${fieldName} is invalid`,
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw safeBaselineError(
      `${fieldName} is invalid`,
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw safeBaselineError(
      `${fieldName} is required`,
      'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeBaselineError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeBaselineResumeError';
  error.code = code;
  error.details = details;
  return error;
}
