import { createHash } from 'node:crypto';

export const FINAL_DELIVERY_READINESS_CONTRACT_VERSION =
  'mkt_final_delivery_readiness_v1';
export const FINAL_DELIVERY_READINESS_STATUS = 'READY_TO_EXECUTE';
export const FINAL_DELIVERY_READINESS_CONFIRMATION =
  'RUN_MKT_FINAL_DELIVERY_READINESS_AUDIT';
export const FINAL_DELIVERY_READINESS_TTL_MS = 30 * 60 * 1000;
export const FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID =
  'woo-final-full-5b56469100a9';
export const FINAL_DELIVERY_META_HEAD =
  'e069380a544575ce0fc9bca53f1fb56944d26c09';
export const FINAL_DELIVERY_META_OPERATION_ID =
  'meta-instagram-d1-20260729t065939687z-1ad3c9';

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function buildFinalDeliveryReadinessManifest(input = {}) {
  const repositoryHead = requireSha40(input.repositoryHead, 'repositoryHead');
  const createdAt = requireIso(input.createdAt, 'createdAt');
  const expiresAt = requireIso(input.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw readinessError(
      'Readiness manifest expiry must be later than creation time',
      'FINAL_DELIVERY_READINESS_EXPIRY_INVALID',
    );
  }
  const local = requireObject(input.local, 'local');
  const cloudflare = requireObject(input.cloudflare, 'cloudflare');
  const woo = requireObject(input.woo, 'woo');
  const lark = requireObject(input.lark, 'lark');
  const meta = requireObject(input.meta, 'meta');

  const manifest = {
    contractVersion: FINAL_DELIVERY_READINESS_CONTRACT_VERSION,
    status: FINAL_DELIVERY_READINESS_STATUS,
    repositoryHead,
    createdAt,
    expiresAt,
    local: {
      devVarsSha256: requireSha256(local.devVarsSha256, 'local.devVarsSha256'),
      wranglerConfigSha256: requireSha256(
        local.wranglerConfigSha256,
        'local.wranglerConfigSha256',
      ),
      packageLockSha256: requireSha256(
        local.packageLockSha256,
        'local.packageLockSha256',
      ),
      nodeMajor: requirePositiveInteger(local.nodeMajor, 'local.nodeMajor'),
      cleanMain: local.cleanMain === true,
      privateInputsSecure: local.privateInputsSecure === true,
    },
    cloudflare: {
      accountId: requireOpaque(cloudflare.accountId, 'cloudflare.accountId'),
      accountIdFingerprint: sha256(cloudflare.accountId),
      authType: requireOneOf(
        cloudflare.authType,
        ['api_token', 'oauth'],
        'cloudflare.authType',
      ),
      workersDevSubdomain: requireDnsLabel(
        cloudflare.workersDevSubdomain,
        'cloudflare.workersDevSubdomain',
      ),
      workersDevSubdomainFingerprint: sha256(cloudflare.workersDevSubdomain),
      workerName: requireDnsLabel(cloudflare.workerName, 'cloudflare.workerName'),
      activeVersionId: requireOpaque(
        cloudflare.activeVersionId,
        'cloudflare.activeVersionId',
      ),
      executionFlagsAllFalse: cloudflare.executionFlagsAllFalse === true,
      previewUrlsEnabled: cloudflare.previewUrlsEnabled === true,
      workersDevEnabled: cloudflare.workersDevEnabled === true,
      queueId: requireOpaque(cloudflare.queueId, 'cloudflare.queueId'),
      queueIdFingerprint: sha256(cloudflare.queueId),
      requiredSecretNamesPresent:
        cloudflare.requiredSecretNamesPresent === true,
      secretNameFingerprint: requireSha256(
        cloudflare.secretNameFingerprint,
        'cloudflare.secretNameFingerprint',
      ),
    },
    woo: {
      incidentOperationId: requireExact(
        woo.incidentOperationId,
        FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
        'woo.incidentOperationId',
      ),
      incidentState: requireOneOf(
        woo.incidentState,
        ['active_recovery_required', 'terminal_recovery_complete'],
        'woo.incidentState',
      ),
      syncRunStatus: requireExact(
        woo.syncRunStatus,
        'failed',
        'woo.syncRunStatus',
      ),
      syncRunErrorCode: requireExact(
        woo.syncRunErrorCode,
        'WOOCOMMERCE_INVALID_JSON',
        'woo.syncRunErrorCode',
      ),
      activeLockCount: requireZero(woo.activeLockCount, 'woo.activeLockCount'),
      queueOperationAttempts: requireExactInteger(
        woo.queueOperationAttempts,
        1,
        'woo.queueOperationAttempts',
      ),
      coverageRunCount: requireZero(
        woo.coverageRunCount,
        'woo.coverageRunCount',
      ),
      incidentBusinessRows: requireZero(
        woo.incidentBusinessRows,
        'woo.incidentBusinessRows',
      ),
      retainedBusinessRows: requireNonNegativeInteger(
        woo.retainedBusinessRows,
        'woo.retainedBusinessRows',
      ),
      cleanupOldRows: requireZero(woo.cleanupOldRows, 'woo.cleanupOldRows'),
      cleanupAggregateRows: requireZero(
        woo.cleanupAggregateRows,
        'woo.cleanupAggregateRows',
      ),
      cleanupComplete: woo.cleanupComplete === true,
    },
    lark: {
      reachable: lark.reachable === true,
      tableCount: requirePositiveInteger(lark.tableCount, 'lark.tableCount'),
      schemaRepairRequired: requireExact(
        lark.schemaRepairRequired,
        false,
        'lark.schemaRepairRequired',
      ),
      tableIdentityFingerprint: requireSha256(
        lark.tableIdentityFingerprint,
        'lark.tableIdentityFingerprint',
      ),
    },
    meta: {
      repositoryHead: requireExact(
        meta.repositoryHead,
        FINAL_DELIVERY_META_HEAD,
        'meta.repositoryHead',
      ),
      sessionCompleted: meta.sessionCompleted === true,
      exactOperationPresent: meta.exactOperationPresent === true,
      sessionSha256: requireSha256(meta.sessionSha256, 'meta.sessionSha256'),
      overlaySha256: requireSha256(meta.overlaySha256, 'meta.overlaySha256'),
      finalizerSha256: requireSha256(meta.finalizerSha256, 'meta.finalizerSha256'),
      clonePath: requireOpaque(meta.clonePath, 'meta.clonePath'),
      sessionPath: requireOpaque(meta.sessionPath, 'meta.sessionPath'),
      overlayPath: requireOpaque(meta.overlayPath, 'meta.overlayPath'),
      finalizerPath: requireOpaque(meta.finalizerPath, 'meta.finalizerPath'),
    },
    safety: {
      providerRequestCount: requireZero(
        input.safety?.providerRequestCount,
        'safety.providerRequestCount',
      ),
      workerVersionUploadCount: requireZero(
        input.safety?.workerVersionUploadCount,
        'safety.workerVersionUploadCount',
      ),
      workerDeploymentCount: requireZero(
        input.safety?.workerDeploymentCount,
        'safety.workerDeploymentCount',
      ),
      queueMessageCount: requireZero(
        input.safety?.queueMessageCount,
        'safety.queueMessageCount',
      ),
      d1MutationCount: requireZero(
        input.safety?.d1MutationCount,
        'safety.d1MutationCount',
      ),
      larkMutationCount: requireZero(
        input.safety?.larkMutationCount,
        'safety.larkMutationCount',
      ),
      scheduleMutationCount: requireZero(
        input.safety?.scheduleMutationCount,
        'safety.scheduleMutationCount',
      ),
      production: false,
    },
  };

  const failed = [];
  if (!manifest.local.cleanMain) failed.push('local.cleanMain');
  if (!manifest.local.privateInputsSecure) failed.push('local.privateInputsSecure');
  if (!manifest.cloudflare.executionFlagsAllFalse) {
    failed.push('cloudflare.executionFlagsAllFalse');
  }
  if (!manifest.cloudflare.requiredSecretNamesPresent) {
    failed.push('cloudflare.requiredSecretNamesPresent');
  }
  if (!manifest.lark.reachable) failed.push('lark.reachable');
  if (manifest.lark.schemaRepairRequired) failed.push('lark.schemaRepairRequired');
  if (!manifest.meta.exactOperationPresent) failed.push('meta.exactOperationPresent');
  if (!manifest.woo.cleanupComplete) failed.push('woo.cleanupComplete');
  if (failed.length > 0) {
    throw readinessError(
      'Readiness manifest contains failed gates',
      'FINAL_DELIVERY_READINESS_GATES_FAILED',
      { failed },
    );
  }
  return Object.freeze(structuredClone(manifest));
}

