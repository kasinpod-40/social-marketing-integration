import test from 'node:test';
import assert from 'node:assert/strict';
import { processTikTokAdsDailyJob, TIKTOK_ADS_DAILY_REQUIRED_FLAGS } from '../../apps/sync-worker/src/tiktok-ads-daily-job-router.js';
import { buildTikTokAdsDailyPlan } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-work.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import { JOB_TYPES, JOB_TRIGGERS } from '../../packages/application/src/jobs/job-catalog.js';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { InMemoryResumableWorkStore } from '../../packages/sync-engine/src/in-memory-resumable-work-store.js';
import { todayInTimeZone } from '../../packages/shared/src/date/date-only.js';
import { addDaysDateOnly } from '../../packages/application/src/reports/report-period.js';
function fixture() {
 const now=Date.now(), date=addDaysDateOnly(todayInTimeZone('Asia/Bangkok',new Date(now)),-1);
 const env={MKT_ENV:'development',MKT_CUSTOMER_PROFILE:'integration_workspace',MKT_STATE_DB:{prepare(){},async batch(){}},
  ...Object.fromEntries(TIKTOK_ADS_DAILY_REQUIRED_FLAGS.map(flag=>[flag,'true']))};
 for(const name of ['MKT_ADS_ACCOUNTS','MKT_ADS_CAMPAIGNS','MKT_ADS_ADGROUPS','MKT_ADS_ADS','MKT_ADS_CREATIVES','MKT_ADS_DAILY','MKT_ADS_CAMPAIGN_SUMMARY'])env[`LARK_TABLE_${name}`]=name;
 const sent=[], calls=[], store=new InMemoryResumableWorkStore();
 env.MKT_SYNC_QUEUE={async send(body){sent.push(body);}};
 const body=createStableQueueOperationBody({schemaVersion:1,type:JOB_TYPES.TIKTOK_ADS_DAILY_SYNC,
   trigger:JOB_TRIGGERS.META_ORGANIC_SCHEDULED,periodEnd:date,unitIndex:0},{operationId:'daily-test',originalRequestedAt:now});
 const infrastructure={getMarketingHistoryStore:()=>({}),getResumableWorkStore:()=>store,
  getLarkBitableClient:()=>({}),repository:{},syncEngine:{}};
 const input={job:{body},env,getRuntimeConfig:()=>loadCustomerRuntimeConfig(env),getInfrastructure:()=>infrastructure};
 const run=kind=>async data=>{calls.push({kind,grain:data.grain,date:data.date,month:data.month});return {reconciled:true};};
 const dependencies={async loadSource(){calls.push({kind:'credential'});return {status:200,connection:{externalAccountId:'123',providerMetadata:{currency:'THB',timezone:'Asia/Bangkok'}},client:{},accessToken:'private'};},
  master:run('master'),daily:run('d1'),project:run('lark'),summary:run('summary'),
  async prove(){calls.push({kind:'proof'});return {identityReconciled:true,totalsMatch:Object.fromEntries(Array.from({length:7},(_,i)=>[i,true]))};},
  async processReport(data){calls.push({kind:'report',days:data.job.body.windowDays});return {lark:{readback:{reconciled:true}}};}};
 return {input,dependencies,sent,calls,date,now};
}
test('daily router executes one unit per delivery, preserves identity and follows source with four Reports',async()=>{
 const f=fixture();const plan=buildTikTokAdsDailyPlan({periodEnd:f.date,timezone:'Asia/Bangkok',now:f.now});
 let body=f.input.job.body;
 for(let i=0;i<plan.length;i++){
  const result=await processTikTokAdsDailyJob({...f.input,job:{body}},f.dependencies);
  if(i<plan.length-1){assert.equal(result.continuationRequired,true);body=f.sent.at(-1);assert.equal(body.workKey,f.input.job.body.workKey);assert.equal(body.generation,f.now);}
  else assert.equal(result.status,'success');
 }
 assert.equal(f.calls.filter(x=>x.kind==='d1').length,14);
 assert.equal(f.calls.filter(x=>x.kind==='lark').length,14);
 assert.deepEqual(f.calls.filter(x=>x.kind==='report').map(x=>x.days),[1,3,7,30]);
 assert.equal(JSON.stringify(f.sent).includes('private'),false);
 const count=f.calls.filter(x=>x.kind!=='credential').length;
 assert.equal((await processTikTokAdsDailyJob(f.input,f.dependencies)).replayed,true);
 assert.equal(f.calls.filter(x=>x.kind!=='credential').length,count);
});
test('disabled business gate, unknown schema and Production readiness reject before credential access',async()=>{
 for(const flag of TIKTOK_ADS_DAILY_REQUIRED_FLAGS){const f=fixture();f.input.env[flag]='false';await assert.rejects(processTikTokAdsDailyJob(f.input,f.dependencies));assert.equal(f.calls.length,0);}
 const f=fixture();await assert.rejects(processTikTokAdsDailyJob({...f.input,job:{body:{...f.input.job.body,schemaVersion:2}}},f.dependencies));assert.equal(f.calls.length,0);
 f.input.env.MKT_ENV='production';f.input.env.MKT_CUSTOMER_PROFILE='chemistry_k';
 await assert.rejects(processTikTokAdsDailyJob(f.input,f.dependencies),e=>e.code==='MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING');assert.equal(f.calls.length,0);
});
test('failed cross-grain proof never reaches D1 or sends another unit',async()=>{
 const f=fixture();await processTikTokAdsDailyJob(f.input,f.dependencies);
 f.dependencies.prove=async()=>({identityReconciled:true,totalsMatch:{spend:false}});
 await assert.rejects(processTikTokAdsDailyJob({...f.input,job:{body:f.sent[0]}},f.dependencies),e=>e.code==='TIKTOK_ADS_DAILY_CORE_PARITY_FAILED');
 assert.equal(f.sent.length,1);assert.equal(f.calls.some(x=>x.kind==='d1'),false);
});
