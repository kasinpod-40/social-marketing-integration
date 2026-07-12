import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysDateOnly,
  inclusiveDayCount,
  resolveOrganicReportPeriod,
} from '../../packages/application/src/reports/report-period.js';

test('daily report defaults to the last completed Bangkok day', () => {
  const period = resolveOrganicReportPeriod({
    reportType: 'daily_organic_report',
    timeZone: 'Asia/Bangkok',
    now: new Date('2026-07-12T16:30:00.000Z'),
  });

  assert.deepEqual(period, {
    reportType: 'daily_organic_report',
    periodStart: '2026-07-11',
    periodEnd: '2026-07-11',
    comparisonMode: 'previous_period',
    compareStart: '2026-07-10',
    compareEnd: '2026-07-10',
    days: 1,
  });
});

test('weekly report resolves inclusive seven-day current and previous periods', () => {
  const period = resolveOrganicReportPeriod({
    reportType: 'weekly_organic_report',
    timeZone: 'Asia/Bangkok',
    periodEnd: '2026-07-12',
  });

  assert.equal(period.periodStart, '2026-07-06');
  assert.equal(period.compareStart, '2026-06-29');
  assert.equal(period.compareEnd, '2026-07-05');
  assert.equal(inclusiveDayCount(period.periodStart, period.periodEnd), 7);
});

test('date-only arithmetic handles leap years without machine timezone dependence', () => {
  assert.equal(addDaysDateOnly('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysDateOnly('2024-03-01', -1), '2024-02-29');
  assert.equal(inclusiveDayCount('2024-02-28', '2024-03-01'), 3);
});
