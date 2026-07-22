export function createGoogleAdsDeliveryEnvelope(overrides = {}) {
  const base = {
    schemaVersion: 'google_ads_signed_delivery_v1',
    deliveryId: '123e4567-e89b-42d3-a456-426614174000',
    mode: 'LIVE',
    managerCustomerId: '9463570541',
    customerId: '5662332033',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    fetchedAt: '2026-07-22T12:00:00.000Z',
    sourceTimezone: 'Asia/Bangkok',
    datasetCounts: {
      account: 1,
      campaigns: 1,
      adGroups: 1,
      ads: 1,
      youtubeAssets: 1,
      campaignDailyMetrics: 1,
    },
    datasets: {
      account: {
        customerId: '5662332033',
        descriptiveName: 'Chemistry K Ads',
        currencyCode: 'THB',
        timeZone: 'Asia/Bangkok',
        status: 'ENABLED',
        isManager: false,
        isTestAccount: false,
        resourceName: 'customers/5662332033',
      },
      campaigns: [{
        campaignId: '1001',
        campaignName: 'YouTube May',
        status: 'PAUSED',
        primaryStatus: 'ELIGIBLE',
        servingStatus: 'SERVING',
        advertisingChannelType: 'VIDEO',
        advertisingChannelSubType: 'VIDEO_ACTION',
        startDate: null,
        endDate: null,
        biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
        campaignBudgetId: '2001',
        campaignBudgetResourceName: 'customers/5662332033/campaignBudgets/2001',
        resourceName: 'customers/5662332033/campaigns/1001',
      }],
      adGroups: [{
        adGroupId: '3001', campaignId: '1001', adGroupName: 'Video group',
        status: 'PAUSED', primaryStatus: null, type: 'VIDEO_TRUE_VIEW_IN_STREAM',
        resourceName: 'customers/5662332033/adGroups/3001',
      }],
      ads: [{
        adId: '4001', adGroupId: '3001', campaignId: '1001', adName: 'Video ad',
        status: 'PAUSED', primaryStatus: null, type: 'VIDEO_AD',
        finalUrls: null, displayUrl: null,
        resourceName: 'customers/5662332033/adGroupAds/3001~4001',
      }],
      youtubeAssets: [{
        assetId: '5001', assetName: 'YouTube creative', status: null,
        assetType: 'YOUTUBE_VIDEO', youtubeVideoId: 'abc123xyz89',
        youtubeVideoTitle: null,
        resourceName: 'customers/5662332033/assets/5001',
      }],
      campaignDailyMetrics: [{
        metricDate: '2025-05-16', reportLevel: 'campaign', externalEntityId: '1001',
        campaignId: '1001', adGroupId: null, adId: null,
        advertisingChannelType: 'VIDEO', advertisingChannelSubType: 'VIDEO_ACTION',
        adChannel: 'youtube_ads', segmentKey: 'all', currency: 'THB',
        spendMicros: 689230000, impressions: 27178, clicks: 145, conversions: 0,
        conversionValueMicros: 0, videoViews: 22306, videoViewRate: 0.8207,
        averageCpvMicros: 30900,
      }],
    },
  };
  return deepMerge(base, overrides);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return overrides ?? base;
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      output[key] = deepMerge(base[key], value);
    } else output[key] = value;
  }
  return output;
}
