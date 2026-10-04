import test from 'node:test';
import assert from 'node:assert/strict';
import { proveTikTokAdsDailyGrains } from '../../packages/application/src/tiktok-ads/prove-tiktok-ads-daily-grains.js';
const date = '2026-10-02';
function fixture() {
  const masters = [
    { entity_type: 'campaign', external_entity_id: '11', source_account_id: '123' },
    { entity_type: 'ad_group', external_entity_id: '22', source_account_id: '123', parent_campaign_id: '11' },
    { entity_type: 'ad', external_entity_id: '33', source_account_id: '123', parent_campaign_id: '11', parent_ad_group_id: '22' },
  ];
  const rows = { campaign: [{ dimensions: { campaign_id: '11', stat_time_day: date },
    metrics: { spend: '1.23', impressions: '7', clicks: '2' } }],
  ad: [{ dimensions: { ad_id_v2: '33', stat_time_day: `${date} 00:00:00` },
    metrics: { spend: '1.23', impressions: '7', clicks: '2' } }] };
  const calls = [];
  return { rows, masters, calls, input: { advertiserId: '123', customerKey: 'customer', accountKey: 'customer',
    accessToken: 'private-token', date,
    client: { async listAllStatusDailyReport(input) { calls.push(input);
      return { rows: rows[input.grain], totalCount: rows[input.grain].length, pageCount: 1 }; } },
    db: { prepare(sql) { assert.match(sql, /^SELECT/u); return { bind(...args) {
      assert.deepEqual(args, ['customer', 'customer']); return { async all() { return { results: masters }; } }; } }; } },
  } };
}
test('full daily proof reconciles true Ad identities/parents and independent base totals with no writes or disclosure', async () => {
  const f = fixture(); const result = await proveTikTokAdsDailyGrains(f.input);
  assert.equal(result.identityReconciled, true);
  assert.deepEqual(result.totalsMatch, { spend: true, impressions: true, clicks: true });
  assert.deepEqual(f.calls.map(row => row.grain), ['campaign', 'ad']);
  assert.doesNotMatch(JSON.stringify(result), /private|1.23|customer|\b33\b/);
});
test('proof records partial identity/metric mismatch without asserting reconciliation', async () => {
  const f = fixture(); f.masters.pop(); f.rows.ad[0].metrics.clicks = '1';
  const result = await proveTikTokAdsDailyGrains(f.input);
  assert.equal(result.identityReconciled, false); assert.equal(result.grains.ad.missingMasters, 1);
  assert.equal(result.totalsMatch.clicks, false); assert.equal(result.totalsMatch.spend, true);
});
test('proof refuses malformed/duplicate/wrong-day/noninteger and foreign source data', async () => {
  for (const mutate of [f => f.rows.ad.push(f.rows.ad[0]),
    f => f.rows.ad[0].dimensions.stat_time_day = '2026-10-01',
    f => f.rows.ad[0].metrics.impressions = '1.5',
    f => f.masters[0].source_account_id = '999',
    f => f.masters.push(f.masters[0])]) {
    const f = fixture(); mutate(f); await assert.rejects(proveTikTokAdsDailyGrains(f.input));
  }
});
test('empty complete source confirms zero rows independently of retained masters', async () => {
  const f = fixture(); f.rows.campaign.length = 0; f.rows.ad.length = 0;
  const result = await proveTikTokAdsDailyGrains(f.input);
  assert.equal(result.identityReconciled, true); assert.equal(result.grains.ad.rows, 0);
  assert.deepEqual(result.totalsMatch, { spend: true, impressions: true, clicks: true });
});
