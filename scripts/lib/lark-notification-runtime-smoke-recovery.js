import { createHash } from 'node:crypto';

import {
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
} from './lark-notification-runtime-smoke-test.js';

export const LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONTRACT_VERSION =
  'lark_notification_runtime_smoke_recovery_v1';
export const LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY',
  value: 'VERIFY_EXISTING_RUNTIME_SMOKE_WITHOUT_RESEND',
});

const HASH = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const TERMINAL_FAILURE_STATUSES = new Set(['blocked', 'blocked_unknown']);
const TRANSIENT_STATUSES = new Set(['claimed', 'sending', 'sent']);

export function assertLarkNotificationRuntimeSmokeRecoveryConfirmation(env = {}) {
  const confirmation = LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION;
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw recoveryError(
      `Runtime smoke recovery requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION_REQUIRED',
      { envName: confirmation.envName },
    );
  }
  return true;
}

export function assertLarkNotificationRuntimeSmokeRecoveryEvidence(input = {}) {
  const directoryHead = requireCommitSha(input.directoryHead, 'directoryHead');
  const preflight = requireObject(input.preflight, 'preflight');
  const attempt = requireObject(input.attempt, 'attempt');
  const invalid = [];

  if (preflight.contractVersion !== LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION) {
    invalid.push('preflightContractVersion');
  }
  if (attempt.contractVersion !== LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION) {
    invalid.push('attemptContractVersion');
  }
  if (preflight.repositoryHead !== directoryHead || attempt.repositoryHead !== directoryHead) {
    invalid.push('repositoryHead');
  }
  if (!HASH.test(preflight.smokeAiRunKeyHash ?? '')
      || attempt.aiRunKeyHash !== preflight.smokeAiRunKeyHash) {
    invalid.push('smokeAiRunKeyHash');
  }
  if (!HASH.test(attempt.operationIdHash ?? '')) invalid.push('operationIdHash');
  if (!HASH.test(attempt.jobSha256 ?? '')) invalid.push('jobSha256');
  if (attempt.maximumQueueAdmissionCount !== 1) invalid.push('maximumQueueAdmissionCount');
  if (!positiveInteger(preflight.deliveryRowsBefore)) invalid.push('deliveryRowsBefore');
  if (!positiveInteger(preflight.notificationLogRowsBefore)) {
    invalid.push('notificationLogRowsBefore');
  }
  if (preflight.activatedReportSettingCount !== 4) {
    invalid.push('activatedReportSettingCount');
  }
  if (preflight.controlledUatStable !== true) invalid.push('controlledUatStable');
  if (preflight.queueAdmissionCount !== 0) invalid.push('preflightQueueAdmissionCount');
  if (preflight.workerDeploymentCount !== 0
      || preflight.reportSettingWriteCount !== 0
      || preflight.automationActivationCount !== 0
      || preflight.scheduleActivationCount !== 0
      || preflight.production !== 'BLOCKED') {
    invalid.push('safetyBoundary');
  }

  if (invalid.length > 0) {
    throw recoveryError(
      'Runtime smoke retained evidence is incomplete or inconsistent',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_INVALID',
      { invalid },
    );
  }

  return Object.freeze({
    repositoryHead: directoryHead,
    smokeAiRunKeyHash: preflight.smokeAiRunKeyHash,
    deliveryRowsBefore: preflight.deliveryRowsBefore,
    notificationLogRowsBefore: preflight.notificationLogRowsBefore,
    activatedReportSettingCount: preflight.activatedReportSettingCount,
    attemptedAt: requireText(attempt.attemptedAt, 'attemptedAt'),
    queueAdmissionCount: 1,
  });
}

export function selectLarkNotificationRuntimeSmokeRecoveryAiRow(records = [], expectedHash) {
  const hash = requireHash(expectedHash, 'expectedHash');
  const matches = records.filter((record) => {
    const aiRunKey = optionalText(scalar(record?.fields?.ai_run_key));
    return aiRunKey?.startsWith('notification-runtime-smoke:')
      && sha256(aiRunKey) === hash;
  });
  if (matches.length !== 1) {
    throw recoveryError(
      'Retained Runtime smoke AI identity must resolve to exactly one Lark row',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_IDENTITY_INVALID',
      { matchCount: matches.length },
    );
  }
  const row = matches[0];
  if (String(scalar(row?.fields?.scope_type) ?? '') !== 'executive'
      || String(scalar(row?.fields?.notification_reason) ?? '') !== 'runtime_smoke_test'
      || readBoolean(row?.fields?.preview_mode, 'preview_mode') !== false) {
    throw recoveryError(
      'Retained Runtime smoke AI identity does not match the reviewed contract',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_IDENTITY_INVALID',
    );
  }
  return Object.freeze({
    recordId: requireText(row.recordId ?? row.record_id, 'recordId'),
    aiRunKey: requireText(scalar(row.fields.ai_run_key), 'ai_run_key'),
    fields: Object.freeze(structuredClone(row.fields)),
  });
}

export function normalizeLarkNotificationRuntimeSmokeRecoveryReadback(row = {}) {
  const value = Object.freeze({
    notificationTableCount: count(row.notification_table_count),
    notificationIndexCount: count(row.notification_index_count),
    activeLocks: count(row.active_locks),
    totalDeliveryRows: count(row.total_delivery_rows),
    sentMirroredRows: count(row.sent_mirrored_rows),
    unsafeDeliveryRows: count(row.unsafe_delivery_rows),
    controlledUatRows: count(row.controlled_uat_rows),
    controlledUatSentMirroredRows: count(row.controlled_uat_sent_mirrored_rows),
    smokeDeliveryRows: count(row.smoke_delivery_rows),
    smokeDeliveryStatus: optionalText(row.smoke_delivery_status),
    smokeMirrorStatus: optionalText(row.smoke_mirror_status),
    smokeClaimCount: nullableCount(row.smoke_claim_count),
    smokeSentAt: nullableNumber(row.smoke_sent_at),
    smokeMessageIdHash: optionalText(row.smoke_message_id_hash),
  });
  const invalid = [];
  if (value.notificationTableCount !== 1) invalid.push('notificationTableCount');
  if (value.notificationIndexCount !== 3) invalid.push('notificationIndexCount');
  if (value.activeLocks !== 0) invalid.push('activeLocks');
  if (value.controlledUatRows !== 1
      || value.controlledUatSentMirroredRows !== 1) invalid.push('controlledUat');
  if (value.smokeDeliveryRows !== 1) invalid.push('smokeDeliveryRows');
  if (value.unsafeDeliveryRows > 1) invalid.push('unsafeDeliveryRows');
  if (value.totalDeliveryRows !== value.sentMirroredRows + value.unsafeDeliveryRows) {
    invalid.push('deliveryParity');
  }
  const smokeTerminal = value.smokeDeliveryStatus === 'sent'
    && value.smokeMirrorStatus === 'mirrored';
  if (value.unsafeDeliveryRows === 0 && !smokeTerminal) invalid.push('terminalSmokeMissing');
  if (value.unsafeDeliveryRows === 1 && smokeTerminal) invalid.push('unrelatedUnsafeDelivery');
  if (value.unsafeDeliveryRows === 1
      && !TRANSIENT_STATUSES.has(value.smokeDeliveryStatus ?? '')) {
    invalid.push('smokeDeliveryStatus');
  }
  if (invalid.length > 0) {
    throw recoveryError(
      'Runtime smoke recovery found unsafe state outside the exact in-flight smoke row',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_REMOTE_STATE_INVALID',
      { invalid },
    );
  }
  return value;
}

export function classifyLarkNotificationRuntimeSmokeRecoveryReadback(readback = {}) {
  const value = normalizeReadbackShape(readback);
  if (TERMINAL_FAILURE_STATUSES.has(value.smokeDeliveryStatus ?? '')) {
    throw recoveryError(
      'Runtime smoke delivery reached a terminal non-send state; automatic resend remains forbidden',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_TERMINAL_FAILURE',
      {
        smokeDeliveryStatus: value.smokeDeliveryStatus,
        smokeMirrorStatus: value.smokeMirrorStatus,
      },
    );
  }
  if (value.smokeDeliveryStatus === 'sent' && value.smokeMirrorStatus === 'mirrored') {
    if (value.unsafeDeliveryRows !== 0
        || value.smokeClaimCount < 1
        || !Number.isFinite(value.smokeSentAt)
        || !HASH.test(value.smokeMessageIdHash ?? '')) {
      throw recoveryError(
        'Runtime smoke terminal delivery evidence is incomplete',
        'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_DELIVERY_INVALID',
      );
    }
    return Object.freeze({ state: 'delivered', readback: value });
  }
  return Object.freeze({ state: 'in_flight', readback: value });
}

export function assertLarkNotificationRuntimeSmokeRecoveryDelivered(evidence, readback) {
  const authority = requireObject(evidence, 'evidence');
  const result = classifyLarkNotificationRuntimeSmokeRecoveryReadback(readback);
  if (result.state !== 'delivered') {
    throw recoveryError(
      'Runtime smoke delivery is not terminal and mirrored yet',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_NOT_READY',
    );
  }
  const value = result.readback;
  const invalid = [];
  if (value.totalDeliveryRows !== authority.deliveryRowsBefore + 1) {
    invalid.push('totalDeliveryRows');
  }
  if (value.sentMirroredRows !== authority.deliveryRowsBefore + 1) {
    invalid.push('sentMirroredRows');
  }
  if (value.controlledUatRows !== 1 || value.controlledUatSentMirroredRows !== 1) {
    invalid.push('controlledUat');
  }
  if (invalid.length > 0) {
    throw recoveryError(
      'Runtime smoke recovery delivery does not match the retained preflight baseline',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_DELIVERY_INVALID',
      { invalid },
    );
  }
  return Object.freeze({
    ...value,
    deliveryRowsBefore: authority.deliveryRowsBefore,
    deliveryRowsAfter: value.totalDeliveryRows,
    additionalDeliveryRows: 1,
    additionalMessageSendCount: 1,
  });
}

export function assertLarkNotificationRuntimeSmokeRecoveryStable(delivered, observed) {
  const first = assertTerminalShape(delivered, 'delivered');
  const after = assertTerminalShape(observed, 'observed');
  const fields = [
    'totalDeliveryRows',
    'sentMirroredRows',
    'unsafeDeliveryRows',
    'controlledUatRows',
    'controlledUatSentMirroredRows',
    'smokeDeliveryRows',
    'smokeDeliveryStatus',
    'smokeMirrorStatus',
    'smokeClaimCount',
    'smokeSentAt',
    'smokeMessageIdHash',
  ];
  const drift = fields.filter((field) => first[field] !== after[field]);
  if (drift.length > 0) {
    throw recoveryError(
      'Runtime smoke delivery changed during poll-only recovery observation',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_STABILITY_FAILED',
      { drift },
    );
  }
  return Object.freeze({
    exactSmokeDeliveryRows: 1,
    duplicateDeliveryRows: 0,
    additionalQueueAdmissionCount: 0,
    additionalMessageSendCount: 0,
    sentAtStable: true,
    messageIdHashStable: true,
  });
}

function assertTerminalShape(value, fieldName) {
  const normalized = normalizeReadbackShape(value);
  const classified = classifyLarkNotificationRuntimeSmokeRecoveryReadback(normalized);
  if (classified.state !== 'delivered') {
    throw recoveryError(
      `${fieldName} must be terminal sent/mirrored`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_STABILITY_FAILED',
      { fieldName },
    );
  }
  return classified.readback;
}

function normalizeReadbackShape(value = {}) {
  return normalizeLarkNotificationRuntimeSmokeRecoveryReadback({
    notification_table_count: value.notificationTableCount,
    notification_index_count: value.notificationIndexCount,
    active_locks: value.activeLocks,
    total_delivery_rows: value.totalDeliveryRows,
    sent_mirrored_rows: value.sentMirroredRows,
    unsafe_delivery_rows: value.unsafeDeliveryRows,
    controlled_uat_rows: value.controlledUatRows,
    controlled_uat_sent_mirrored_rows: value.controlledUatSentMirroredRows,
    smoke_delivery_rows: value.smokeDeliveryRows,
    smoke_delivery_status: value.smokeDeliveryStatus,
    smoke_mirror_status: value.smokeMirrorStatus,
    smoke_claim_count: value.smokeClaimCount,
    smoke_sent_at: value.smokeSentAt,
    smoke_message_id_hash: value.smokeMessageIdHash,
  });
}

function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}

function readBoolean(value, fieldName) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  throw recoveryError(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_IDENTITY_INVALID',
    { fieldName },
  );
}

function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      'Runtime smoke recovery count is invalid',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_REMOTE_STATE_INVALID',
    );
  }
  return number;
}

function nullableCount(value) {
  return value === null || value === undefined ? 0 : count(value);
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw recoveryError(
      `${fieldName} must be an object`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireHash(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!HASH.test(text)) {
    throw recoveryError(
      `${fieldName} must be SHA-256`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireCommitSha(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!COMMIT_SHA.test(text)) {
    throw recoveryError(
      `${fieldName} must be a full commit SHA`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationRuntimeSmokeRecoveryError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
