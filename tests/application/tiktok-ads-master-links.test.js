import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTikTokAdsMasterLinks } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-master-sync.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { normalizeExistingRecordsForComparison, serializeRowsForLark } from '../../packages/connectors/src/lark/lark-field-serializer.js';

function fixture() {
  const advertiserId = '123';
  const key = (type, id) => `tiktok_ads:${advertiserId}:${type}:${id}`;
  const tables = { mktAdsCampaigns: 'campaigns', mktAdsAdGroups: 'groups', mktAdsAds: 'ads', mktAdsCreatives: 'creatives' };
  const definitions = {
    campaigns: ['ads_campaign_key'], groups: ['ads_ad_group_key', 'campaign_link'],
    ads: ['ads_ad_key', 'ad_group_link', 'creative_links'], creatives: ['ads_creative_key'],
  };
  const fields = Object.fromEntries(Object.entries(definitions).map(([table, names]) => [table,
    [...names.map(fieldName => ({ fieldName, type: fieldName.endsWith('_link') || fieldName.endsWith('_links') ? 18 : 1 })),
      { fieldName: 'platform', type: 3 }, { fieldName: 'account_id', type: 1 }]]));
  const records = new Map(Object.entries({
    campaigns: [{ recordId: 'recCampaign', fields: { ads_campaign_key: key('campaign', '10'), platform: 'tiktok_ads', account_id: advertiserId } }],
    groups: [{ recordId: 'recGroup', fields: { ads_ad_group_key: key('ad_group', '20'), platform: 'tiktok_ads', account_id: advertiserId } }],
    ads: [{ recordId: 'recAd', fields: { ads_ad_key: key('ad', '30'), platform: 'tiktok_ads', account_id: advertiserId } }],
    creatives: [
      { recordId: 'recCreativeA', fields: { ads_creative_key: key('creative', '40'), platform: 'tiktok_ads', account_id: advertiserId } },
      { recordId: 'recCreativeB', fields: { ads_creative_key: key('creative', '41'), platform: 'tiktok_ads', account_id: advertiserId } },
    ],
  }));
  const writes = [];
  const repository = {
    async searchRecords(table) { return records.get(table); },
    async listByFieldValues(table, keyField, values) { return records.get(table).filter(record => values.includes(record.fields[keyField])); },
    async getTableFields(table) { return fields[table]; },
    async prepareRows(table, rows, context) { return serializeRowsForLark(rows, fields[table], { tableId: table, keyField: context.keyField }); },
    async prepareExistingRecords(table, rows, context) { return normalizeExistingRecordsForComparison(rows, fields[table],
      { tableId: table, incomingFieldNames: context.incomingFieldNames }); },
    async createMany() { throw new Error('Links must not create records'); },
    async updateMany(table, rows) { for (const row of rows) {
      Object.assign(records.get(table).find(record => record.recordId === row.recordId).fields, row.fields);
      writes.push(table);
    } return { updated: rows.length }; },
  };
  const snapshot = { canonical: {
    campaigns: [{ ads_campaign_key: key('campaign', '10'), external_campaign_id: '10' }],
    adGroups: [{ ads_ad_group_key: key('ad_group', '20'), external_ad_group_id: '20', external_campaign_id: '10' }],
    ads: [{ ads_ad_key: key('ad', '30'), external_ad_id: '30', external_ad_group_id: '20', external_creative_id: null }],
    creatives: [{ ads_creative_key: key('creative', '40'), external_creative_id: '40' },
      { ads_creative_key: key('creative', '41'), external_creative_id: '41' }],
  }, entities: [
    { entity_type: 'creative', external_entity_id: '40', parent_ad_id: '30' },
    { entity_type: 'creative', external_entity_id: '41', parent_ad_id: '30' },
  ] };
  return { advertiserId, tables, repository, syncEngine: new TableSyncEngine(), snapshot,
    beforeWriteChunk: async () => {}, records, writes };
}

test('links campaign to group, group to Ad, and every proved Smart+ Creative; replay is stable', async () => {
  const f = fixture();
  const first = await reconcileTikTokAdsMasterLinks(f);
  assert.deepEqual(first, { adGroups: 1, ads: 1, creativeLinks: 1, updated: 2 });
  assert.deepEqual(f.records.get('groups')[0].fields.campaign_link, { link_record_ids: ['recCampaign'] });
  assert.deepEqual(f.records.get('ads')[0].fields.ad_group_link, { link_record_ids: ['recGroup'] });
  assert.deepEqual(f.records.get('ads')[0].fields.creative_links, { link_record_ids: ['recCreativeA', 'recCreativeB'] });
  const replay = await reconcileTikTokAdsMasterLinks(f);
  assert.equal(replay.updated, 0);
  assert.equal(f.writes.length, 2);
});

test('missing or foreign relation target fails before any link writes', async () => {
  for (const change of [f => f.records.get('creatives').pop(), f => { f.records.get('campaigns')[0].fields.account_id = 'foreign'; }]) {
    const f = fixture(); change(f);
    await assert.rejects(reconcileTikTokAdsMasterLinks(f));
    assert.deepEqual(f.writes, []);
  }
});

test('removes stale Creative association when current source no longer proves that Ad relation', async () => {
  const f = fixture();
  await reconcileTikTokAdsMasterLinks(f);
  f.snapshot.entities = [];
  const result = await reconcileTikTokAdsMasterLinks(f);
  assert.equal(result.creativeLinks, 0);
  assert.equal(result.updated, 1);
  assert.deepEqual(f.records.get('ads')[0].fields.creative_links, { link_record_ids: [] });
  assert.equal((await reconcileTikTokAdsMasterLinks(f)).updated, 0);
});
