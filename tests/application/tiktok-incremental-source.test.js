import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTikTokIncrementalCheckpoint,
  planTikTokIncrementalSource,
} from '../../packages/application/src/use-cases/plan-tiktok-incremental-source.js';

test('first run is full and creates a checkpoint for every source record', async () => {
  const plan = await planTikTokIncrementalSource({
    rawRecords: [rawRecord('rec-1', 'video-1', 100)],
    dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: null, recordStates: [] },
    metricDate: '2026-07-12',
    syncMode: 'auto',
    now: 1_000,
    fullSyncIntervalMs: 86_400_000,
  });

  assert.equal(plan.mode, 'full');
  assert.equal(plan.reason, 'initial_checkpoint');
  assert.equal(plan.selectedRecords, 1);
  assert.equal(plan.sourceSkippedPerTable, 0);
  assert.equal(plan.checkpointRecords.length, 1);
});

test('unchanged same-day source uses incremental mode and skips destination planning', async () => {
  const raw = rawRecord('rec-1', 'video-1', 100, 2_000);
  const initial = await planTikTokIncrementalSource({
    rawRecords: [raw], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: null, recordStates: [] }, metricDate: '2026-07-12',
    now: 2_000, fullSyncIntervalMs: 86_400_000,
  });
  const checkpoint = buildTikTokIncrementalCheckpoint({
    plan: initial, cursorKey: 'profile:tiktok:account:native_import', syncRunId: 'run-1',
    customerProfile: 'profile', accountKey: 'account', metricDate: '2026-07-12', completedAt: 2_100,
  });

  const plan = await planTikTokIncrementalSource({
    rawRecords: [{ ...raw, lastModifiedTime: 9_999 }],
    dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: checkpoint.cursor, recordStates: checkpoint.records },
    metricDate: '2026-07-12', now: 3_000, fullSyncIntervalMs: 86_400_000,
  });

  assert.equal(plan.mode, 'incremental');
  assert.equal(plan.reason, 'no_source_changes');
  assert.equal(plan.changedRecords, 0);
  assert.equal(plan.selectedRecords, 0);
  assert.equal(plan.unchangedRecords, 1);
  assert.equal(plan.sourceSkippedPerTable, 1);
  assert.equal(plan.checkpointRecords.length, 0);
});

test('only changed source records are selected for same-day incremental processing', async () => {
  const first = rawRecord('rec-1', 'video-1', 100);
  const second = rawRecord('rec-2', 'video-2', 200);
  const baseline = await planTikTokIncrementalSource({
    rawRecords: [first, second], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: null, recordStates: [] }, metricDate: '2026-07-12',
    now: 1_000, fullSyncIntervalMs: 86_400_000,
  });
  const checkpoint = buildTikTokIncrementalCheckpoint({
    plan: baseline, cursorKey: 'cursor', syncRunId: 'run-1', customerProfile: 'profile',
    accountKey: 'account', metricDate: '2026-07-12', completedAt: 1_100,
  });

  const plan = await planTikTokIncrementalSource({
    rawRecords: [first, rawRecord('rec-2', 'video-2', 250)],
    dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: checkpoint.cursor, recordStates: checkpoint.records },
    metricDate: '2026-07-12', now: 2_000, fullSyncIntervalMs: 86_400_000,
  });

  assert.equal(plan.mode, 'incremental');
  assert.equal(plan.reason, 'source_records_changed');
  assert.equal(plan.selectedRecords, 1);
  assert.deepEqual(plan.selectedExternalContentIds, ['video-2']);
  assert.equal(plan.sourceSkippedPerTable, 1);
  assert.equal(plan.checkpointRecords[0].sourceRecordId, 'rec-2');
});

test('new metric date and dictionary changes force a safe full run', async () => {
  const raw = rawRecord('rec-1', 'video-1', 100);
  const baseline = await planTikTokIncrementalSource({
    rawRecords: [raw], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: null, recordStates: [] }, metricDate: '2026-07-12',
    now: 1_000, fullSyncIntervalMs: 86_400_000,
  });
  const checkpoint = buildTikTokIncrementalCheckpoint({
    plan: baseline, cursorKey: 'cursor', syncRunId: 'run-1', customerProfile: 'profile',
    accountKey: 'account', metricDate: '2026-07-12', completedAt: 1_100,
  });

  const newDay = await planTikTokIncrementalSource({
    rawRecords: [raw], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: checkpoint.cursor, recordStates: checkpoint.records },
    metricDate: '2026-07-13', now: 2_000, fullSyncIntervalMs: 86_400_000,
  });
  assert.equal(newDay.mode, 'full');
  assert.equal(newDay.reason, 'metric_date_changed');

  const newDictionary = await planTikTokIncrementalSource({
    rawRecords: [raw], dictionaryRecords: [dictionaryRecord('rule-2')],
    checkpoint: { cursor: checkpoint.cursor, recordStates: checkpoint.records },
    metricDate: '2026-07-12', now: 2_000, fullSyncIntervalMs: 86_400_000,
  });
  assert.equal(newDictionary.mode, 'full');
  assert.equal(newDictionary.reason, 'classification_dictionary_changed');
});

test('removed records and elapsed reconciliation interval force full mode', async () => {
  const first = rawRecord('rec-1', 'video-1', 100);
  const second = rawRecord('rec-2', 'video-2', 200);
  const baseline = await planTikTokIncrementalSource({
    rawRecords: [first, second], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: null, recordStates: [] }, metricDate: '2026-07-12',
    now: 1_000, fullSyncIntervalMs: 10_000,
  });
  const checkpoint = buildTikTokIncrementalCheckpoint({
    plan: baseline, cursorKey: 'cursor', syncRunId: 'run-1', customerProfile: 'profile',
    accountKey: 'account', metricDate: '2026-07-12', completedAt: 1_100,
  });

  const removed = await planTikTokIncrementalSource({
    rawRecords: [first], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: checkpoint.cursor, recordStates: checkpoint.records },
    metricDate: '2026-07-12', now: 2_000, fullSyncIntervalMs: 10_000,
  });
  assert.equal(removed.reason, 'source_records_removed');
  assert.equal(removed.removedRecords, 1);

  const due = await planTikTokIncrementalSource({
    rawRecords: [first, second], dictionaryRecords: [dictionaryRecord('rule-1')],
    checkpoint: { cursor: checkpoint.cursor, recordStates: checkpoint.records },
    metricDate: '2026-07-12', now: 20_000, fullSyncIntervalMs: 10_000,
  });
  assert.equal(due.reason, 'periodic_reconciliation');
});

function rawRecord(recordId, videoId, views, lastModifiedTime = 1_000) {
  return {
    recordId,
    lastModifiedTime,
    fields: {
      'Unique identifier of the video': videoId,
      'Date and time the video was published': 1_782_873_000_000,
      'Video Description': `Demo ${videoId}`,
      'Shareable URL': `https://www.tiktok.com/@ft.pumkin/video/${videoId}`,
      'Total video views': views,
    },
  };
}

function dictionaryRecord(recordId) {
  return { recordId, fields: { rule_key: recordId, enabled: true, priority: 10 } };
}
