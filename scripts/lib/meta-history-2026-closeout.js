export function reconcileMetaHistory2026Evidence(input = {}) {
  const plan = requireObject(input.plan, 'plan');
  const operations = requireArray(plan.operations, 'plan.operations');
  const evidenceByOperation = requireObject(input.evidenceByOperation, 'evidenceByOperation');
  const completed = [];

  for (const operation of operations.filter((item) => item?.mode === 'required')) {
    const result = reconcileOperation(operation, evidenceByOperation[operation.operationId]);
    completed.push(result);
  }

  const facebook = completed.find((item) => item.target === 'facebook') ?? null;
  const instagram = completed.find((item) => item.target === 'instagram') ?? null;
  const adsJuly = completed.filter((item) => item.mode === 'required'
    && String(item.target).startsWith('chemistry_k'));
  if (!facebook || !instagram || adsJuly.length !== 2) {
    throw closeoutError(
      'Meta history required operation evidence is incomplete',
      'META_HISTORY_2026_CLOSEOUT_REQUIRED_EVIDENCE_MISSING',
    );
  }

  return deepFreeze({
    completed,
    facebookHistoryCompleted: facebook.larkCompleted,
    instagramCompleted: instagram.larkCompleted,
    metaAdsJulyCompleted: adsJuly.every((item) => item.larkCompleted),
    parityVerified: completed.every((item) => item.larkCompleted),
    idempotentRerunsVerified: completed.every((item) => item.idempotentRerunVerified),
  });
}

export function isRecoverableMetaHistoryFinalSummaryFailure(value = {}) {
  const failed = Array.isArray(value?.details?.failed) ? value.details.failed : [];
  const allowed = new Set([
    'facebookHistoryCompleted',
    'instagramCompleted',
    'adsJulyCompleted',
    'parity',
  ]);
  return value?.stage === 'final-safe-verification'
    && value?.code === 'META_HISTORY_2026_SUMMARY_INVALID'
    && failed.length > 0
    && failed.every((item) => allowed.has(item));
}

function reconcileOperation(operationValue, evidenceValue) {
  const operation = requireObject(operationValue, 'operation');
  const evidence = requireObject(evidenceValue, `evidence.${operation.operationId}`);
  const d1Summary = requireAcceptedSummary(evidence.d1Summary, 'D1');
  const larkSummary = requireAcceptedSummary(evidence.larkSummary, 'Lark');
  const d1Verification = requireObject(evidence.d1Verification, 'd1Verification');

  if (d1Summary.data.d1OnlyVerified !== true
    || d1Summary.data.idempotentRerunVerified !== true
    || d1Summary.data.restoredAllFalse !== true) {
    throw closeoutError(
      'Meta D1 evidence does not prove completion, replay and restore',
      'META_HISTORY_2026_CLOSEOUT_D1_INVALID',
      { operationId: operation.operationId },
    );
  }
  if (larkSummary.data.larkParityVerified !== true
    || larkSummary.data.idempotentRerunVerified !== true
    || larkSummary.data.restoredAllFalse !== true
    || Number(larkSummary.data.providerRequestCount) !== 0) {
    throw closeoutError(
      'Meta Lark evidence does not prove parity, replay and zero Provider reread',
      'META_HISTORY_2026_CLOSEOUT_LARK_INVALID',
      { operationId: operation.operationId },
    );
  }

  return deepFreeze({
    target: requireText(operation.target, 'operation.target'),
    operationId: requireText(operation.operationId, 'operation.operationId'),
    periodStart: requireText(operation.periodStart, 'operation.periodStart'),
    periodEnd: requireText(operation.periodEnd, 'operation.periodEnd'),
    mode: requireText(operation.mode, 'operation.mode'),
    d1Completed: true,
    larkCompleted: true,
    idempotentRerunVerified: true,
    d1Verification,
  });
}

function requireAcceptedSummary(value, label) {
  const summary = requireObject(value, `${label} summary`);
  if (summary?.status !== 'passed'
    || summary?.phase !== 'summary'
    || summary?.data?.accepted !== true) {
    throw closeoutError(
      `${label} summary is not accepted`,
      'META_HISTORY_2026_CLOSEOUT_SUMMARY_INVALID',
      { label },
    );
  }
  return summary;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw closeoutError(
      `${fieldName} must be an object`,
      'META_HISTORY_2026_CLOSEOUT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw closeoutError(
      `${fieldName} must be an array`,
      'META_HISTORY_2026_CLOSEOUT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw closeoutError(
      `${fieldName} is required`,
      'META_HISTORY_2026_CLOSEOUT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function closeoutError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'MetaHistory2026CloseoutError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
