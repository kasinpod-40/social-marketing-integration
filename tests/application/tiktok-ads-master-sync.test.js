import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { runTikTokAdsMasterSync } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-master-sync.js';
function fixture() {
  const rows = []; const writes = []; const locks = []; const specs = new Map();
  let lease = true; let failTable = null; let drift = false;
  const row = { kind: 'campaign', id: '10', name: 'Example', status: 'ENABLE', automationType: 'MANUAL',
    campaignId: '10', adGroupId: null, videoId: null, imageIds: [] };
  const input = { execute: false, writeEnabled: true, advertiserId: '123', accountKey: 'demo', customerKey: 'demo',
    currency: 'THB', timezone: 'Asia/Bangkok', accessToken: 'private',
    client: { async listEntityMetadata({kind}) { return { totalCount: kind === 'campaign' ? 1 : 0,
      rows: kind === 'campaign' ? [row] : [] }; },
    async getAdvertiser() { return { advertiserId: '123', advertiserName: 'Example', currency: 'THB', timezone: 'Asia/Bangkok' }; } },
    db: { prepare(sql) { return { bind() { return { async first() { return { active_locks: 0 }; },
      async all() { return { results: rows.map(row => drift ? { ...row, entity_name: 'drift' } : { ...row }) }; } }; } }; } },
    historyStore: { async writeMetaD1Operations(ops) { writes.push('d1'); for (const {row} of ops) {
      const current = rows.find(value => value.entity_key === row.entity_key);
      if (current) Object.assign(current, row); else rows.push({ ...row });
    } } },
    lockStore: { async acquire() { locks.push('acquire'); return { acquired: true }; },
      async renew() { return { renewed: lease }; }, async release() { locks.push('release'); }, async saveSyncRun() {} },
    tables: { mktAdsAccounts: 'accounts', mktAdsCampaigns: 'campaigns', mktAdsAdGroups: 'groups', mktAdsAds: 'ads', mktAdsCreatives: 'creatives' },
    repository: {}, larkClient: { async requestBitableJson() { return { data: { total: 0 } }; } },
    syncEngine: { async planByKey(spec) {
      if (failTable === spec.tableId) throw Error('Schema invalid');
      const existing = specs.get(spec.tableId);
      return { ...spec, inputRows: spec.rows.length, duplicateInputRows: 0,
        createRows: existing ? [] : spec.rows, updateRows: [], skipped: existing ? spec.rows.length : 0 };
    }, async executePlan(plan, {beforeWriteChunk}) { await beforeWriteChunk(); writes.push('lark'); specs.set(plan.tableId, plan.rows); } },
  };
  return { input, rows, writes, locks, setLease(v) { lease=v; }, setFailTable(v) { failTable=v; }, setDrift(v) { drift=v; } };
}
test('master preview writes nothing; first run/readback succeeds and replay has zero D1 changes', async () => {
  const f=fixture(); assert.equal((await runTikTokAdsMasterSync(f.input)).d1Changed, 2);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.locks, []);
  const first=await runTikTokAdsMasterSync({ ...f.input, execute: true });
  assert.equal(first.reconciled, true); assert.equal(f.rows.length, 2);
  f.writes.length=0;
  const replay=await runTikTokAdsMasterSync({ ...f.input, execute: true });
  assert.equal(replay.d1Changed, 0); assert.equal(f.writes.includes('d1'), false);
  assert.ok(replay.tables.every(table=>table.created===0 && table.updated===0));
});
test('all-table preflight, lease and D1 readback errors prevent downstream false success', async () => {
  for (const issue of ['schema','lease','readback']) {
    const f=fixture(); if(issue==='schema')f.setFailTable('creatives');
    if(issue==='lease')f.setLease(false); if(issue==='readback')f.setDrift(true);
    await assert.rejects(runTikTokAdsMasterSync({ ...f.input, execute: true }));
    if(issue!=='readback')assert.deepEqual(f.writes, []);
    else assert.equal(f.writes.includes('lark'), false);
    assert.equal(f.locks.at(-1),'release');
  }
});
test('write gate, stored owner and stored key conflicts fail before any mutation', async () => {
  const f=fixture(); await assert.rejects(runTikTokAdsMasterSync({ ...f.input, execute: true, writeEnabled: false }));
  assert.deepEqual(f.locks, []);
  f.rows.push({ entity_key: 'wrong', customer_key: 'other', source_account_id: '999' });
  await assert.rejects(runTikTokAdsMasterSync({ ...f.input, execute: true }));
  assert.deepEqual(f.writes, []);
});


test('scoped snapshot preserves Rich text keys and rejects foreign destination owner before writes', async () => {
  const f=fixture(); let foreign=false;
  f.input.syncEngine=new TableSyncEngine();
  f.input.repository={
    async searchRecords(tableId, query) {
      assert.equal(query.filter.conditions[0].operator,'contains');
      assert.match(query.filter.conditions[0].value[0], /^tiktok_ads:123:/);
      if(tableId!=='campaigns')return [];
      return [{recordId:'record',fields:{ads_campaign_key:[{text:'tiktok_ads:123:campaign:10'}],
        platform:'tiktok_ads',account_id:foreign?'999':'123',external_campaign_id:'10',
        campaign_name:'Example',status:'active',ad_channel:'tiktok_ads'}}];
    },
    async prepareRows(tableId,rows){return rows.map(row=>Object.fromEntries(Object.entries(row).filter(([,value])=>value!=null)));},
    async prepareExistingRecords(tableId,records){return records.map(record=>({...record,fields:{...record.fields,
      ...(tableId==='campaigns'?{ads_campaign_key:record.fields.ads_campaign_key[0].text}:{})}}));},
    async createMany(){throw Error('preview must not write');},async updateMany(){throw Error('preview must not write');},
  };
  const preview=await runTikTokAdsMasterSync(f.input);
  assert.equal(preview.tables.find(table=>table.dataset==='campaigns').created,0);
  assert.equal(preview.tables.find(table=>table.dataset==='campaigns').skipped,1);
  foreign=true;
  await assert.rejects(runTikTokAdsMasterSync(f.input),{code:'TIKTOK_ADS_MASTER_LARK_STORED_IDENTITY_CONFLICT'});
  assert.deepEqual(f.writes,[]);
});
