import test from 'node:test';
import assert from 'node:assert/strict';
import { toEpochMilliseconds } from '../../packages/connectors/src/shared/date-time.js';

test('normalizes epoch seconds, epoch milliseconds, numeric strings, Date, and ISO timestamps', () => {
  assert.equal(toEpochMilliseconds(1783328400), 1783328400000);
  assert.equal(toEpochMilliseconds(1783328400000), 1783328400000);
  assert.equal(toEpochMilliseconds('1783328400000'), 1783328400000);
  assert.equal(toEpochMilliseconds(new Date('2026-07-06T09:00:00Z')), 1783328400000);
  assert.equal(toEpochMilliseconds('2026-07-06T09:00:00Z'), 1783328400000);
});

test('supports nullable values and rejects ambiguous or implausible dates', () => {
  assert.equal(toEpochMilliseconds(null, { allowNull: true }), null);
  assert.throws(() => toEpochMilliseconds('2026-07-06 16:00:00'), /explicit timezone/);
  assert.throws(() => toEpochMilliseconds(123), /outside the supported range/);
});


test('rejects impossible ISO calendar dates, clock values, and timezone offsets', () => {
  assert.throws(() => toEpochMilliseconds('2026-02-30T10:00:00Z'), /valid calendar date/);
  assert.throws(() => toEpochMilliseconds('2026-07-11T24:00:00Z'), /invalid clock time/);
  assert.throws(() => toEpochMilliseconds('2026-07-11T10:00:00+15:00'), /unsupported timezone offset/);
});

test('normalizes compact offsets and fractional seconds deterministically', () => {
  assert.equal(
    toEpochMilliseconds('2026-07-11T10:00:00.123456+0700'),
    Date.parse('2026-07-11T10:00:00.123+07:00'),
  );
});
