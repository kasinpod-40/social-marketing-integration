import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokAdsReportHttpHandler } from '../../apps/sync-worker/src/tiktok-ads-report-http.js';
function fixture() {
  const calls = []; let rate = 1;
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ active_locks: 0 }) }) }) };
  const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private', MKT_STATE_DB: db,
    MKT_TIKTOK_ADS_REPORT_WRITE_ENABLED: 'true' };
  const handler = createTikTokAdsReportHttpHandler({ hydrate: async raw => raw, now: () => Date.parse('2026-10-04T00:00:00Z'),
    createRuntime: () => ({ config: { environment: 'production', customerProfile: 'chemistry_k', customerKey: 'chemistry_k' },
      store: { findConnectionByCustomerConnector: async () => ({ connectionStatus: 'connected', accessStatus: 'validated',
        credentialReference: 'private-reference', connectionId: 'private-connection', externalAccountId: '123',
        providerMetadata: { timezone: 'Asia/Bangkok' } }) }, credentials: { read: async () => { calls.push('decrypt'); return 'private-token'; } } }),
    loadAdsConfig: () => ({}), createClient: () => ({}),
    createRegistry: () => ({ get: () => ({ adapter: { load: async input => { calls.push(['read',input]);
      return { metrics: { coverage_rate: rate, spend_micros: 12340000, conversions: 0, reach: null },
        topAds: [{ external_ad_id: 'private-ad' }], readSummary: { rankingCoverageRate: rate, topAdsAvailability: 'available',
          summaryFactRows: 1, sourceWatermark: 'private-watermark' } }; } } }) }),
    processJob: async input => { calls.push(['write',input.job]); return { dataStatus: 'revisable',
      lark: { rows: { snapshots: 1, metrics: 14, topAds: 1 }, results: { snapshots: { created: 1, updated: 0, skipped: 0 } },
        readback: { reconciled: true } }, ai: { status: 'disabled' } }; },
    loadRuntime: () => ({}), createInfrastructure: () => ({}),
  });
  const run = (method = 'GET', query = 'days=3&date=2026-10-03', overrides = {}) => {
    const url = new URL('https://worker.example/operator/tiktok-ads/report?' + query);
    return handler({ url, env: { ...env,...overrides }, request: new Request(url, { method,
      headers: { authorization: 'Bearer operator-private' } }) });
  };
  return { calls, run, setRate(value) { rate = value; } };
}
test('Report GET validates both periods and returns only counts/availability without writes or identities', async () => {
  const f = fixture(); const response = await f.run(); assert.equal(response.status,200);
  const body = await response.json(); assert.equal(body.proof.currentMetricsAvailable.conversions,true);
  assert.equal(body.proof.currentMetricsAvailable.reach,false);
  assert.doesNotMatch(JSON.stringify(body), /private|12340000|chemistry_k/);
  const reads = f.calls.filter(value => Array.isArray(value));
  assert.deepEqual(reads.map(value => [value[1].periodStart,value[1].periodEnd]),
    [['2026-10-01','2026-10-03'],['2026-09-28','2026-09-30']]);
  assert.equal(f.calls.some(value => value[0] === 'write'),false);
});
test('Report POST requires separate gate and complete Campaign/Ad Coverage before shared processor', async () => {
  const f = fixture();
  assert.equal((await f.run('POST',undefined,{ MKT_TIKTOK_ADS_REPORT_WRITE_ENABLED:'false' })).status,409);
  assert.equal(f.calls.some(value => value[0] === 'read'),false);
  f.setRate(0.5); const failed = await f.run('POST'); assert.equal(failed.status,502);
  assert.equal((await failed.json()).code,'TIKTOK_ADS_REPORT_COVERAGE_INCOMPLETE');
  assert.equal(f.calls.some(value => value[0] === 'write'),false);
  f.setRate(1); const response = await f.run('POST'); assert.equal(response.status,200);
  assert.equal((await response.json()).result.readback.reconciled,true);
  const write = f.calls.find(value => value[0] === 'write')[1];
  assert.equal(write.body.platformScope,'tiktok_ads'); assert.equal(write.body.windowDays,3);
});
test('Report unknown windows/extra identity fail before decryption and open day cannot write', async () => {
  const f = fixture();
  for (const query of ['days=2&date=2026-10-03','days=3&date=2026-10-03&advertiser=999']) {
    assert.equal((await f.run('POST',query)).status,400);
  }
  assert.deepEqual(f.calls,[]);
  assert.equal((await f.run('POST','days=3&date=2026-10-04')).status,502);
  assert.equal(f.calls.some(value => value[0] === 'write'),false);
});
