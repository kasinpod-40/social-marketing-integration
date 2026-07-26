import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleGoogleAdsLiveRun,
  buildGoogleAdsD1WriteSet,
  buildGoogleAdsLarkWriteSet,
} from '../../packages/application/src/google-ads/google-ads-live-run.js';
import {
  createGoogleAdsDeliveryEnvelope,
  createGoogleAdsDeliveryManifest,
  googleAdsDatasetRows,
} from '../helpers/google-ads-manager-delivery-fixture.js';

const NOW = Date.parse('2026-07-25T04:05:00.000Z');
const BANGKOK_METRIC_DATE_EPOCH = Date.parse('2026-07-23T17:00:00.000Z');

function liveEnvelopes() {
  const manifest = createGoogleAdsDeliveryManifest(Object.fromEntries([
    'campaigns', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics',
  ].map((key) => [key, { totalRows: 1, chunkCount: 1 }])));
  return ['account', 'campaigns', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics']
    .map((datasetKey) => createGoogleAdsDeliveryEnvelope({
      mode: 'LIVE',
      datasetKey,
      rows: googleAdsDatasetRows(datasetKey),
      manifest,
    }));
}

test('LIVE assembler preserves six exact datasets and rejects PREVIEW', () => {
  const run = assembleGoogleAdsLiveRun(liveEnvelopes().toReversed());
  assert.equal(run.mode, 'LIVE');
  assert.equal(run.summary.expectedChunkCount, 6);
  assert.equal(run.summary.expectedRowCount, 6);
  assert.equal(run.datasets.campaigns[0].campaignId, '10');

  const preview = liveEnvelopes().map((envelope) => ({ ...envelope, mode: 'PREVIEW' }));
  assert.throws(
    () => assembleGoogleAdsLiveRun(preview),
    (error) => error.code === 'GOOGLE_ADS_PREVIEW_QUEUE_FORBIDDEN',
  );
});

test('D1 write set uses Storage keys, date-only facts, null semantics and complete Coverage', async () => {
  const run = assembleGoogleAdsLiveRun(liveEnvelopes());
  const writeSet = await buildGoogleAdsD1WriteSet({
    run,
    syncRunId: 'sync-google-ads-1',
    now: NOW,
  });
  assert.equal(writeSet.entities.length, 5);
  assert.equal(writeSet.dailyFacts.length, 1);
  assert.equal(writeSet.conversionFacts.length, 0);
  assert.equal(writeSet.coverageRuns.length, 6);
  assert.equal(writeSet.coverageEntities.length, 6);
  assert.equal(writeSet.entities[0].entity_key, 'google_ads:fixture_account:account:2222222222');
  assert.equal(writeSet.dailyFacts[0].ads_fact_key, 'google_ads:fixture_account:campaign:10:2026-07-24:all:all');
  assert.equal(writeSet.dailyFacts[0].metric_date, '2026-07-24');
  assert.equal(writeSet.dailyFacts[0].reach, null);
  assert.equal(writeSet.dailyFacts[0].video_views, 0);
  assert.equal(writeSet.dailyFacts[0].data_status, 'revisable');
  assert.equal(writeSet.coverageRuns.every((row) => row.status === 'complete'), true);
});

test('Lark write set converts metric date to source-timezone midnight without changing stable keys', () => {
  const run = assembleGoogleAdsLiveRun(liveEnvelopes());
  const writeSet = buildGoogleAdsLarkWriteSet({ run, syncRunId: 'sync-google-ads-1' });
  assert.equal(writeSet.raw.entities.length, 5);
  assert.equal(writeSet.raw.daily.length, 1);
  assert.equal(writeSet.canonical.accounts.length, 1);
  assert.equal(writeSet.canonical.campaigns[0].campaign_key, 'google_ads:2222222222:campaign:10');
  assert.equal(
    writeSet.raw.daily[0].raw_ads_daily_key,
    'google_ads:2222222222:campaign:10:2026-07-24:all:all',
  );
  assert.equal(writeSet.raw.daily[0].metric_date, BANGKOK_METRIC_DATE_EPOCH);
  assert.equal(writeSet.canonical.daily[0].ads_daily_key, 'google_ads:2222222222:campaign:10:2026-07-24');
  assert.equal(writeSet.canonical.daily[0].metric_date, BANGKOK_METRIC_DATE_EPOCH);
  assert.equal(JSON.parse(writeSet.raw.daily[0].source_payload_json).metricDate, '2026-07-24');
  assert.equal(JSON.stringify(writeSet).includes('RAW_Google'), false);
  assert.equal(JSON.stringify(writeSet).includes('refresh_token'), false);
});
