import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  compareLarkNotificationSafeDeployWindow,
  validateLarkNotificationCurrentSchemaState,
} from '../../scripts/lib/lark-notification-dormant-work-authority.js';
import {
  LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION,
  assertLarkNotificationSafeWorkerDeployConfirmation,
  parseLarkNotificationDeploymentStatus,
  parseLarkNotificationSafeWorkerDeployArgs,
  validateLarkNotificationSafeWorkerDeployEvidence,
} from '../../scripts/lib/lark-notification-safe-worker-deploy.js';

const VERSION_ID = '12345678-1234-4123-8123-123456789abc';

test('safe Worker deploy defaults to plan and rejects unknown arguments', () => {
  assert.deepEqual(parseLarkNotificationSafeWorkerDeployArgs([]), { execute: false });
  assert.deepEqual(parseLarkNotificationSafeWorkerDeployArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseLarkNotificationSafeWorkerDeployArgs(['--phase=send']),
    (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_ARGUMENT_INVALID',
  );
});

test('safe Worker deploy requires one exact confirmation', () => {
  assert.throws(
    () => assertLarkNotificationSafeWorkerDeployConfirmation({}),
    (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNotificationSafeWorkerDeployConfirmation({
    [LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION.envName]:
      LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_CONFIRMATION.value,
  }), true);
});

test('deployment status requires the exact deployed version at 100 percent traffic', () => {
  assert.deepEqual(parseLarkNotificationDeploymentStatus(JSON.stringify({
    deployments: [{
      versions: [{ version_id: VERSION_ID, percentage: 100 }],
    }],
  }), VERSION_ID), {
    activeVersionId: VERSION_ID,
    trafficPercentage: 100,
    allocationCount: 1,
  });

  assert.deepEqual(parseLarkNotificationDeploymentStatus(JSON.stringify({
    result: {
      versionId: VERSION_ID,
      trafficPercentage: 100,
    },
  }), VERSION_ID), {
    activeVersionId: VERSION_ID,
    trafficPercentage: 100,
    allocationCount: 1,
  });

  assert.throws(
    () => parseLarkNotificationDeploymentStatus(JSON.stringify({
      versions: [
        { version_id: VERSION_ID, percentage: 50 },
        { version_id: '87654321-4321-4321-8321-cba987654321', percentage: 50 },
      ],
    }), VERSION_ID),
    (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_STATUS_INVALID',
  );

  assert.throws(
    () => parseLarkNotificationDeploymentStatus(JSON.stringify({
      versions: [{
        version_id: '87654321-4321-4321-8321-cba987654321',
        percentage: 100,
      }],
    }), VERSION_ID),
    (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_STATUS_INVALID',
  );
});

test('current deploy gate accepts legitimate progress since historical Migration read-back', () => {
  const current = createRemoteState({
    active_work: 0,
    coverage_runs: 157,
    coverage_entities: 24512,
  });
  assert.deepEqual(validateLarkNotificationCurrentSchemaState(current), current);

  assert.throws(
    () => validateLarkNotificationCurrentSchemaState({ ...current, active_locks: 1 }),
    (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_REMOTE_STATE_INVALID'
      && error.details.invalid.includes('active_locks'),
  );
  assert.throws(
    () => validateLarkNotificationCurrentSchemaState({
      ...current,
      notification_delivery_rows: 1,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_REMOTE_STATE_INVALID'
      && error.details.invalid.includes('notification_delivery_rows'),
  );
});

test('safe deploy compares a fresh short window and records unrelated concurrent progress', () => {
  const before = createRemoteState({
    active_work: 0,
    coverage_runs: 157,
    coverage_entities: 24512,
  });
  const after = createRemoteState({
    active_work: 1,
    coverage_runs: 158,
    coverage_entities: 24600,
  });
  const result = compareLarkNotificationSafeDeployWindow(before, after);
  assert.equal(result.externalStateChangeObserved, true);
  assert.deepEqual(result.externalStateChangedFields, [
    'active_work',
    'coverage_runs',
    'coverage_entities',
  ]);
  assert.equal(result.before.notification_delivery_rows, 0);
  assert.equal(result.after.notification_delivery_rows, 0);
});

test('safe deployment evidence proves all-false runtime and zero downstream actions', () => {
  const evidence = createEvidence();
  assert.equal(validateLarkNotificationSafeWorkerDeployEvidence(evidence), evidence);

  const changedEvidence = {
    ...evidence,
    retainedActiveWorkCountAfter: 1,
    externalStateChangeObserved: true,
    externalStateChangedFields: ['active_work'],
  };
  assert.equal(validateLarkNotificationSafeWorkerDeployEvidence(changedEvidence), changedEvidence);

  for (const mutation of [
    { notificationFlagsAllFalse: false },
    { activeLocksAfter: 1 },
    { notificationSchemaDrift: true },
    { remoteStateComparedTo: 'historical_preflight' },
    { externalStateChangeObserved: true, externalStateChangedFields: [] },
    { queueSendCount: 1 },
    { larkWriteCount: 1 },
    { notificationSendCount: 1 },
    { automationActivationCount: 1 },
    { scheduleActivationCount: 1 },
  ]) {
    assert.throws(
      () => validateLarkNotificationSafeWorkerDeployEvidence({ ...evidence, ...mutation }),
      (error) => error.code === 'LARK_NOTIFICATION_SAFE_WORKER_DEPLOY_EVIDENCE_INVALID',
    );
  }
});

test('operator is plan-only by default and has no Queue, Lark, notification or Schedule action path', async () => {
  const script = resolve('scripts/lark-notification-safe-worker-deploy.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.executed, false);
  assert.equal(output.safety.notificationRuntimeEnabled, false);
  assert.equal(output.safety.notificationSendEnabled, false);
  assert.equal(output.safety.notificationMirrorEnabled, false);
  assert.equal(output.safety.queueSend, false);
  assert.equal(output.safety.larkWrite, false);
  assert.equal(output.safety.notificationSend, false);
  assert.equal(output.safety.automationActivation, false);
  assert.equal(output.safety.scheduleActivation, false);
  assert.equal(output.safety.production, false);

  const source = await readFile(script, 'utf8');
  assert.match(source, /wrangler', 'deploy', '--config'/u);
  assert.match(source, /wrangler', 'deployments', 'status'/u);
  assert.match(source, /fresh_pre_deploy_snapshot/u);
  assert.doesNotMatch(source, /readCurrentRemoteSchemaState\(target, preflight\.remote\)/u);
  assert.doesNotMatch(source, /queues['",\s]+send/iu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /LarkMessageClient|TableSyncEngine/u);
  assert.doesNotMatch(source, /buildLarkNotificationControlledUatJob/u);
});

function createEvidence() {
  return {
    phase: 'deploy-safe',
    status: 'passed',
    deploymentVersionId: VERSION_ID,
    activeVersionId: VERSION_ID,
    trafficPercentage: 100,
    notificationFlagsAllFalse: true,
    remoteStateComparedTo: 'fresh_pre_deploy_snapshot',
    retainedActiveWorkCountBefore: 0,
    retainedActiveWorkCountAfter: 0,
    activeLocksBefore: 0,
    activeLocksAfter: 0,
    notificationSchemaDrift: false,
    externalStateChangeObserved: false,
    externalStateChangedFields: [],
    queueSendCount: 0,
    larkWriteCount: 0,
    notificationSendCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
  };
}

function createRemoteState(overrides = {}) {
  return {
    notification_table_count: 1,
    notification_index_count: 3,
    notification_delivery_rows: 0,
    active_work: 0,
    active_locks: 0,
    sync_runs: 2573,
    sync_jobs: 0,
    coverage_runs: 151,
    coverage_entities: 23482,
    organic_content_state: 2889,
    organic_content_observations: 4014,
    ...overrides,
  };
}
