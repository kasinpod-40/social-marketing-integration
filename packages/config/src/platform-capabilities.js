export const PLATFORM_CAPABILITIES = Object.freeze({
  tiktok_organic: {
    source: 'lark_native_tiktok_for_creator',
    supportsVideoAnalytics: true,
    supportsDailyPerformance: false,
    notes: 'Use daily snapshot because native rows may be updated in place.',
  },
  tiktok_ads: {
    source: 'lark_native_master_plus_custom_reporting',
    supportsMasterData: true,
    supportsDailyPerformance: true,
    notes: 'Native master data, custom reporting API for performance.',
  },
  google_ads: {
    source: 'lark_native_campaign_customer_plus_custom_gaql',
    supportsMasterData: true,
    supportsDailyPerformance: true,
    notes: 'Native campaign/customer list only; GAQL required for performance.',
  },
});
