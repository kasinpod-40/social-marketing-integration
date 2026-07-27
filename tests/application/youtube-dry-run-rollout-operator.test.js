import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  YOUTUBE_DRY_RUN_CONFIRMATIONS,
  YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES,
  YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST,
  YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION,
  assertYouTubeDryRunConfirmation,
  buildEmergencyRestoreInstruction,
  buildYouTubeDryRunDeploymentMessage,
  buildYouTubeDryRunJob,
  buildYouTubeDryRunSnapshotSql,
  compareYouTubeDryRunConfigs,
  compareYouTubeDryRunSnapshots,
  createYouTubeDryRunEvidence,
  executeYouTubeDryRunOperatorPhase,
  parseYouTubeDryRunOperatorArgs,
  sanitizeEvidenceValue,
  validateActiveYouTubeDeployment,
  validateYouTubeDryRunEvidence,
  validateYouTubeDryRunEvidenceChain,
} from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import { resolveQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';

const HEAD = '1ec60980c3897f01cef9bdc5f24aa6f5b7eba295';
const OTHER_HEAD = '2ec60980c3897f01cef9bdc5f24aa6f5b7eba295';
const VERSION = '11111111-2222-4333-8444-555555555555';
const OPERATION_ID = 'youtube-dry-run-20260727-01';
const REQUESTED_AT = Date.parse('2026-07-27T04:00:00.000Z');
const TARGET_FINGERPRINT = 'a'.repeat(64);
const TARGET = Object.freeze({
  repositoryHead: HEAD,
  targetFingerprint: TARGET_FINGERPRINT,
  operationId: OPERATION_ID,
  workKey: `youtube:${OPERATION_ID}`,
  syncRunId: `youtube-dry-run:${OPERATION_ID}`,
  originalRequestedAt: REQUESTED_AT,
  generation: REQUESTED_AT,
  safeConfigPath: 'wrangler.youtube-safe.jsonc',
  activeConfigPath: 'wrangler.youtube-dry-run.jsonc',
});

test('operator defaults to plan-only and rejects plan execution or unknown phases', () => {
  assert.deepEqual(parseYouTubeDryRunOperatorArgs([]), { phase: 'plan', execute: false });
  assert.throws(
    () => parseYouTubeDryRunOperatorArgs(['--execute']),
    (error) => error.code === 'YOUTUBE_DRY_RUN_OPERATOR_PLAN_EXECUTE_INVALID',
  );
  assert.throws(
    () => parseYouTubeDryRunOperatorArgs(['--phase=unknown']),
    (error) => error.code === 'YOUTUBE_DRY_RUN_OPERATOR_PHASE_INVALID',
  );
});

test('every executable phase requires its own exact confirmation', () => {
  for (const [phase, confirmation] of Object.entries(YOUTUBE_DRY_RUN_CONFIRMATIONS)) {
    assert.throws(
      () => assertYouTubeDryRunConfirmation(phase, {}),
      (error) => error.code === 'YOUTUBE_DRY_RUN_OPERATOR_CONFIRMATION_REQUIRED',
    );
    assert.throws(
      () => assertYouTubeDryRunConfirmation(phase, {
        [confirmation.envName]: `${confirmation.value}_WRONG`,
      }),
      (error) => error.code === 'YOUTUBE_DRY_RUN_OPERATOR_CONFIRMATION_REQUIRED',
    );
    assert.equal(assertYouTubeDryRunConfirmation(phase, {
      [confirmation.envName]: confirmation.value,
    }), true);
  }
});

test('evidence chain rejects a different repository head, target or operation', () => {
  const evidence = createEvidence('preflight');
  assert.throws(
    () => validateYouTubeDryRunEvidence(evidence, {
      phase: 'preflight',
      repositoryHead: OTHER_HEAD,
      targetFingerprint: TARGET_FINGERPRINT,
      operationId: OPERATION_ID,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_EVIDENCE_CHAIN_MISMATCH',
  );
  assert.throws(
    () => validateYouTubeDryRunEvidence(evidence, {
      phase: 'preflight',
      repositoryHead: HEAD,
      targetFingerprint: 'b'.repeat(64),
      operationId: OPERATION_ID,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_EVIDENCE_CHAIN_MISMATCH',
  );
  assert.throws(
    () => validateYouTubeDryRunEvidence(evidence, {
      phase: 'preflight',
      repositoryHead: HEAD,
      targetFingerprint: TARGET_FINGERPRINT,
      operationId: 'different-operation',
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_EVIDENCE_CHAIN_MISMATCH',
  );
});

test('evidence phase chain requires the exact immediately preceding phase', () => {
  assert.equal(validateYouTubeDryRunEvidenceChain(
    'deploy-safe-baseline',
    createEvidence('preflight'),
    expectedEvidence(),
  ).phase, 'preflight');
  assert.throws(
    () => validateYouTubeDryRunEvidenceChain(
      'deploy-safe-baseline',
      createEvidence('plan'),
      expectedEvidence(),
    ),
    (error) => error.code === 'YOUTUBE_DRY_RUN_EVIDENCE_CHAIN_MISMATCH',
  );
});

test('active Worker version guard requires exact version and 100 percent traffic', () => {
  assert.equal(validateActiveYouTubeDeployment({
    id: 'deployment-1',
    versions: [{ version_id: VERSION, percentage: 100 }],
  }, VERSION).versionId, VERSION);
  for (const status of [
    { versions: [{ version_id: '99999999-2222-4333-8444-555555555555', percentage: 100 }] },
    { versions: [{ version_id: VERSION, percentage: 99 }] },
    { versions: [
      { version_id: VERSION, percentage: 100 },
      { version_id: VERSION, percentage: 0 },
    ] },
  ]) {
    assert.throws(
      () => validateActiveYouTubeDeployment(status, VERSION),
      (error) => error.code === 'YOUTUBE_DRY_RUN_ACTIVE_VERSION_MISMATCH',
    );
  }
});

test('config comparison permits only the two reviewed YouTube gate changes', async () => {
  const safe = await safeConfig();
  const active = activateYouTubeGates(safe);
  const comparison = compareYouTubeDryRunConfigs(safe, active, { channelId: 'UC_TEST' });
  assert.deepEqual(comparison.approvedDiff, [
    'MKT_CONNECTOR_YOUTUBE_ENABLED',
    'MKT_YOUTUBE_END_TO_END_ENABLED',
  ]);
  assert.deepEqual(comparison.active.trueFlags, [
    'MKT_CONNECTOR_YOUTUBE_ENABLED',
    'MKT_YOUTUBE_END_TO_END_ENABLED',
  ]);
});

test('config validation rejects extra true gates and binding, Cron or route drift', async () => {
  const safe = await safeConfig();
  const active = activateYouTubeGates(safe);
  assert.throws(
    () => compareYouTubeDryRunConfigs(
      safe,
      active.replace('"MKT_CONNECTOR_TIKTOK_ENABLED": "false"', '"MKT_CONNECTOR_TIKTOK_ENABLED": "true"'),
      { channelId: 'UC_TEST' },
    ),
    (error) => error.code === 'YOUTUBE_DRY_RUN_CONFIG_UNSAFE'
      || error.code === 'YOUTUBE_DRY_RUN_CONFIG_EXTRA_TRUE_FLAG',
  );
  for (const drifted of [
    active.replace('"database_name": "social-mkt-state-dev"', '"database_name": "other-db"'),
    active.replace('"50 0,6,12,18 * * *"', '"51 0,6,12,18 * * *"'),
    active.replace('"name": "social-mkt-sync-worker"', '"name": "other-worker"'),
    active.replace('"max_batch_size": 10', '"max_batch_size": 11'),
    active.replace('{', '{\n  "routes": ["https://unexpected.example/*"],'),
  ]) {
    assert.throws(
      () => compareYouTubeDryRunConfigs(safe, drifted, { channelId: 'UC_TEST' }),
      (error) => error.code.startsWith('YOUTUBE_DRY_RUN_CONFIG_'),
    );
  }
});

test('deployment provenance message contains contract, phase and full Git SHA', () => {
  const message = buildYouTubeDryRunDeploymentMessage('deploy-safe-baseline', HEAD);
  assert.equal(
    message,
    `${YOUTUBE_DRY_RUN_OPERATOR_CONTRACT_VERSION} phase=deploy-safe-baseline git=${HEAD}`,
  );
  assert.throws(
    () => buildYouTubeDryRunDeploymentMessage('deploy-safe-baseline', HEAD.slice(0, 12)),
    (error) => error.code === 'YOUTUBE_DRY_RUN_GIT_SHA_INVALID',
  );
});

test('shared helper builds exact stable YouTube job independently from delivery ID', () => {
  const job = buildYouTubeDryRunJob(TARGET);
  assert.deepEqual(job, {
    schemaVersion: 1,
    type: 'youtube.channel.organic.sync',
    trigger: 'youtube_worker_dry_run',
    dryRun: true,
    analyticsEnabled: false,
    metricDate: '2026-07-27',
    syncMode: 'incremental',
    operationId: OPERATION_ID,
    workKey: `youtube:${OPERATION_ID}`,
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
    requestedAt: new Date(REQUESTED_AT).toISOString(),
  });
  const resolve = (messageId) => resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: messageId, body: job }),
    message: { id: messageId },
  });
  assert.deepEqual(resolve('delivery-a'), resolve('delivery-b'));
  assert.equal(resolve('delivery-a').workKey, `youtube:${OPERATION_ID}`);
});

test('stable YouTube job rejects unsafe IDs, workKey drift and generation drift', () => {
  assert.throws(
    () => buildYouTubeDryRunJob({ ...TARGET, operationId: 'unsafe id' }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_OPERATION_ID_INVALID',
  );
  const job = buildYouTubeDryRunJob(TARGET);
  for (const body of [
    { ...job, workKey: 'youtube:wrong' },
    { ...job, generation: REQUESTED_AT + 1 },
  ]) {
    assert.throws(
      () => resolveQueueOperation({
        job: normalizeQueueJobMessage({ id: 'delivery', body }),
        message: { id: 'delivery' },
      }),
      (error) => error.retryable === false,
    );
  }
});

test('snapshot SQL is scoped to exact operation, work and sync run', () => {
  const sql = buildYouTubeDryRunSnapshotSql(TARGET);
  assert.match(sql, new RegExp(OPERATION_ID, 'u'));
  assert.match(sql, new RegExp(`youtube:${OPERATION_ID}`, 'u'));
  assert.match(sql, new RegExp(`youtube-dry-run:${OPERATION_ID}`, 'u'));
  assert.match(sql, /dead_letter_operation_metadata/u);
});

test('snapshot validator allows operational mutations and rejects every Business mutation', () => {
  const before = zeroSnapshot();
  const after = {
    ...before,
    sync_runs: 1,
    queue_operation_attempts: 1,
    sync_work_runs: 1,
    sync_work_phases: 3,
    sync_work_units: 5,
    sync_generation_fences: 1,
    reliability_mirror_outbox: 1,
    main_queue_attempts: 2,
    providerRequests: 1,
  };
  const result = compareYouTubeDryRunSnapshots(before, after, {
    after: { providerRequests: 1 },
  });
  assert.equal(result.businessMutationCount, 0);
  assert.deepEqual([...result.allowedOperationalMutations].sort(), [
    'queue_operation_attempts',
    'reliability_mirror_outbox',
    'sync_generation_fences',
    'sync_runs',
    'sync_work_phases',
    'sync_work_runs',
    'sync_work_units',
  ]);
  for (const resource of YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES
    .filter((name) => name !== 'youtube_lark_records')) {
    assert.throws(
      () => compareYouTubeDryRunSnapshots(before, { ...after, [resource]: 1 }),
      (error) => error.code === 'YOUTUBE_DRY_RUN_BUSINESS_MUTATION_DETECTED',
    );
  }
  assert.throws(
    () => compareYouTubeDryRunSnapshots(before, {
      ...after,
      youtube_lark_records: 1,
    }),
    (error) => error.code === 'YOUTUBE_DRY_RUN_BUSINESS_MUTATION_DETECTED',
  );
});

test('one-message phase originates exactly one send and records no raw payload', async () => {
  let sends = 0;
  let sendMarkers = 0;
  const evidence = await executeYouTubeDryRunOperatorPhase(phaseInput('send-one-dry-run'), {
    async writeQueueSendAttempt(marker) {
      sendMarkers += 1;
      assert.equal(marker.data.queueSendCommandCount, 1);
    },
    async sendQueueMessage(job) {
      sends += 1;
      assert.equal(job.operationId, OPERATION_ID);
      return { accepted: true, rawResponse: { secret: 'must-not-be-recorded' } };
    },
  });
  assert.equal(sends, 1);
  assert.equal(sendMarkers, 1);
  assert.equal(evidence.data.queueSendCommandCount, 1);
  assert.equal(evidence.data.accepted, true);
  assert.equal(JSON.stringify(evidence).includes('must-not-be-recorded'), false);
});

test('failed Queue command leaves the one-send marker and cannot be automatically retried', async () => {
  let marked = false;
  let sends = 0;
  const dependencies = {
    async writeQueueSendAttempt() {
      if (marked) {
        const error = new Error('send marker exists');
        error.code = 'YOUTUBE_DRY_RUN_QUEUE_RESEND_BLOCKED';
        throw error;
      }
      marked = true;
    },
    async sendQueueMessage() {
      sends += 1;
      throw new Error('synthetic command uncertainty');
    },
  };
  await assert.rejects(
    () => executeYouTubeDryRunOperatorPhase(phaseInput('send-one-dry-run'), dependencies),
    /synthetic command uncertainty/u,
  );
  await assert.rejects(
    () => executeYouTubeDryRunOperatorPhase(phaseInput('send-one-dry-run'), dependencies),
    (error) => error.code === 'YOUTUBE_DRY_RUN_QUEUE_RESEND_BLOCKED',
  );
  assert.equal(sends, 1);
});

test('verify phase is read-only and never calls Queue sender', async () => {
  let sends = 0;
  const evidence = await executeYouTubeDryRunOperatorPhase(phaseInput('verify-dry-run'), {
    async sendQueueMessage() { sends += 1; },
    async verifyDryRun() {
      return { businessMutationCount: 0, larkWriteCount: 0 };
    },
  });
  assert.equal(sends, 0);
  assert.equal(evidence.data.queueSendCommandCount, 0);
});

test('post-activation failure emits an independently executable safe restore instruction', async () => {
  let restore = null;
  await assert.rejects(
    () => executeYouTubeDryRunOperatorPhase(phaseInput('deploy-dry-run-gates'), {
      async runPhase() {
        const error = new Error('synthetic deployment failure');
        error.code = 'SYNTHETIC_FAILURE';
        throw error;
      },
      async writeEmergencyRestore(value) { restore = value; },
    }),
    (error) => error.emergencyRestore?.phase === 'restore-all-false',
  );
  assert.equal(restore.command.includes('--var'), false);
  assert.match(restore.deploymentMessage, new RegExp(HEAD, 'u'));
  assert.deepEqual(
    buildEmergencyRestoreInstruction({
      repositoryHead: HEAD,
      safeConfigPath: TARGET.safeConfigPath,
    }).command,
    restore.command,
  );
});

test('evidence sanitizer removes secrets and raw Provider responses', () => {
  const sanitized = sanitizeEvidenceValue({
    apiToken: 'secret-value',
    authorization: 'Bearer abc.def',
    rawResponse: { customer: 'payload' },
    safeCounter: 1,
  });
  assert.deepEqual(sanitized, {
    apiToken: '[REDACTED]',
    authorization: '[REDACTED]',
    rawResponse: '[REDACTED]',
    safeCounter: 1,
  });
  const evidence = createYouTubeDryRunEvidence({
    phase: 'preflight',
    repositoryHead: HEAD,
    targetFingerprint: TARGET_FINGERPRINT,
    operationId: OPERATION_ID,
    data: sanitized,
  });
  assert.equal(JSON.stringify(evidence).includes('secret-value'), false);
});

function phaseInput(phase) {
  const confirmation = YOUTUBE_DRY_RUN_CONFIRMATIONS[phase];
  return {
    phase,
    env: { [confirmation.envName]: confirmation.value },
    target: TARGET,
    repositoryHead: HEAD,
    workingTreeClean: true,
    createdAt: '2026-07-27T05:00:00.000Z',
  };
}

function createEvidence(phase) {
  return createYouTubeDryRunEvidence({
    phase,
    repositoryHead: HEAD,
    targetFingerprint: TARGET_FINGERPRINT,
    operationId: OPERATION_ID,
    createdAt: '2026-07-27T05:00:00.000Z',
    data: { ok: true },
  });
}

function expectedEvidence() {
  return {
    repositoryHead: HEAD,
    targetFingerprint: TARGET_FINGERPRINT,
    operationId: OPERATION_ID,
  };
}

async function safeConfig() {
  const source = await readFile(new URL('../../wrangler.sync.example.jsonc', import.meta.url), 'utf8');
  return source
    .replace('"database_name": "replace-with-environment-specific-d1-name"', '"database_name": "social-mkt-state-dev"')
    .replace('"YOUTUBE_CHANNEL_ID": "replace-with-youtube-channel-id"', '"YOUTUBE_CHANNEL_ID": "UC_TEST"')
    .replaceAll('"replace-with-table-id"', '"tbl_real_mapping"');
}

function activateYouTubeGates(config) {
  return config
    .replace('"MKT_CONNECTOR_YOUTUBE_ENABLED": "false"', '"MKT_CONNECTOR_YOUTUBE_ENABLED": "true"')
    .replace('"MKT_YOUTUBE_END_TO_END_ENABLED": "false"', '"MKT_YOUTUBE_END_TO_END_ENABLED": "true"');
}

function zeroSnapshot() {
  return Object.fromEntries([
    ...YOUTUBE_DRY_RUN_OPERATIONAL_ALLOWLIST,
    ...YOUTUBE_DRY_RUN_FORBIDDEN_BUSINESS_RESOURCES,
    'main_queue_attempts',
    'dlq_records',
    'providerRequests',
  ].map((name) => [name, 0]));
}
