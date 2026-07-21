// Generated from Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx.
// Sanitized schema metadata only; no account IDs, credentials, tokens, or billing data.

export const GOOGLE_ADS_RAW_SCHEMA_DATA_2 = [
  {
    "key": "rawGoogleAdsCampaigns",
    "logicalName": "RAW_Google_Ads_Campaigns",
    "purpose": "Campaign inventory/configuration",
    "primaryField": "raw_campaign_key",
    "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_campaign_key", "Text", true, false, "Primary + Stable key", "google_ads:{customer_id}:campaign:{campaign_id}", "Stable raw Campaign key", null],
      ["ads_campaign_key", "Text", true, false, "Canonical stable key", "google_ads:{customer_id}:campaign:{campaign_id}", "Key parity with MKT_Ads_Campaigns", null],
      ["customer_id", "Text", true, false, "Identity component", "customer context", "Account identity", null],
      ["campaign_id", "Text", true, false, "Identity component", "campaign.id", "Campaign identity", null],
      ["campaign_name", "Text", false, true, "Not a key", "campaign.name", "Campaign display name", null],
      ["status", "Text", false, true, "Source state", "campaign.status", "Exact source enum", null],
      ["primary_status", "Text", false, true, "Source state", "campaign.primary_status", "Serving-oriented primary status", null],
      ["serving_status", "Text", false, true, "Source state", "campaign.serving_status", "Serving status enum", null],
      ["advertising_channel_type", "Text", true, false, "Channel mapping", "campaign.advertising_channel_type", "Top-level Google channel enum", null],
      ["advertising_channel_sub_type", "Text", false, true, "Channel mapping", "campaign.advertising_channel_sub_type", "Campaign subtype", null],
      ["start_date", "DateTime", false, true, "Lifecycle", "campaign.start_date", "Account-timezone calendar date", "yyyy-mm-dd"],
      ["end_date", "DateTime", false, true, "Lifecycle", "campaign.end_date", "Account-timezone calendar date", "yyyy-mm-dd"],
      ["bidding_strategy_type", "Text", false, true, "Configuration", "campaign.bidding_strategy_type", "Bidding strategy enum", null],
      ["campaign_budget_id", "Text", false, true, "Relation identity", "Parsed from campaign.campaign_budget resource", "Budget identity", null],
      ["campaign_budget_resource_name", "Text", false, true, "Source relation", "campaign.campaign_budget", "Budget resource link", null],
      ["resource_name", "Text", false, true, "Source identifier", "campaign.resource_name", "Google resource name", null],
      ["fetched_at", "DateTime", true, false, "Operational metadata", "Script clock", "UTC fetch timestamp", "yyyy-mm-dd"],
      ["last_seen_at", "DateTime", true, false, "Reconciliation metadata", "Script clock when observed", "Last source observation", "yyyy-mm-dd"],
      ["source_payload_json", "Text", false, true, "Audit payload", "Sanitized campaign row", "Audit payload", null]
    ]
  },
  {
    "key": "rawGoogleAdsAdGroups",
    "logicalName": "RAW_Google_Ads_Ad_Groups",
    "purpose": "Ad group inventory/configuration",
    "primaryField": "raw_ad_group_key",
    "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_ad_group_key", "Text", true, false, "Primary + Stable key", "google_ads:{customer_id}:ad_group:{ad_group_id}", "Stable raw Ad Group key", null],
      ["ads_ad_group_key", "Text", true, false, "Canonical stable key", "google_ads:{customer_id}:ad_group:{ad_group_id}", "Key parity with MKT_Ads_AdGroups", null],
      ["customer_id", "Text", true, false, "Identity component", "customer context", "Account identity", null],
      ["campaign_id", "Text", true, false, "Parent identity", "campaign.id", "Parent Campaign", null],
      ["ad_group_id", "Text", true, false, "Identity component", "ad_group.id", "Ad Group identity", null],
      ["ad_group_name", "Text", false, true, "Not a key", "ad_group.name", "Display name", null],
      ["status", "Text", false, true, "Source state", "ad_group.status", "Exact source enum", null],
      ["primary_status", "Text", false, true, "Source state", "ad_group.primary_status", "Serving-oriented status", null],
      ["ad_group_type", "Text", false, true, "Configuration", "ad_group.type", "Google Ad Group type", null],
      ["resource_name", "Text", false, true, "Source identifier", "ad_group.resource_name", "Google resource name", null],
      ["fetched_at", "DateTime", true, false, "Operational metadata", "Script clock", "UTC fetch timestamp", "yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at", "DateTime", true, false, "Reconciliation metadata", "Script clock when observed", "Last source observation", "yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json", "Text", false, true, "Audit payload", "Sanitized ad_group row", "Audit payload", null]
    ]
  }
];
