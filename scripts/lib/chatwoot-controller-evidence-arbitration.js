const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT = /^[0-9a-f]{64}$/u;

export function selectChatwootControllerEvidence(candidates = [], currentActiveVersion) {
  const activeVersion = requireVersionId(currentActiveVersion, 'currentActiveVersion');
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

  const matches = [...identities.values()].filter(
    (candidate) => candidate.activeVersion === activeVersion,
  );
  if (matches.length !== 1) {
    throw arbitrationError(
      'Incomplete Chatwoot controller evidence cannot be bound to one current active Worker version',
      'CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS',
      {
        candidateCount: identities.size,
        activeVersionMatchCount: matches.length,
      },
    );
  }

  return Object.freeze({
    ...matches[0],
    candidateCount: identities.size,
    selectedBy: 'current_active_worker_version',
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

function arbitrationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootControllerEvidenceArbitrationError';
  error.code = code;
  error.details = details;
  return error;
}
