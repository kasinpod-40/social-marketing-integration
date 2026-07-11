import test from 'node:test';
import assert from 'node:assert/strict';
import { toFiniteNumber } from '../../packages/shared/src/number/strict-number.js';

test('strict number parser accepts finite numbers and correctly grouped numeric strings', () => {
  assert.equal(toFiniteNumber(12.5), 12.5);
  assert.equal(toFiniteNumber(' 1,234.50 '), 1234.5);
  assert.equal(toFiniteNumber('-2.5e3'), -2500);
  assert.equal(toFiniteNumber(null, { allowNull: true }), null);
});

test('strict number parser rejects booleans, blank strings, and malformed comma grouping', () => {
  assert.throws(() => toFiniteNumber(true), /number or numeric string/);
  assert.throws(() => toFiniteNumber('   '), /required/);
  assert.throws(() => toFiniteNumber('1,2'), /valid numeric value/);
  assert.throws(() => toFiniteNumber('12,34,567'), /valid numeric value/);
});
