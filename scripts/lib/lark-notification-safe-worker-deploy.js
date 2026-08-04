export const LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_NOTIFICATION_SAFE_WORKER_DEPLOY',
  value: 'DEPLOY_LARK_NOTIFICATION_ALL_FLAGS_FALSE',
});

const WORKER_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseLarkNotificationSafeWorkerDeployArgs(args = []) {
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    throw deployError(
      `Unknown Lark notification safe Worker deploy argument: ${arg}`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_ARGUMENT_INVALID',
    );
  }
  return Object.freeze({ execute });
}

export function assertLarkNotificationSafeWorkerDeployConfirmation(env = {}) {
  const confirmation = LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION;
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw deployError(
      `Lark notification safe Worker deploy requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION_REQUIRED',
      { envName: confirmation.envName },
    );
  }
  return true;
}

export function parseLarkNotificationDeploymentStatus(output, expectedVersionId) {
  const expected = requireWorkerVersionId(expectedVersionId, 'expectedVersionId');
  let parsed;
  try {
    parsed = JSON.parse(requireText(output, 'deploymentStatusOutput'));
  } catch {
    throw deployError(
      'Wrangler deployment status output is not valid JSON',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_STATUS_INVALID',
    );
  }

  const allocations = collectTrafficAllocations(parsed);
  const nonZero = allocations.filter((allocation) => allocation.percentage > 0);
  const total = nonZero.reduce((sum, allocation) => sum + allocation.percentage, 0);
  const exact = nonZero.filter((allocation) => allocation.versionId === expected);
  if (
    nonZero.length !== 1
    || exact.length !== 1
    || exact[0].percentage !== 100
    || total !== 100
  ) {
    throw deployError(
      'The exact safe Worker version is not serving 100 percent of traffic',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_STATUS_INVALID',
      {
        expectedVersionId: expected,
        observedVersionIds: nonZero.map((allocation) => allocation.versionId),
        observedPercentages: nonZero.map((allocation) => allocation.percentage),
      },
    );
  }

  return Object.freeze({
    activeVersionId: expected,
    trafficPercentage: 100,
    allocationCount: nonZero.length,
  });
}

export function validateLarkNotificationSafeWorkerDeployEvidence(evidence = {}) {
  const versionId = requireWorkerVersionId(
    evidence.deploymentVersionId,
    'deploymentVersionId',
  );
  const valid = evidence.phase === 'deploy-safe'
    && evidence.status === 'passed'
    && evidence.activeVersionId === versionId
    && evidence.trafficPercentage === 100
    && evidence.notificationFlagsAllFalse === true
    && evidence.activeLocksBefore === 0
    && evidence.activeLocksAfter === 0
    && evidence.businessFactDrift === false
    && evidence.retainedActiveWorkDrift === false
    && evidence.queueSendCount === 0
    && evidence.larkWriteCount === 0
    && evidence.notificationSendCount === 0
    && evidence.automationActivationCount === 0
    && evidence.scheduleActivationCount === 0;
  if (!valid) {
    throw deployError(
      'Lark notification safe Worker deployment evidence is incomplete',
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_EVIDENCE_INVALID',
    );
  }
  return evidence;
}

function collectTrafficAllocations(root) {
  const allocations = [];
  const seen = new Set();
  walk(root);
  return allocations;

  function walk(value) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const versionId = readVersionId(value);
    const percentage = readPercentage(value);
    if (versionId !== null && percentage !== null) {
      const key = `${versionId}:${percentage}`;
      if (!seen.has(key)) {
        seen.add(key);
        allocations.push(Object.freeze({ versionId, percentage }));
      }
    }
    for (const nested of Object.values(value)) walk(nested);
  }
}

function readVersionId(value) {
  for (const key of ['version_id', 'versionId', 'worker_version_id', 'workerVersionId']) {
    if (isWorkerVersionId(value?.[key])) return value[key];
  }
  if (
    isWorkerVersionId(value?.id)
    && Object.keys(value).some((key) => /version/iu.test(key))
  ) return value.id;
  return null;
}

function readPercentage(value) {
  for (const key of [
    'percentage',
    'percent',
    'traffic_percentage',
    'trafficPercentage',
  ]) {
    const number = Number(value?.[key]);
    if (Number.isFinite(number) && number >= 0 && number <= 100) return number;
  }
  return null;
}

function isWorkerVersionId(value) {
  return WORKER_VERSION_ID_PATTERN.test(value ?? '');
}

function requireWorkerVersionId(value, fieldName) {
  if (!isWorkerVersionId(value)) {
    throw deployError(
      `${fieldName} must be a Worker version UUID`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_STATUS_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw deployError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_STATUS_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function deployError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationSafeWorkerDeployError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
