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

test('stable serializer rejects values that JSON would silently corrupt', () => {
  assert.throws(() => stableSerialize({ value: Number.NaN }), /non-finite/);
  assert.throws(() => stableSerialize(Symbol('x')), /unsupported value type/);
});
