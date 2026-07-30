import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION,
  REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION,
  REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD,
  assertReportRuntimeConfigDlqEvidenceHeadBridgeConfirmation,
  assertReportRuntimeConfigDlqRetryAttemptForHeadBridge,
  buildReportRuntimeConfigDlqBridgedRetryAttempt,
} from '../../scripts/lib/report-runtime-config-dlq-evidence-head-bridge.js';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT,
} from '../../scripts/lib/report-runtime-config-dlq-recovery.js';

const TARGET_HEAD = '672b54ac999d90ab45c3a2796f5db6c0099d37a6';
const ORIGINAL_SHA = 'a'.repeat(64);

function attempt(overrides = {}) {
  return {
    contractVersion: 'report_runtime_config_dlq_recovery_v1',
    repositoryHead: REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD,
    reportId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId,
    jobSha256: 'b'.repeat(64),
    retryRequestedAt: 1785392000000,
    originalDlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
    activeVersionId: '11111111-2222-4333-8444-555555555555',
    stability: {
      sampleCount: 3,
      versionId: '11111111-2222-4333-8444-555555555555',
      trueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'],
    },
    backup: { sha256: 'c'.repeat(64) },
    attemptedAt: '2026-07-30T07:00:00.000Z',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    currentHead: TARGET_HEAD,
    reportId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId,
    dlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
    originalSha256: ORIGINAL_SHA,
    bridgedAt: '2026-07-30T08:00:00.000Z',
    ...overrides,
  };
}

test('confirmation is exact and explicit', () => {
  assert.equal(assertReportRuntimeConfigDlqEvidenceHeadBridgeConfirmation({
    CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE:
      REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION,
  }), true);
  assert.throws(
    () => assertReportRuntimeConfigDlqEvidenceHeadBridgeConfirmation({}),
    (error) => error.code === 'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION_REQUIRED',
  );
});

test('exact source retry attempt bridges to current reviewed main with immutable audit evidence', () => {
  const bridged = buildReportRuntimeConfigDlqBridgedRetryAttempt(attempt(), input());
  assert.equal(bridged.repositoryHead, TARGET_HEAD);
  assert.equal(bridged.originalRepositoryHead, REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD);
  assert.deepEqual(bridged.headBridge, {
    contractVersion: REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONTRACT_VERSION,
    sourceHead: REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD,
    targetHead: TARGET_HEAD,
    originalSha256: ORIGINAL_SHA,
    bridgedAt: '2026-07-30T08:00:00.000Z',
  });
  assert.equal(bridged.retryRequestedAt, 1785392000000);
  assert.equal(bridged.jobSha256, 'b'.repeat(64));
  assert.equal(bridged.backup.sha256, 'c'.repeat(64));
});

test('already bridged retry evidence validates idempotently', () => {
  const bridged = buildReportRuntimeConfigDlqBridgedRetryAttempt(attempt(), input());
  assert.deepEqual(assertReportRuntimeConfigDlqRetryAttemptForHeadBridge(bridged, input()), {
    sourceHead: REPORT_RUNTIME_CONFIG_DLQ_RETRY_SOURCE_HEAD,
    currentHead: TARGET_HEAD,
    repositoryHead: TARGET_HEAD,
    alreadyBridged: true,
  });
  assert.deepEqual(buildReportRuntimeConfigDlqBridgedRetryAttempt(bridged, input()), bridged);
});

test('foreign head, Report identity, DLQ identity or unstable attempt fails closed', () => {
  for (const drift of [
    { repositoryHead: 'd'.repeat(40) },
    { reportId: 'other-report' },
    { originalDlqId: 'other-dlq' },
    { stability: { sampleCount: 2 } },
  ]) {
    assert.throws(
      () => assertReportRuntimeConfigDlqRetryAttemptForHeadBridge(attempt(drift), input()),
      (error) => error.code === 'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_ATTEMPT_INVALID',
    );
  }
});

test('already bridged evidence requires exact source, target and original hash metadata', () => {
  const bridged = buildReportRuntimeConfigDlqBridgedRetryAttempt(attempt(), input());
  assert.throws(
    () => assertReportRuntimeConfigDlqRetryAttemptForHeadBridge({
      ...bridged,
      headBridge: { ...bridged.headBridge, originalSha256: 'e'.repeat(64) },
    }, input()),
    (error) => error.code === 'REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_READBACK_INVALID',
  );
});
