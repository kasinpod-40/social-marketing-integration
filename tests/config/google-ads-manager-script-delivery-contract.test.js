import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_ADS_MANAGER_DATASET_KEYS,
  createGoogleAdsManagerIdempotencyKey,
  validateGoogleAdsManagerDeliveryChunk,
  validateGoogleAdsManagerDeliveryRun,
} from '../../packages/config/src/google-ads-manager-script-delivery-contract.js';
import {
  GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
  GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
  createGoogleAdsDeliveryEnvelope,
  createGoogleAdsDeliveryManifest,
  googleAdsDatasetRows,
} from '../helpers/google-ads-manager-delivery-fixture.js';

for (const datasetKey of GOOGLE_ADS_MANAGER_DATASET_KEYS) {
  test(`validates exact ${datasetKey} chunk schema`, () => {
    const rows = googleAdsDatasetRows(datasetKey);
    const envelope = createGoogleAdsDeliveryEnvelope({
      datasetKey,
      rows,
      manifest: createGoogleAdsDeliveryManifest(
        datasetKey === 'account'
          ? {}
          : { [datasetKey]: { totalRows: rows.length, chunkCount: 1 } },
      ),
    });
    const validated = validateGoogleAdsManagerDeliveryChunk(envelope, {
      runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
      headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
    });
    assert.equal(validated.dataset.key, datasetKey);
    assert.equal(validated.dataset.rows.length, 1);
    assert.equal(Object.isFrozen(validated), true);
  });
}

test('builds deterministic request idempotency identity from run/dataset/chunk', () => {
  const envelope = createGoogleAdsDeliveryEnvelope();
  assert.equal(
    createGoogleAdsManagerIdempotencyKey(envelope),
    'google-ads:123e4567-e89b-42d3-a456-426614174000:account:0',
  );
});

test('rejects unknown envelope and row fields fail-closed', () => {
  const envelope = createGoogleAdsDeliveryEnvelope();
  assert.throws(
    () => validateGoogleAdsManagerDeliveryChunk({ ...envelope, unexpected: true }, {
      runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
      headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
    }),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
  );
  const row = { ...envelope.dataset.rows[0], token: 'must-not-exist' };
  assert.throws(
    () => validateGoogleAdsManagerDeliveryChunk({
      ...envelope,
      dataset: { ...envelope.dataset, rows: [row] },
    }, {
      runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
      headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
    }),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
  );
});

