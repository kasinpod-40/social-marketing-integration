import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateOnlyToEpochMilliseconds,
  requireDateOnly,
  todayInTimeZone,
} from '../../packages/shared/src/date/date-only.js';

test('date-only validator accepts real leap dates and rejects impossible calendar dates', () => {
  assert.equal(requireDateOnly('2028-02-29'), '2028-02-29');
  assert.throws(() => requireDateOnly('2026-02-29'), /not a valid calendar date/);
  assert.throws(() => requireDateOnly('2026-13-01'), /not a valid calendar date/);
});

test('timezone date helper returns Bangkok date without relying on machine timezone', () => {
  assert.equal(todayInTimeZone('Asia/Bangkok', new Date('2026-07-10T18:00:00Z')), '2026-07-11');
  assert.equal(
    dateOnlyToEpochMilliseconds('2026-07-11', { utcOffset: '+07:00' }),
    Date.parse('2026-07-11T00:00:00+07:00'),
  );
});
