import { addDaysDateOnly } from '../reports/report-period.js';
import { requireDateOnly, todayInTimeZone } from '../../../shared/src/date/date-only.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

/** หนึ่งหน่วยต่อ delivery: source proof -> D1 -> Lark -> Summary -> Report */
export function buildTikTokAdsDailyPlan({ periodEnd, timezone, now = Date.now() }) {
  const date = requireDateOnly(periodEnd);
  const today = todayInTimeZone(timezone, new Date(now));
  if (date >= today || date < addDaysDateOnly(today, -7)) {
    throw permanentError('TikTok daily operation requires a recent closed date', { code: 'TIKTOK_ADS_DAILY_PERIOD_INVALID' });
  }
  const dates = Array.from({ length: 7 }, (_, i) => addDaysDateOnly(date, i - 6));
  return Object.freeze([
    { kind: 'master' },
    ...dates.map(date => ({ kind: 'proof', date })),
    ...dates.flatMap(date => ['campaign', 'ad'].map(grain => ({ kind: 'd1', date, grain }))),
    ...dates.flatMap(date => ['campaign', 'ad'].map(grain => ({ kind: 'lark', date, grain }))),
    ...[...new Set(dates.map(date => date.slice(0, 7)))].map(month => ({ kind: 'summary', month })),
    ...[1,3,7,30].map(days => ({ kind: 'report', days, date })),
  ].map((unit, index) => Object.freeze({ ...unit, index })));
}

/** Commit business readback before checkpoint; send failure resumes without rerunning that unit. */
export async function runTikTokAdsDailyWork(input) {
  const { operation, store, plan } = input;
  const index = input.unitIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= plan.length) {
    throw permanentError('Unsupported daily continuation unit', { code: 'TIKTOK_ADS_DAILY_UNIT_INVALID' });
  }
  const cursorKey = `tiktok_ads:daily:${input.accountKey}:${input.periodEnd}`;
  const operationFingerprint = await createStableFingerprint({ version: 1, accountKey: input.accountKey,
    periodEnd: input.periodEnd, plan });
  const work = await store.beginWork({ ...operation, cursorKey, workType: input.jobType,
    requestedAt: operation.originalRequestedAt, operationFingerprint });
  if (work.completed) return { status: 'success', replayed: true, units: plan.length };
  if (work.superseded) return { status: 'superseded' };
  const assertCurrent = () => store.assertCurrentGeneration({ workKey: operation.workKey,
    cursorKey, generation: operation.generation });
  await assertCurrent();
  const phase = `daily_unit_${index}`;
  if (index > 0 && (await store.loadPhase({ workKey: operation.workKey, phase: `daily_unit_${index-1}` }))?.complete !== true) {
    throw transientError('Daily predecessor checkpoint has not committed', { code: 'TIKTOK_ADS_DAILY_PREDECESSOR_PENDING' });
  }
  const existing = await store.loadPhase({ workKey: operation.workKey, phase });
  if (existing?.complete !== true) {
    await input.runUnit(plan[index], assertCurrent);
    await assertCurrent();
    await store.savePhase({ workKey: operation.workKey, phase, state: { kind: plan[index].kind },
      expectedItems: 1, processedItems: 1, complete: true });
  }
  if (index + 1 === plan.length) {
    await store.completeWork({ workKey: operation.workKey, completion: { status: 'success', units: plan.length } });
    return { status: 'success', units: plan.length };
  }
  await input.enqueueContinuation(index + 1);
  return { status: 'continuation', continuationRequired: true, units: plan.length,
    completedUnit: index, replayedUnit: existing?.complete === true };
}
