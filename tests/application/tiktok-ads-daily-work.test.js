import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTikTokAdsDailyPlan, runTikTokAdsDailyWork } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-work.js';
import { InMemoryResumableWorkStore } from '../../packages/sync-engine/src/in-memory-resumable-work-store.js';
const now = Date.parse('2026-10-04T12:00:00Z');
function fixture() {
  const plan = buildTikTokAdsDailyPlan({ periodEnd:'2026-10-03', timezone:'Asia/Bangkok', now });
  const executed = []; const sent = [];
  const input = { plan, accountKey:'demo', periodEnd:'2026-10-03', jobType:'test',
    operation:{workKey:'test:daily', generation:now, originalRequestedAt:now},
    store:new InMemoryResumableWorkStore({ now:()=>now }),
    async runUnit(unit, fence) { await fence(); executed.push(unit.index); },
    async enqueueContinuation(index) { sent.push(index); } };
  return {input, executed, sent};
}
test('month-boundary plan closes source and both grains before Lark, Summary and all Reports', () => {
  const f = fixture(); const plan = f.input.plan;
  assert.deepEqual(plan.filter(unit=>unit.kind==='summary').map(unit=>unit.month),['2026-09','2026-10']);
  assert.equal(plan.filter(unit=>unit.kind==='d1').length,14);
  assert.equal(plan.filter(unit=>unit.kind==='lark').length,14);
  assert.deepEqual(plan.filter(unit=>unit.kind==='report').map(unit=>unit.days),[1,3,7,30]);
  assert.ok(plan.findLastIndex(unit=>unit.kind==='d1') < plan.findIndex(unit=>unit.kind==='lark'));
  assert.throws(()=>buildTikTokAdsDailyPlan({ periodEnd:'2026-10-04',timezone:'Asia/Bangkok',now }));
  assert.throws(()=>buildTikTokAdsDailyPlan({ periodEnd:'2026-09-20',timezone:'Asia/Bangkok',now }));
});
test('send failure resumes the committed unit without repeating business writes; terminal replay sends nothing', async () => {
  const f=fixture(); const enqueue=f.input.enqueueContinuation;
  f.input.enqueueContinuation=async()=>{throw Error('Queue unavailable');};
  await assert.rejects(runTikTokAdsDailyWork(f.input)); assert.deepEqual(f.executed,[0]);
  f.input.enqueueContinuation=enqueue;
  assert.equal((await runTikTokAdsDailyWork(f.input)).replayedUnit,true);
  assert.deepEqual(f.executed,[0]); assert.deepEqual(f.sent,[1]);
  for(let index=1;index<f.input.plan.length;index++) await runTikTokAdsDailyWork({...f.input,unitIndex:index});
  assert.equal(f.executed.length,f.input.plan.length);
  const sent=f.sent.length;
  assert.equal((await runTikTokAdsDailyWork(f.input)).replayed,true);
  assert.equal(f.sent.length,sent);
});
test('business failure never seals a checkpoint; skipped predecessor and changed identity fail closed', async () => {
  const f=fixture(); const run=f.input.runUnit;
  f.input.runUnit=async()=>{throw Error('partial write/readback failure');};
  await assert.rejects(runTikTokAdsDailyWork(f.input));
  assert.equal(await f.input.store.loadPhase({workKey:'test:daily',phase:'daily_unit_0'}),null);
  assert.deepEqual(f.sent,[]);
  f.input.runUnit=run;
  await assert.rejects(runTikTokAdsDailyWork({...f.input,unitIndex:2}),e=>e.code==='TIKTOK_ADS_DAILY_PREDECESSOR_PENDING');
  await runTikTokAdsDailyWork(f.input);
  await assert.rejects(runTikTokAdsDailyWork({...f.input,periodEnd:'2026-10-02'}),e=>e.code==='SYNC_WORK_OPERATION_MISMATCH');
});
test('new generation fences stale deliveries while independent closed dates can finish', async () => {
  const f=fixture(); await runTikTokAdsDailyWork(f.input);
  const newer={...f.input,operation:{workKey:'test:new',generation:now+1,originalRequestedAt:now+1}};
  await runTikTokAdsDailyWork(newer);
  assert.equal((await runTikTokAdsDailyWork(f.input)).status,'superseded');
  await runTikTokAdsDailyWork({...f.input,periodEnd:'2026-10-02',operation:{workKey:'test:olderdate',generation:now-1,originalRequestedAt:now-1}});
});
