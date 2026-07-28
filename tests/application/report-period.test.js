import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysDateOnly,
  inclusiveDayCount,
  resolveReportPeriod,
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

for (const windowDays of [3, 7, 9, 15, 30, 90]) {
  test(`${windowDays}D is an inclusive rolling completed-day preset`, () => {
    const period = resolveReportPeriod({
      periodKind: 'rolling_days',
      windowDays,
      timeZone: 'America/Los_Angeles',
      now: new Date('2026-07-28T06:30:00.000Z'),
    });
    assert.equal(period.periodEnd, '2026-07-26');
    assert.equal(inclusiveDayCount(period.periodStart, period.periodEnd), windowDays);
    assert.equal(inclusiveDayCount(period.compareStart, period.compareEnd), windowDays);
    assert.equal(addDaysDateOnly(period.compareEnd, 1), period.periodStart);
  });
}

test('30D remains rolling days rather than a calendar month', () => {
  const period = resolveReportPeriod({
    periodKind: 'rolling_days',
    windowDays: 30,
    timeZone: 'Asia/Bangkok',
    periodEnd: '2026-03-01',
    now: new Date('2026-03-03T00:00:00Z'),
  });
  assert.equal(period.periodStart, '2026-01-31');
});

test('custom range is inclusive, bounded and compares an equal previous period', () => {
  const period = resolveReportPeriod({
    periodKind: 'custom_range',
    periodStart: '2026-01-30',
    periodEnd: '2026-02-02',
    timeZone: 'Asia/Bangkok',
    now: new Date('2026-02-04T00:00:00Z'),
  });
  assert.equal(period.windowDays, 4);
  assert.equal(period.compareStart, '2026-01-26');
  assert.equal(period.compareEnd, '2026-01-29');
  assert.throws(() => resolveReportPeriod({
    periodKind: 'custom_range',
    periodStart: '2024-01-01',
    periodEnd: '2026-01-01',
    timeZone: 'UTC',
    now: new Date('2026-01-03T00:00:00Z'),
  }), /exceeds 366/u);
});

test('period resolver rejects unsupported presets and uncompleted days', () => {
  assert.throws(() => resolveReportPeriod({
    periodKind: 'rolling_days',
    windowDays: 31,
    timeZone: 'UTC',
    periodEnd: '2026-07-26',
    now: new Date('2026-07-28T00:00:00Z'),
  }), /windowDays/u);
  assert.throws(() => resolveReportPeriod({
    periodKind: 'rolling_days',
    windowDays: 7,
    timeZone: 'UTC',
    periodEnd: '2026-07-28',
    now: new Date('2026-07-28T12:00:00Z'),
  }), /last completed/u);
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
