import assert from 'node:assert/strict';
import test from 'node:test';
import {
  META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  META_END_TO_END_LARK_TABLES,
  META_END_TO_END_REQUIRED_LARK_TABLE_KEYS,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import {
  expectedLarkContracts,
} from '../../scripts/lib/meta-lark-parity-rollout-operator.js';

test('historical July Meta Ads rollout remains Account plus Campaign, AdSet and Ad only', () => {
  const contracts = expectedLarkContracts('meta_ads');
  assert.deepEqual(
    contracts.map((entry) => entry.tableKey),
    META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  );
  assert.deepEqual(
    contracts.map((entry) => entry.path),
    [
      'canonical.adsAccounts',
      'canonical.adsCampaigns',
      'canonical.adsAdGroups',
      'canonical.adsAds',
    ],
  );
});

test('active Meta Ads Lark inventory includes Creative and Daily without RAW tables', () => {
  const tableKeys = META_END_TO_END_LARK_TABLES.map((entry) => entry.tableKey);
  assert.equal(tableKeys.includes('rawAdsEntities'), false);
  assert.equal(tableKeys.includes('rawAdsDaily'), false);
  assert.deepEqual(
    tableKeys.filter((key) => key.startsWith('mktAds')),
    [
      'mktAdsAccounts',
      'mktAdsCampaigns',
      'mktAdsAdGroups',
      'mktAdsAds',
      'mktAdsCreatives',
      'mktAdsDaily',
    ],
  );
  assert.equal(META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.length, 10);
});

test('Organic Lark projection contains only customer-facing canonical tables', () => {
  for (const connectorKey of ['facebook', 'instagram']) {
    assert.deepEqual(
      expectedLarkContracts(connectorKey).map((entry) => entry.tableKey),
      [
        'mktAccounts',
        'mktAccountDaily',
        'mktContent',
        'mktContentDaily',
      ],
    );
  }
});