export function assertFinalDeliveryReadinessManifest(manifest = {}, input = {}) {
  if (manifest.contractVersion !== FINAL_DELIVERY_READINESS_CONTRACT_VERSION
    || manifest.status !== FINAL_DELIVERY_READINESS_STATUS) {
    throw readinessError(
      'Final delivery readiness manifest contract is invalid',
      'FINAL_DELIVERY_READINESS_MANIFEST_INVALID',
    );
  }
  const expectedHead = requireSha40(input.repositoryHead, 'repositoryHead');
  if (manifest.repositoryHead !== expectedHead) {
    throw readinessError(
      'Readiness manifest repository head changed',
      'FINAL_DELIVERY_READINESS_HEAD_CHANGED',
    );
  }
  const now = Number(input.now ?? Date.now());
  if (!Number.isFinite(now) || now >= Date.parse(manifest.expiresAt)) {
    throw readinessError(
      'Readiness manifest expired',
      'FINAL_DELIVERY_READINESS_MANIFEST_EXPIRED',
    );
  }
  if (input.devVarsSha256
    && manifest.local?.devVarsSha256 !== requireSha256(
      input.devVarsSha256,
      'devVarsSha256',
    )) {
    throw readinessError(
      'Local .dev.vars changed after readiness audit',
      'FINAL_DELIVERY_READINESS_LOCAL_INPUT_CHANGED',
      { input: 'devVars' },
    );
  }
  if (input.wranglerConfigSha256
    && manifest.local?.wranglerConfigSha256 !== requireSha256(
      input.wranglerConfigSha256,
      'wranglerConfigSha256',
    )) {
    throw readinessError(
      'Local Wrangler config changed after readiness audit',
      'FINAL_DELIVERY_READINESS_LOCAL_INPUT_CHANGED',
      { input: 'wranglerConfig' },
    );
  }
  return Object.freeze(structuredClone(manifest));
}

