import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueYouTubeSyncContinuation } from '../../apps/sync-worker/src/youtube-sync-continuation.js';

test('YouTube continuation preserves exact stable identity and carries no source rows', async () => {
  const sent = [];
  const operation = {
    stable: true,
    operationId: 'youtube-scheduled-20260825',
    workKey: 'youtube:youtube-scheduled-20260825',
    generation: Date.parse('2026-08-25T00:50:00Z'),
    originalRequestedAt: Date.parse('2026-08-25T00:50:00Z'),
  };
  await enqueueYouTubeSyncContinuation({
    env: { MKT_SYNC_QUEUE: { send: async (body) => sent.push(body) } },
    originalBody: {
      schemaVersion: 1,
      type: 'youtube.channel.organic.sync',
      trigger: 'scheduled',
      metricDate: '2026-08-25',
      analyticsEnabled: true,
    },
    operation,
    result: {
      continuationRequired: true,
      continuationPhase: 'youtube_owner_analytics',
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].operationId, operation.operationId);
  assert.equal(sent[0].workKey, operation.workKey);
  assert.equal(sent[0].continuationPhase, 'youtube_owner_analytics');
  assert.equal('rows' in sent[0], false);
  assert.equal('credentials' in sent[0], false);
});
