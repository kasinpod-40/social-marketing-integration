import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkNativeAiControlledPreviewExecutionPlan,
  simulateLarkNativeAiControlledPreviewExecution,
} from '../../packages/application/src/reports/build-lark-native-ai-controlled-preview-execution-plan.js';
import {
  buildControlledPreviewReadinessPlans,
  CONTROLLED_PREVIEW_TEST_HEAD,
} from '../helpers/lark-native-ai-controlled-preview-readiness-plans.js';

async function buildInput(options = {}) {
  return buildControlledPreviewReadinessPlans(options);
}

test('builds one bounded 40-row create plan for four windows', async () => {
  const input = await buildInput();
  const plan = await buildLarkNativeAiControlledPreviewExecutionPlan({
    ...input,
    existingRecords: [],
  });

  assert.equal(plan.status, 'ready_to_apply');
  assert.deepEqual(plan.windows, [1, 3, 7, 30]);
  assert.equal(plan.desiredRowCount, 40);
  assert.deepEqual(plan.counts, {
    create: 40,
    update: 0,
    noOp: 0,
    write: 40,
    delete: 0,
    total: 40,
  });
  assert.equal(plan.actions.every(({ action }) => action === 'create'), true);
  assert.equal(plan.safety.remoteApplyImplemented, false);
  assert.equal(plan.safety.executionAuthorized, false);
  assert.equal(plan.safety.deleteActionCount, 0);
  assert.equal(plan.safety.larkRecordWriteCount, 0);
  assert.equal(plan.safety.production, 'BLOCKED');

  const windows = new Map();
  for (const action of plan.actions) {
    const items = windows.get(action.windowDays) ?? [];
    items.push(action.channelKey);
    windows.set(action.windowDays, items);
    assert.equal(action.fields.preview_mode, true);
    assert.equal(action.fields.notification_eligible, false);
    assert.equal(action.fields.sent_to_group, false);
    assert.equal(action.fields.sent_at, null);
  }
  for (const windowDays of [1, 3, 7, 30]) {
    assert.equal(windows.get(windowDays).length, 10);
    assert.equal(windows.get(windowDays).includes('executive'), true);
  }
});

test('same-input replay converges to forty no-op actions and zero writes', async () => {
  const input = await buildInput();
  const first = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: [] });
  const records = simulateLarkNativeAiControlledPreviewExecution(first, []);
  const replay = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: records });

  assert.equal(replay.status, 'zero_drift');
  assert.equal(replay.counts.create, 0);
  assert.equal(replay.counts.update, 0);
  assert.equal(replay.counts.noOp, 40);
  assert.equal(replay.counts.write, 0);
  assert.equal(replay.planId, (await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: records })).planId);
});

test('partial resume creates only missing rows without deleting retained rows', async () => {
  const input = await buildInput();
  const first = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: [] });
  const allRecords = simulateLarkNativeAiControlledPreviewExecution(first, []);
  const retained = allRecords.slice(0, 13);
  retained.push({ recordId: 'legacy-unmanaged', fields: { report_id: 'legacy' } });

  const resume = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: retained });
  assert.equal(resume.status, 'ready_to_apply');
  assert.equal(resume.counts.create, 27);
  assert.equal(resume.counts.update, 0);
  assert.equal(resume.counts.noOp, 13);
  assert.equal(resume.counts.delete, 0);

  const completed = simulateLarkNativeAiControlledPreviewExecution(resume, retained);
  assert.equal(completed.some(({ recordId }) => recordId === 'legacy-unmanaged'), true);
  assert.equal(completed.length, 41);
});

test('repairs managed-field drift while preserving generated AI output for identical evidence', async () => {
  const input = await buildInput();
  const first = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: [] });
  const records = structuredClone(simulateLarkNativeAiControlledPreviewExecution(first, []));
  const target = records.find(({ fields }) => fields.channel_key === 'tiktok_organic'
    && fields.window_days === '30');
  target.fields.readiness_message = 'manual drift';
  target.fields.insight_summary = 'Validated generated insight';
  target.fields.generation_status = 'generated';

  const repair = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: records });
  const action = repair.actions.find(({ aiRunKey }) => aiRunKey === target.fields.ai_run_key);
  assert.equal(action.action, 'update');
  assert.equal(action.reason, 'managed_field_drift');
  assert.equal(action.clearsAiOutput, false);
  assert.equal(Object.prototype.hasOwnProperty.call(action.fieldsPatch, 'insight_summary'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(action.fieldsPatch, 'generation_status'), false);

  const completed = simulateLarkNativeAiControlledPreviewExecution(repair, records);
  const repaired = completed.find(({ fields }) => fields.ai_run_key === target.fields.ai_run_key);
  assert.equal(repaired.fields.insight_summary, 'Validated generated insight');
  assert.equal(repaired.fields.generation_status, 'generated');
  assert.notEqual(repaired.fields.readiness_message, 'manual drift');
});

