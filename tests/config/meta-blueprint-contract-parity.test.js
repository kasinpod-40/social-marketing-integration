import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SOURCE_MODEL_URL = new URL(
  '../../packages/config/src/ads-data-model.js',
  import.meta.url,
);
const BLUEPRINT_CONTRACT_URL = new URL(
  '../../docs/meta-blueprint-v0.12.0.md',
  import.meta.url,
);

const EXPECTED_PRIMARY_KEYS = Object.freeze([
  'ads_account_key',
  'ads_campaign_key',
  'ads_ad_group_key',
  'ads_ad_key',
  'ads_creative_key',
  'ads_daily_key',
]);

test('Meta Blueprint canonical primary keys match the source Ads model', async () => {
  const [sourceModel, blueprintContract] = await Promise.all([
    readFile(SOURCE_MODEL_URL, 'utf8'),
    readFile(BLUEPRINT_CONTRACT_URL, 'utf8'),
  ]);

  for (const key of EXPECTED_PRIMARY_KEYS) {
    assert.match(sourceModel, new RegExp(`\\b${key}\\b`, 'u'));
    assert.match(blueprintContract, new RegExp(`\\b${key}\\b`, 'u'));
  }

  assert.doesNotMatch(blueprintContract, /MKT_Ads_Campaigns\.campaign_key/u);
  assert.doesNotMatch(blueprintContract, /MKT_Ads_AdGroups\.ad_group_key/u);
  assert.doesNotMatch(blueprintContract, /MKT_Ads_Ads\.ad_key/u);
  assert.doesNotMatch(blueprintContract, /MKT_Ads_Creatives\.creative_key/u);
  assert.match(blueprintContract, /external_creative_id/u);
});
