import { stableSerialize } from '../../packages/shared/src/hash/stable-fingerprint.js';
import {
  createGoogleAdsManagerIdempotencyKey,
} from '../../packages/config/src/google-ads-manager-script-delivery-contract.js';
import {
  signGoogleAdsManagerDelivery,
} from '../../packages/application/src/google-ads/manager-script-signed-delivery-security.js';

export const GOOGLE_ADS_DELIVERY_FIXTURE_NOW = Date.parse('2026-07-25T04:00:02.000Z');
export const GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP = Math.trunc(
  GOOGLE_ADS_DELIVERY_FIXTURE_NOW / 1_000,
);
export const GOOGLE_ADS_DELIVERY_FIXTURE_SECRET =
  'fixture-google-ads-signing-secret-with-32-plus-bytes';
export const GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY = Object.freeze({
  managerCustomerId: '1111111111',
  customerId: '2222222222',
  customerKey: 'fixture_customer',
  accountKey: 'fixture_account',
  sourceTimezone: 'Asia/Bangkok',
});

const DATASET_ROWS = deepFreeze({
  account: [{
    customerId: '2222222222',
    descriptiveName: 'Fixture account',
    currencyCode: 'THB',
    timeZone: 'Asia/Bangkok',
    status: 'ENABLED',
    isManager: false,
    isTestAccount: false,
    resourceName: 'customers/2222222222',
  }],
  campaigns: [{
    campaignId: '10',
    campaignName: 'Campaign 10',
    status: 'ENABLED',
    primaryStatus: 'ELIGIBLE',
    servingStatus: 'SERVING',
    advertisingChannelType: 'SEARCH',
    advertisingChannelSubType: null,
    startDate: null,
    endDate: null,
    biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
    campaignBudgetId: '100',
    campaignBudgetResourceName: 'customers/2222222222/campaignBudgets/100',
    resourceName: 'customers/2222222222/campaigns/10',
  }],
  assetGroups: [{
    assetGroupId: '15',
    campaignId: '10',
    assetGroupName: 'Asset group 15',
    status: 'ENABLED',
    resourceName: 'customers/2222222222/assetGroups/15',
  }],
  adGroups: [{
    adGroupId: '20',
    campaignId: '10',
    adGroupName: 'Ad group 20',
    status: 'ENABLED',
    primaryStatus: 'ELIGIBLE',
    type: 'SEARCH_STANDARD',
    resourceName: 'customers/2222222222/adGroups/20',
  }],
  ads: [{
    adId: '30',
    adGroupId: '20',
    campaignId: '10',
    adName: 'Ad 30',
    status: 'ENABLED',
    primaryStatus: 'ELIGIBLE',
    type: 'RESPONSIVE_SEARCH_AD',
    finalUrls: ['https://example.test/landing'],
    displayUrl: 'example.test',
    resourceName: 'customers/2222222222/adGroupAds/20~30',
  }],
  youtubeAssets: [{
    assetId: '40',
    assetName: 'Video asset 40',
    status: 'ENABLED',
    assetType: 'YOUTUBE_VIDEO',
    youtubeVideoId: 'video_fixture_40',
    youtubeVideoTitle: 'Fixture video',
    resourceName: 'customers/2222222222/assets/40',
  }],
  campaignDailyMetrics: [{
    metricDate: '2026-07-24',
    reportLevel: 'campaign',
    externalEntityId: '10',
    campaignId: '10',
    adGroupId: null,
    adId: null,
    advertisingChannelType: 'SEARCH',
    advertisingChannelSubType: null,
    adChannel: 'google_search_ads',
    segmentKey: 'all',
    currency: 'THB',
    spendMicros: 1_000_000,
    impressions: 100,
    clicks: 10,
    conversions: 2.5,
    conversionValueMicros: 3_000_000,
    videoViews: 0,
    videoViewRate: 0,
    averageCpvMicros: 0,
  }],
});

export function googleAdsDatasetRows(datasetKey) {
  return structuredClone(DATASET_ROWS[datasetKey]);
}

export function createGoogleAdsDeliveryManifest(overrides = {}) {
  const manifest = {
    account: { totalRows: 1, chunkCount: 1 },
    campaigns: { totalRows: 0, chunkCount: 0 },
    assetGroups: { totalRows: 0, chunkCount: 0 },
    adGroups: { totalRows: 0, chunkCount: 0 },
    ads: { totalRows: 0, chunkCount: 0 },
    youtubeAssets: { totalRows: 0, chunkCount: 0 },
    campaignDailyMetrics: { totalRows: 0, chunkCount: 0 },
  };
  for (const [key, value] of Object.entries(overrides)) manifest[key] = { ...value };
  return manifest;
}

export function createGoogleAdsDeliveryEnvelope(options = {}) {
  const datasetKey = options.datasetKey ?? 'account';
  const rows = options.rows ?? googleAdsDatasetRows(datasetKey);
  const manifest = options.manifest ?? createGoogleAdsDeliveryManifest(
    datasetKey === 'account'
      ? {}
      : { [datasetKey]: { totalRows: rows.length, chunkCount: 1 } },
  );
  return {
    schemaVersion: 'google_ads_manager_script_signed_delivery_v1',
    runId: options.runId ?? '123e4567-e89b-42d3-a456-426614174000',
    mode: options.mode ?? 'PREVIEW',
    runStartedAt: options.runStartedAt ?? '2026-07-25T04:00:00.000Z',
    fetchedAt: options.fetchedAt ?? '2026-07-25T04:00:01.000Z',
    managerCustomerId: options.managerCustomerId ?? '1111111111',
    customerId: options.customerId ?? '2222222222',
    customerKey: options.customerKey ?? 'fixture_customer',
    accountKey: options.accountKey ?? 'fixture_account',
    sourceTimezone: options.sourceTimezone ?? 'Asia/Bangkok',
    manifest,
    dataset: {
      key: datasetKey,
      chunkIndex: options.chunkIndex ?? 0,
      chunkCount: options.chunkCount ?? manifest[datasetKey].chunkCount,
      totalRows: options.totalRows ?? manifest[datasetKey].totalRows,
      rows,
    },
  };
}

export async function createSignedGoogleAdsDeliveryRequest(options = {}) {
  const envelope = options.envelope ?? createGoogleAdsDeliveryEnvelope();
  const body = options.body ?? stableSerialize(envelope);
  const signed = await signGoogleAdsManagerDelivery({
    body,
    keyId: options.keyId ?? 'fixture-key-v1',
    secret: options.secret ?? GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
    timestamp: options.timestamp ?? GOOGLE_ADS_DELIVERY_FIXTURE_TIMESTAMP,
    nonce: options.nonce ?? 'abcdefghijklmnopqrstuv',
    idempotencyKey: options.idempotencyKey ?? createGoogleAdsManagerIdempotencyKey(envelope),
  });
  return {
    method: options.method ?? 'POST',
    url: options.url ?? 'https://ingress.example.test/v1/google-ads/manager-script/deliveries',
    body: options.requestBody ?? signed.body,
    headers: options.headers ?? signed.headers,
    now: options.now ?? GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    keyring: options.keyring ?? {
      current: {
        keyId: options.keyId ?? 'fixture-key-v1',
        secret: options.secret ?? GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
      },
    },
    runtimeIdentity: options.runtimeIdentity ?? GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
