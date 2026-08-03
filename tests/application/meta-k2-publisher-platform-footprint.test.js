import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  summarizeMetaK2PublisherPlatformFootprint,
} from '../../scripts/lib/meta-k2-publisher-platform-footprint.js';

function unit(rows, datasetKey = 'meta_ads.performance.daily') {
  return {
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey,
    rows,
  };
}

test('summarizes exact publisher platform row counts without source identities', () => {
  const footprint = summarizeMetaK2PublisherPlatformFootprint([
    unit([{ publisher_platform: 'facebook', ad_id: 'ad_secret_1' }]),
    unit([
      { publisher_platform: ' Instagram ', campaign_id: 'campaign_secret_1' },
      { publisher_platform: 'audience_network', adset_id: 'adset_secret_1' },
      { publisher_platform: 'messenger' },
      { publisher_platform: 'threads' },
      { publisher_platform: 'facebook' },
    ]),
    unit([{ account_id: 'account_secret_1' }], 'meta_ads.account.latest'),
  ]);

  assert.deepEqual(footprint, {
    datasetKey: 'meta_ads.performance.daily',
    dailyUnitCount: 2,
    dailyRowCount: 6,
    observedRowCount: 6,
    missingRowCount: 0,
    invalidRowCount: 0,
    platforms: [
      { publisherPlatform: 'audience_network', rowCount: 1 },
      { publisherPlatform: 'facebook', rowCount: 2 },
      { publisherPlatform: 'instagram', rowCount: 1 },
      { publisherPlatform: 'messenger', rowCount: 1 },
      { publisherPlatform: 'threads', rowCount: 1 },
    ],
    invalidValueFingerprints: [],
  });
  const serialized = JSON.stringify(footprint);
  assert.equal(serialized.includes('ad_secret_1'), false);
  assert.equal(serialized.includes('campaign_secret_1'), false);
  assert.equal(serialized.includes('adset_secret_1'), false);
  assert.equal(serialized.includes('account_secret_1'), false);
});

test('counts missing values and fingerprints malformed values without printing them', () => {
  const footprint = summarizeMetaK2PublisherPlatformFootprint([
    unit([
      {},
      { publisher_platform: null },
      { publisher_platform: 'face book private value' },
      { publisher_platform: { unexpected: 'private object value' } },
    ]),
  ]);

  assert.equal(footprint.dailyRowCount, 4);
  assert.equal(footprint.observedRowCount, 0);
  assert.equal(footprint.missingRowCount, 2);
  assert.equal(footprint.invalidRowCount, 2);
  assert.equal(footprint.invalidValueFingerprints.length, 2);
  assert.match(footprint.invalidValueFingerprints[0].sha256, /^[0-9a-f]{64}$/u);
  const serialized = JSON.stringify(footprint);
  assert.equal(serialized.includes('face book private value'), false);
  assert.equal(serialized.includes('private object value'), false);
});

test('operator is D1 read-only and cannot authorize recovery or Worker mutations', async () => {
  const source = await readFile(
    new URL('../../scripts/meta-k2-publisher-platform-footprint-audit.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /'--remote', '--json'/u);
  assert.match(source, /PRAGMA table_info/u);
  assert.match(source, /SELECT state_json, complete/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
  assert.doesNotMatch(source, /method:\s*'POST'/u);
  assert.doesNotMatch(source, /'wrangler',\s*'deploy'/u);
  assert.doesNotMatch(source, /'versions',\s*'upload'/u);
  assert.doesNotMatch(source, /queue.*send/iu);
  assert.match(source, /rawPayloadPrinted:\s*false/u);
  assert.match(source, /identityPrinted:\s*false/u);
  assert.match(source, /recoveryAuthorized:\s*false/u);
  assert.match(source, /remoteMutationCount:\s*0/u);
});