export function inspectMetaSession(session = {}, input = {}) {
  const expectedHead = requireExact(
    input.repositoryHead,
    FINAL_DELIVERY_META_HEAD,
    'repositoryHead',
  );
  const expectedOperation = requireExact(
    input.operationId,
    FINAL_DELIVERY_META_OPERATION_ID,
    'operationId',
  );
  if (session.repositoryHead !== expectedHead) {
    throw readinessError(
      'Meta session repository head changed',
      'FINAL_DELIVERY_READINESS_META_HEAD_INVALID',
    );
  }
  const exactOperationPresent = containsExactValue(session, expectedOperation);
  if (!exactOperationPresent) {
    throw readinessError(
      'Meta session no longer contains the exact Instagram operation',
      'FINAL_DELIVERY_READINESS_META_OPERATION_INVALID',
    );
  }
  return Object.freeze({
    repositoryHead: expectedHead,
    sessionCompleted: session.completed === true,
    exactOperationPresent,
  });
}

export function containsExactValue(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsExactValue(item, expected));
  if (!value || typeof value !== 'object') return value === expected;
  return Object.values(value).some((item) => containsExactValue(item, expected));
}

export function readinessSummary(manifest) {
  return Object.freeze({
    ok: true,
    status: manifest.status,
    contractVersion: manifest.contractVersion,
    repositoryHead: manifest.repositoryHead,
    expiresAt: manifest.expiresAt,
    localInputsVerified: true,
    cloudflareAccountResolved: true,
    workersDevSubdomainResolved: true,
    workerExecutionFlagsAllFalse: true,
    queueResolved: true,
    requiredWorkerSecretNamesPresent: true,
    wooIncidentState: manifest.woo.incidentState,
    wooIncidentBusinessRows: manifest.woo.incidentBusinessRows,
    wooCleanupComplete: true,
    larkReadOnlySchemaReady: true,
    metaPinnedStateReady: true,
    providerRequestCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    queueMessageCount: 0,
    d1MutationCount: 0,
    larkMutationCount: 0,
    production: false,
  });
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function requireDnsLabel(value, fieldName) {
  const text = requireOpaque(value, fieldName).toLowerCase();
  if (!DNS_LABEL.test(text)) {
    throw readinessError(
      `${fieldName} must be a DNS-safe label`,
      'FINAL_DELIVERY_READINESS_VALUE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw readinessError(
      `${fieldName} must be an object`,
      'FINAL_DELIVERY_READINESS_VALUE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireOpaque(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw readinessError(
      `${fieldName} is required`,
      'FINAL_DELIVERY_READINESS_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function requireSha40(value, fieldName) {
  const text = requireOpaque(value, fieldName).toLowerCase();
  if (!SHA40.test(text)) throw readinessError(
    `${fieldName} must be a full Git SHA`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireSha256(value, fieldName) {
  const text = requireOpaque(value, fieldName).toLowerCase();
  if (!SHA256.test(text)) throw readinessError(
    `${fieldName} must be a SHA-256 digest`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireIso(value, fieldName) {
  const text = requireOpaque(value, fieldName);
  if (!Number.isFinite(Date.parse(text))) throw readinessError(
    `${fieldName} must be an ISO timestamp`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return new Date(text).toISOString();
}

function requireOneOf(value, allowed, fieldName) {
  const text = requireOpaque(value, fieldName);
  if (!allowed.includes(text)) throw readinessError(
    `${fieldName} is not allowed`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw readinessError(
    `${fieldName} must equal ${expected}`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return expected;
}

function requirePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw readinessError(
    `${fieldName} must be a positive integer`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return number;
}

function requireNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw readinessError(
    `${fieldName} must be a non-negative integer`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName },
  );
  return number;
}

function requireZero(value, fieldName) {
  return requireExactInteger(value, 0, fieldName);
}

function requireExactInteger(value, expected, fieldName) {
  const number = requireNonNegativeInteger(value, fieldName);
  if (number !== expected) throw readinessError(
    `${fieldName} must equal ${expected}`,
    'FINAL_DELIVERY_READINESS_VALUE_INVALID',
    { fieldName, expected, observed: number },
  );
  return number;
}

function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'FinalDeliveryReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
