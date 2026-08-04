import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

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

test('safe deployment evidence proves all-false runtime and zero downstream actions', () => {
  const evidence = createEvidence();
  assert.equal(validateLarkNotificationSafeWorkerDeployEvidence(evidence), evidence);

  for (const mutation of [
    { notificationFlagsAllFalse: false },
    { activeLocksAfter: 1 },
    { businessFactDrift: true },
    { retainedActiveWorkDrift: true },
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
    activeLocksBefore: 0,
    activeLocksAfter: 0,
    businessFactDrift: false,
    retainedActiveWorkDrift: false,
    queueSendCount: 0,
    larkWriteCount: 0,
    notificationSendCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
  };
}
