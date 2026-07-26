import test from 'node:test';
import assert from 'node:assert/strict';
import { admitTikTokPostLarkSource } from '../../packages/application/src/use-cases/admit-tiktok-post-lark-source.js';
import { settleTikTokNativeSourceWatermark } from '../../packages/application/src/use-cases/probe-tiktok-native-source-watermark.js';
import { createTikTokSourceWatermark } from '../../packages/application/src/use-cases/tiktok-source-watermark.js';

function state(id, overrides = {}) {
  return {
    sourceRecordId: `record-${id}`,
    sourceModifiedAt: 1_780_000_000_000 + id,
    sourceHash: `hash-${id}`,
    externalContentId: `video-${id}`,
    ...overrides,
  };
}

test('TikTok source watermark is deterministic regardless of source order', async () => {
  const first = await createTikTokSourceWatermark({
    accountKey: 'chemistry_k',
    sourceHandle: '@Chemistry_K',
    recordStates: [state(2), state(1)],
  });
  const second = await createTikTokSourceWatermark({
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    recordStates: [state(1), state(2)],
  });

  assert.equal(first.sourceWatermark, second.sourceWatermark);
  assert.equal(first.recordCount, 2);
  assert.equal(first.maxModifiedAt, state(2).sourceModifiedAt);
  assert.deepEqual(first.recordStates.map((row) => row.sourceRecordId), ['record-1', 'record-2']);
});

test('TikTok source watermark rejects duplicate record and content identities', async () => {
  await assert.rejects(() => createTikTokSourceWatermark({
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    recordStates: [state(1), state(1, { externalContentId: 'video-2' })],
  }), (error) => error.code === 'TIKTOK_SOURCE_WATERMARK_DUPLICATE_RECORD');

  await assert.rejects(() => createTikTokSourceWatermark({
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    recordStates: [state(1), state(2, { externalContentId: 'video-1' })],
  }), (error) => error.code === 'TIKTOK_SOURCE_WATERMARK_DUPLICATE_CONTENT');
});

test('settling requires two identical bounded probes', async () => {
  const values = [
    { sourceWatermark: 'a', recordCount: 2, maxModifiedAt: 10, sourceHandle: 'chemistry_k' },
    { sourceWatermark: 'a', recordCount: 2, maxModifiedAt: 10, sourceHandle: 'chemistry_k' },
  ];
  const stable = await settleTikTokNativeSourceWatermark({
    probe: async () => values.shift(),
    settleMs: 1,
    sleep: async () => undefined,
  });
  assert.equal(stable.settled, true);

  const changedValues = [
    { sourceWatermark: 'a', recordCount: 2, maxModifiedAt: 10, sourceHandle: 'chemistry_k' },
    { sourceWatermark: 'b', recordCount: 3, maxModifiedAt: 11, sourceHandle: 'chemistry_k' },
  ];
  const changed = await settleTikTokNativeSourceWatermark({
    probe: async () => changedValues.shift(),
    settleMs: 0,
  });
  assert.equal(changed.settled, false);
  assert.equal(changed.reason, 'source_changed_during_settle_window');
});

test('same watermark admission is a no-op and preserves the original generation', async () => {
  const queued = [];
  const original = {
    admissionKey: 'tiktok-admission:identity',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    sourceWatermark: 'watermark-1',
    metricDate: '2026-07-25',
    sourceRecordCount: 2021,
    sourceMaxModifiedAt: 1_780_000_000_000,
    generation: 1_780_000_100_000,
    requestedAt: 1_780_000_100_000,
    workKey: 'tiktok:watermark:identity',
    status: 'completed',
  };
  const store = {
    async readAdmission() { return original; },
    async claimAdmission() { throw new Error('must not claim again'); },
    async markQueued() { throw new Error('must not queue again'); },
    async markFailed() { throw new Error('must not fail'); },
  };
  const result = await admitTikTokPostLarkSource({
    settledProbe: {
      settled: true,
      second: {
        sourceWatermark: 'watermark-1',
        recordCount: 2021,
        maxModifiedAt: 1_780_000_000_000,
        sourceHandle: 'chemistry_k',
      },
    },
    store,
    queue: { async send(body) { queued.push(body); } },
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    metricDate: '2026-07-25',
    requestedAt: 1_780_100_000_000,
    syncJobType: 'tiktok.creator.native.sync',
    fingerprint: async () => 'identity',
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'admission_completed');
  assert.equal(result.admission.generation, original.generation);
  assert.equal(queued.length, 0);
});

test('new watermark admission queues one stable operation identity', async () => {
  let stored = null;
  const queued = [];
  const store = {
    async readAdmission() { return null; },
    async claimAdmission(input) {
      stored = {
        ...input,
        status: 'pending',
      };
      return { created: true, admission: stored };
    },
    async markQueued() {
      stored = { ...stored, status: 'queued' };
      return stored;
    },
    async markFailed() { throw new Error('not expected'); },
  };
  const result = await admitTikTokPostLarkSource({
    settledProbe: {
      settled: true,
      second: {
        sourceWatermark: 'watermark-2',
        recordCount: 2022,
        maxModifiedAt: 1_780_200_000_000,
        sourceHandle: 'chemistry_k',
      },
    },
    store,
    queue: { async send(body) { queued.push(body); } },
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    metricDate: '2026-07-25',
    requestedAt: 1_780_200_100_000,
    syncJobType: 'tiktok.creator.native.sync',
    fingerprint: async () => 'identity-2',
  });

  assert.equal(result.status, 'queued');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].operationId, 'watermark:identity-2');
  assert.equal(queued[0].workKey, 'tiktok:watermark:identity-2');
  assert.equal(queued[0].generation, 1_780_200_100_000);
  assert.equal(queued[0].metricDate, '2026-07-25');
});
