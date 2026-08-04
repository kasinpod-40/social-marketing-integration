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

test('Meta Ads Lark projection is Account plus July activity Campaign, AdSet and Ad only', () => {
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
  const serialized = JSON.stringify(contracts);
  assert.equal(serialized.includes('raw.ads'), false);
  assert.equal(serialized.includes('adsCreatives'), false);
  assert.equal(serialized.includes('adsDaily'), false);
});

test('active Meta Lark inventory contains no Meta Ads RAW, Creative or detailed daily table', () => {
  const tableKeys = META_END_TO_END_LARK_TABLES.map((entry) => entry.tableKey);
  assert.equal(tableKeys.includes('rawAdsEntities'), false);
  assert.equal(tableKeys.includes('rawAdsDaily'), false);
  assert.equal(tableKeys.includes('mktAdsCreatives'), false);
  assert.equal(tableKeys.includes('mktAdsDaily'), false);
  assert.deepEqual(
    tableKeys.filter((key) => key.startsWith('mktAds')),
    META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  );
  assert.equal(META_END_TO_END_REQUIRED_LARK_TABLE_KEYS.length, 11);
});

test('Organic Lark projection remains unchanged', () => {
  for (const connectorKey of ['facebook', 'instagram']) {
    assert.deepEqual(
      expectedLarkContracts(connectorKey).map((entry) => entry.tableKey),
      [
        'rawMetaOrganicAccounts',
        'rawMetaOrganicContent',
        'rawMetaOrganicMetrics',
        'mktAccounts',
        'mktAccountDaily',
        'mktContent',
        'mktContentDaily',
      ],
    );
  }
});
