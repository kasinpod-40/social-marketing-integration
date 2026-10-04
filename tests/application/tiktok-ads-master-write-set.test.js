import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTikTokAdsMasterWriteSet } from '../../packages/application/src/tiktok-ads/tiktok-ads-master-write-set.js';
function fixture() {
  const row = (kind, id, extra = {}) => ({ kind, id, name: 'Example', status: 'ENABLE',
    campaignId: '10', adGroupId: '20', videoId: null, imageIds: [], ...extra });
  const rows = { campaign: [row('campaign', '10', { automationType: 'UPGRADED_SMART_PLUS' }),
    row('campaign', '11', { automationType: 'MANUAL', campaignId: '11' })],
  ad_group: [row('ad_group', '20'), row('ad_group', '21', { campaignId: '11' })],
  ad: [row('ad', '30', { videoId: 'video-one' }), row('ad', '31'),
    row('ad', '32', { campaignId: '11', adGroupId: '21', videoId: 'manual-video' })],
  smart_ad: [row('smart_ad', '40', { creativeItems: 2, creativeIds: ['30','31'] })] };
  return { advertiserId: '123', customerKey: 'demo', accountKey: 'demo', currency: 'THB', timezone: 'Asia/Bangkok',
    accountName: 'Example account', now: 100, syncRunId: 'run',
    inventories: Object.fromEntries(Object.entries(rows).map(([kind, items]) => [kind, { rows: items, totalCount: items.length }])) };
}
test('master snapshot partitions Ads/Creatives, keeps multi-asset reference null and source parents exact', async () => {
  const input = fixture();
  const result = await buildTikTokAdsMasterWriteSet(input);
  assert.equal(result.canonical.accounts.length, 1);
  assert.equal(result.canonical.ads.length, 2);
  assert.equal(result.canonical.creatives.length, 3);
  assert.equal(result.canonical.ads.find(row => row.external_ad_id === '40').external_creative_id, null);
  assert.equal(result.canonical.ads.find(row => row.external_ad_id === '32').external_creative_id, 'manual-video');
  assert.equal(result.entities.find(row => row.external_entity_id === '30').parent_ad_id, '40');
  assert.equal(result.entities.find(row => row.external_entity_id === '31').entity_type, 'creative');
  assert.equal(result.entities.find(row => row.external_entity_id === 'manual-video').parent_ad_id, null);
  const replay = await buildTikTokAdsMasterWriteSet({ ...input, now: 200, syncRunId: 'other' });
  assert.deepEqual(replay.entities.map(row => row.metadata_hash), result.entities.map(row => row.metadata_hash));
});
test('master refuses unknown automation, absent parents, shared creative ownership and duplicate identities', async () => {
  for (const mutate of [input => input.inventories.campaign.rows[0].automationType = 'FUTURE',
    input => input.inventories.ad.rows[0].adGroupId = '999',
    input => input.inventories.smart_ad.rows[0].creativeIds = ['999'],
    input => input.inventories.ad.rows[1].id = '30']) {
    const input = fixture(); mutate(input);
    await assert.rejects(buildTikTokAdsMasterWriteSet(input));
  }
});
test('missing creative identity is counted unavailable and never synthesized', async () => {
  const input = fixture(); input.inventories.smart_ad.rows[0].creativeIds = ['30'];
  const result = await buildTikTokAdsMasterWriteSet(input);
  assert.equal(result.unavailableCreativeIds, 1);
  assert.equal(result.canonical.ads.find(row => row.external_ad_id === '40').external_creative_id, null);
});