test('evidence revision updates the same identities and clears stale AI output', async () => {
  const initialInput = await buildInput();
  const first = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...initialInput, existingRecords: [] });
  const records = structuredClone(simulateLarkNativeAiControlledPreviewExecution(first, []));
  for (const record of records.filter(({ fields }) => fields.channel_key === 'tiktok_organic')) {
    record.fields.insight_summary = 'Stale generated output';
    record.fields.generation_status = 'generated';
  }

  const revisedInput = await buildInput({ metricDelta: 7 });
  const revised = await buildLarkNativeAiControlledPreviewExecutionPlan({
    ...revisedInput,
    existingRecords: records,
  });
  const revisions = revised.actions.filter(({ reason }) => reason === 'evidence_revision');
  assert.equal(revised.status, 'ready_to_apply');
  assert.equal(revisions.length, 4);
  assert.equal(revisions.every(({ channelKey }) => channelKey === 'tiktok_organic'), true);
  assert.equal(revisions.every(({ clearsAiOutput }) => clearsAiOutput === true), true);
  assert.equal(revisions.every(({ fieldsPatch }) => fieldsPatch.insight_summary === null), true);

  const completed = simulateLarkNativeAiControlledPreviewExecution(revised, records);
  for (const record of completed.filter(({ fields }) => fields.channel_key === 'tiktok_organic')) {
    assert.equal(record.fields.insight_summary, null);
    assert.equal(record.fields.generation_status, 'pending');
  }
});

test('blocks unsafe existing rows instead of overwriting sent or non-preview records', async () => {
  const input = await buildInput();
  const first = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: [] });
  const records = structuredClone(simulateLarkNativeAiControlledPreviewExecution(first, []));
  records[0].fields.sent_to_group = true;

  const blocked = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: records });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.actions.length, 0);
  assert.equal(blocked.counts.write, 0);
  assert.equal(blocked.blockers.some(({ code }) => code === 'EXISTING_RECORD_NOT_SAFE_PREVIEW'), true);
});

test('blocks duplicate retained ai_run_key and dedupe ownership', async () => {
  const input = await buildInput();
  const first = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: [] });
  const records = structuredClone(simulateLarkNativeAiControlledPreviewExecution(first, []));
  records.push({ ...structuredClone(records[0]), recordId: 'duplicate-record' });

  const blocked = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: records });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.actions.length, 0);
  assert.equal(blocked.blockers.some(({ code }) => code === 'EXISTING_AI_RUN_KEY_DUPLICATE'), true);
});

test('blocks missing windows and readiness plans that have not released the Remote lock', async () => {
  const complete = await buildInput();
  const missing = await buildLarkNativeAiControlledPreviewExecutionPlan({
    repository: complete.repository,
    readinessPlans: complete.readinessPlans.slice(0, 3),
    existingRecords: [],
  });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.blockers.some(({ code }) => code === 'READINESS_PLAN_COUNT_INVALID'), true);
  assert.equal(missing.blockers.some(({ code }) => code === 'READINESS_PLAN_WINDOW_MISSING'), true);

  const waiting = await buildInput({ lockReleased: false, approved: false });
  const notReady = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...waiting, existingRecords: [] });
  assert.equal(notReady.status, 'blocked');
  assert.equal(notReady.blockers.some(({ code }) => code === 'READINESS_PLAN_NOT_READY'), true);
});

test('blocks a readiness set bound to a different exact repository Head', async () => {
  const input = await buildInput();
  const blocked = await buildLarkNativeAiControlledPreviewExecutionPlan({
    repository: { branch: 'main', clean: true, exactHeadSha: 'd'.repeat(40) },
    readinessPlans: input.readinessPlans,
    existingRecords: [],
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.blockers.some(({ code }) => code === 'READINESS_PLAN_REPOSITORY_MISMATCH'), true);
  assert.equal(blocked.safety.executionAuthorized, false);
});

test('plan identity is deterministic and contains no delete authority', async () => {
  const input = await buildInput({ headSha: CONTROLLED_PREVIEW_TEST_HEAD });
  const left = await buildLarkNativeAiControlledPreviewExecutionPlan({ ...input, existingRecords: [] });
  const right = await buildLarkNativeAiControlledPreviewExecutionPlan({
    ...input,
    existingRecords: [],
  });
  assert.equal(left.planId, right.planId);
  assert.equal(left.counts.delete, 0);
  assert.equal(left.actions.some(({ action }) => action === 'delete'), false);
});
