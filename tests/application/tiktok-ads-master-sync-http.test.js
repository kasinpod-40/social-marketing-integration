import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokAdsMasterSyncHttpHandler } from '../../apps/sync-worker/src/tiktok-ads-master-sync-http.js';
function fixture() {
  const calls=[];
  const handler=createTikTokAdsMasterSyncHttpHandler({ hydrate: async env=>{ calls.push('hydrate'); return env; },
    createRuntime:()=>({ config:{ environment:'production',customerProfile:'chemistry_k',customerKey:'chemistry_k' },
      store:{ async findConnectionByCustomerConnector(){ calls.push('connection');return { connectionId:'private',
        connectionStatus:'connected',accessStatus:'validated',credentialReference:'private',externalAccountId:'123',
        providerMetadata:{currency:'THB',timezone:'Asia/Bangkok'} }; } },
      credentials:{async read(){ calls.push('credential');return 'private'; } } }),
    loadAdsConfig:()=>({}),createClient:()=>({}),createLarkClient:()=>({}),
    run:async input=>{ calls.push('run'); assert.equal(input.advertiserId,'123');return {mode:input.execute?'execute':'preview'}; },
  });
  const env={MKT_CONNECTION_OPERATOR_TOKEN:'private', LARK_TABLE_MKT_ADS_ACCOUNTS:'a',LARK_TABLE_MKT_ADS_CAMPAIGNS:'b',
    LARK_TABLE_MKT_ADS_AD_GROUPS:'c',LARK_TABLE_MKT_ADS_ADS:'d',LARK_TABLE_MKT_ADS_CREATIVES:'e'};
  return {handler,calls,env};
}
test('master HTTP rejects unknown query/authorization before hydration and POST without write gate',async()=>{
  const f=fixture();
  for(const [query,token,status] of [['?advertiser=999','private',400],['','wrong',401]]) {
    const url=new URL('https://worker.example/operator/tiktok-ads/master-sync'+query);
    assert.equal((await f.handler({url,request:new Request(url,{headers:{authorization:'Bearer '+token}}),env:f.env})).status,status);
  }
  assert.deepEqual(f.calls,[]);
  const url=new URL('https://worker.example/operator/tiktok-ads/master-sync');
  const response=await f.handler({url,request:new Request(url,{method:'POST',headers:{authorization:'Bearer private'}}),env:f.env});
  assert.equal(response.status,409);
  assert.equal(f.calls.includes('run'),false);
});
