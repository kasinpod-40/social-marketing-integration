import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  buildYouTubeFirstAdopterPlan,
} from '../../scripts/multichannel-report-live-closure-terminal.mjs';

test('builds a zero-write YouTube first-adopter plan', () => {
  const plan = buildYouTubeFirstAdopterPlan({}, []);
  assert.equal(plan.frameworkStatus, 'READY');
  assert.equal(plan.firstAdopter, 'youtube');
  assert.equal(plan.youtubeStatus, 'READY_FOR_LIVE');
  assert.deepEqual(plan.identities.map((identity) => identity.window_days), [1, 3, 7, 30]);
  assert.equal(plan.remoteWriteCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('blocks execute while Meta Remote lock is active', () => {
  assert.throws(
    () => buildYouTubeFirstAdopterPlan({}, ['--execute']),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_META_REMOTE_LOCK_ACTIVE',
  );
});

test('keeps execution unbound even after explicit lock release and confirmation', () => {
  assert.throws(
    () => buildYouTubeFirstAdopterPlan({
      MKT_META_REMOTE_LOCK_RELEASED: 'true',
      CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE: MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
    }, ['--platform=youtube', '--capability=organic', '--execute']),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_EXECUTION_AUTHORITY_NOT_BOUND',
  );
});
