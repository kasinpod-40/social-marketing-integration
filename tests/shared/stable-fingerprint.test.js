import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableFingerprint, stableSerialize } from '../../packages/shared/src/hash/stable-fingerprint.js';

test('stable fingerprint ignores object insertion order but preserves array order', async () => {
  const first = await createStableFingerprint({ b: 2, a: { y: 2, x: 1 }, items: ['a', 'b'] });
  const second = await createStableFingerprint({ items: ['a', 'b'], a: { x: 1, y: 2 }, b: 2 });
  const different = await createStableFingerprint({ items: ['b', 'a'], a: { x: 1, y: 2 }, b: 2 });

  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.match(first, /^[a-f0-9]{64}$/u);
});

test('YouTube resumable work identity ignores derived auto mode changes across the same Queue retry', async () => {
  const fullAttempt = await createStableFingerprint({
    contract: 'youtube-organic-resumable-v1',
    channelId: 'channel_A',
    metricDate: '2026-07-20',
    syncMode: 'full',
    fullSnapshot: true,
    recentVideoLimit: 100,
    analyticsRange: null,
  });
  const retryAfterCheckpoint = await createStableFingerprint({
    contract: 'youtube-organic-resumable-v1',
    channelId: 'channel_A',
    metricDate: '2026-07-20',
    syncMode: 'incremental',
    fullSnapshot: false,
    recentVideoLimit: 100,
    analyticsRange: null,
  });
  const differentRequestScope = await createStableFingerprint({
    contract: 'youtube-organic-resumable-v1',
    channelId: 'channel_B',
    metricDate: '2026-07-20',
    syncMode: 'incremental',
    fullSnapshot: false,
    recentVideoLimit: 100,
    analyticsRange: null,
  });

  assert.equal(fullAttempt, retryAfterCheckpoint);
  assert.notEqual(fullAttempt, differentRequestScope);
});

test('stable serializer rejects values that JSON would silently corrupt', () => {
  assert.throws(() => stableSerialize({ value: Number.NaN }), /non-finite/);
  assert.throws(() => stableSerialize(Symbol('x')), /unsupported value type/);
});
