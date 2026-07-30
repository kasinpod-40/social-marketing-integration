export const REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION = 'report_runtime_config_dlq_evidence_head_bridge_v1';
export const REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION = 'BRIDGE_EXACT_REPORT_CONFIG_DLQ_RETRY_HEAD';
export const REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD = '55db035555f6bd5205c049df318990691e4011e9';

export function assertReportRuntimeConfigDlqEvidenceHeadBridgeConfirmation(env = {}) {
  if (env.CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE
    !== REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION) {
    throw bridgeError(
      `Execution requires CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE=${REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION}`,
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertReportRuntimeConfigDlqRetryAttemptForHeadBridge(attempt = {}, input = {}) {
  const currentHead = requireGitSha(input.currentHead, 'currentHead');
  const sourceHead = REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD;
  const expectedReportId = requireText(input.reportId, 'reportId');
  const expectedDlqId = requireText(input.dlqId, 'dlqId');
  const originalSha256 = optionalSha256(input.originalSha256);
  const repositoryHead = requireGitSha(attempt.repositoryHead, 'attempt.repositoryHead');
  const alreadyBridged = repositoryHead === currentHead;

  if (![sourceHead, currentHead].includes(repositoryHead)
    || attempt.contractVersion !== 'report_runtime_config_dlq_recovery_v1'
    || attempt.reportId !== expectedReportId
    || attempt.originalDlqId !== expectedDlqId
    || !Number.isSafeInteger(Number(attempt.retryRequestedAt))
    || Number(attempt.retryRequestedAt) <= 0
    || !optionalSha256(attempt.jobSha256)
    || !optionalText(attempt.activeVersionId)
    || Number(attempt.stability?.sampleCount) < 3
    || !optionalSha256(attempt.backup?.sha256)) {
    throw bridgeError(
      'Recorded Report config-DLQ retry attempt is not the exact bridgeable incident',
      'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_ATTEMPT_INVALID',
      {
        repositoryHead,
        currentHead,
        reportIdMatched: attempt.reportId === expectedReportId,
        dlqIdMatched: attempt.originalDlqId === expectedDlqId,
      },
    );
  }

  if (alreadyBridged) {
    const bridge = attempt.headBridge;
    if (attempt.originalRepositoryHead !== sourceHead
      || bridge?.contractVersion !== REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION
      || bridge?.sourceHead !== sourceHead
      || bridge?.targetHead !== currentHead
      || !optionalSha256(bridge?.originalSha256)
      || (originalSha256 && bridge.originalSha256 !== originalSha256)) {
      throw bridgeError(
        'Existing Report config-DLQ retry head bridge evidence is invalid',
        'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_READBACK_INVALID',
      );
    }
  }

  return Object.freeze({
    sourceHead,
    currentHead,
    repositoryHead,
    alreadyBridged,
  });
}

export function buildReportRuntimeConfigDlqBridgedRetryAttempt(attempt = {}, input = {}) {
  const validation = assertReportRuntimeConfigDlqRetryAttemptForHeadBridge(attempt, input);
  if (validation.alreadyBridged) return Object.freeze(structuredClone(attempt));
  const originalSha256 = requireSha256(input.originalSha256, 'originalSha256');
  const bridgedAt = requireIsoTimestamp(input.bridgedAt, 'bridgedAt');
  return Object.freeze({
    ...structuredClone(attempt),
    repositoryHead: validation.currentHead,
    originalRepositoryHead: validation.sourceHead,
    headBridge: Object.freeze({
      contractVersion: REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION,
      sourceHead: validation.sourceHead,
      targetHead: validation.currentHead,
      originalSha256,
      bridgedAt,
    }),
  });
}

function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${fieldName} is required`);
  return text;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireGitSha(value, fieldName) {
  const sha = optionalGitSha(value);
  if (!sha) throw new TypeError(`${fieldName} must be a 40-character lowercase Git SHA`);
  return sha;
}

function optionalGitSha(value) {
  const text = optionalText(value);
  return text && /^[a-f0-9]{40}$/u.test(text) ? text : null;
}

function requireSha256(value, fieldName) {
  const sha = optionalSha256(value);
  if (!sha) throw new TypeError(`${fieldName} must be a 64-character lowercase SHA-256`);
  return sha;
}

function optionalSha256(value) {
  const text = optionalText(value);
  return text && /^[a-f0-9]{64}$/u.test(text) ? text : null;
}

function requireIsoTimestamp(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${fieldName} must be an ISO timestamp`);
  return text;
}

function bridgeError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeConfigDlqEvidenceHeadBridgeError';
  error.code = code;
  error.details = details;
  return error;
}