test('rejects identity, manifest and chunk mismatches', () => {
  const envelope = createGoogleAdsDeliveryEnvelope();
  for (const invalidEnvelope of [
    { ...envelope, customerId: '3333333333' },
    {
      ...envelope,
      manifest: { ...envelope.manifest, campaigns: { totalRows: 1, chunkCount: 0 } },
    },
    {
      ...envelope,
      dataset: { ...envelope.dataset, chunkIndex: 1 },
    },
  ]) {
    assert.throws(
      () => validateGoogleAdsManagerDeliveryChunk(invalidEnvelope, {
        runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
        headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
      }),
      (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
    );
  }
});

test('preserves explicit zero/null but rejects invalid metric semantics', () => {
  const rows = googleAdsDatasetRows('campaignDailyMetrics');
  assert.equal(rows[0].videoViews, 0);
  assert.equal(rows[0].adGroupId, null);
  const manifest = createGoogleAdsDeliveryManifest({
    campaignDailyMetrics: { totalRows: 1, chunkCount: 1 },
  });
  const base = createGoogleAdsDeliveryEnvelope({
    datasetKey: 'campaignDailyMetrics',
    rows,
    manifest,
  });
  const valid = validateGoogleAdsManagerDeliveryChunk(base, {
    runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
    headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
  });
  assert.equal(valid.dataset.rows[0].videoViews, 0);
  assert.equal(valid.dataset.rows[0].adGroupId, null);

  for (const patch of [
    { videoViews: -1 },
    { reach: 0 },
    { segmentKey: 'device:mobile' },
    { adChannel: 'youtube_ads' },
  ]) {
    assert.throws(
      () => validateGoogleAdsManagerDeliveryChunk({
        ...base,
        dataset: {
          ...base.dataset,
          rows: [{ ...rows[0], ...patch }],
        },
      }, {
        runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
        headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
      }),
      (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
    );
  }
});

test('rejects duplicates and unstable row ordering inside a chunk', () => {
  const first = googleAdsDatasetRows('campaigns')[0];
  const second = { ...first, campaignId: '2', campaignName: 'Campaign 2' };
  const manifest = createGoogleAdsDeliveryManifest({
    campaigns: { totalRows: 2, chunkCount: 1 },
  });
  const options = {
    datasetKey: 'campaigns',
    manifest,
    totalRows: 2,
  };
  for (const rows of [[first, { ...first }], [first, second]]) {
    assert.throws(
      () => validateGoogleAdsManagerDeliveryChunk(
        createGoogleAdsDeliveryEnvelope({ ...options, rows }),
        {
          runtimeIdentity: GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
          headerTimestampSeconds: GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
        },
      ),
      (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
    );
  }
});

test('validates complete cross-chunk relations, global ordering and counts', () => {
  const campaigns = [
    googleAdsDatasetRows('campaigns')[0],
    {
      ...googleAdsDatasetRows('campaigns')[0],
      campaignId: '11',
      campaignName: 'Campaign 11',
      resourceName: 'customers/2222222222/campaigns/11',
    },
  ];
  const manifest = createGoogleAdsDeliveryManifest({
    campaigns: { totalRows: 2, chunkCount: 2 },
  });
  const chunks = [
    createGoogleAdsDeliveryEnvelope({ manifest }),
    createGoogleAdsDeliveryEnvelope({
      datasetKey: 'campaigns',
      rows: [campaigns[0]],
      manifest,
      chunkIndex: 0,
      chunkCount: 2,
      totalRows: 2,
    }),
    createGoogleAdsDeliveryEnvelope({
      datasetKey: 'campaigns',
      rows: [campaigns[1]],
      manifest,
      chunkIndex: 1,
      chunkCount: 2,
      totalRows: 2,
    }),
  ];
  const result = validateGoogleAdsManagerDeliveryRun(chunks);
  assert.equal(result.expectedChunkCount, 3);
  assert.deepEqual(result.datasets.campaigns, { chunks: 2, rows: 2 });
});

test('rejects missing parent, cross-chunk duplicate and row-count mismatch', () => {
  const adGroup = googleAdsDatasetRows('adGroups')[0];
  const missingParentManifest = createGoogleAdsDeliveryManifest({
    adGroups: { totalRows: 1, chunkCount: 1 },
  });
  assert.throws(
    () => validateGoogleAdsManagerDeliveryRun([
      createGoogleAdsDeliveryEnvelope({ manifest: missingParentManifest }),
      createGoogleAdsDeliveryEnvelope({
        datasetKey: 'adGroups',
        rows: [adGroup],
        manifest: missingParentManifest,
      }),
    ]),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
  );

  const campaign = googleAdsDatasetRows('campaigns')[0];
  const duplicateManifest = createGoogleAdsDeliveryManifest({
    campaigns: { totalRows: 2, chunkCount: 2 },
  });
  assert.throws(
    () => validateGoogleAdsManagerDeliveryRun([
      createGoogleAdsDeliveryEnvelope({ manifest: duplicateManifest }),
      createGoogleAdsDeliveryEnvelope({
        datasetKey: 'campaigns',
        rows: [campaign],
        manifest: duplicateManifest,
        chunkIndex: 0,
        chunkCount: 2,
        totalRows: 2,
      }),
      createGoogleAdsDeliveryEnvelope({
        datasetKey: 'campaigns',
        rows: [campaign],
        manifest: duplicateManifest,
        chunkIndex: 1,
        chunkCount: 2,
        totalRows: 2,
      }),
    ]),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
  );
});
