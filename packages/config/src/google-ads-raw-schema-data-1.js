// Generated from Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx.
// Sanitized schema metadata only; no account IDs, credentials, tokens, or billing data.

export const GOOGLE_ADS_RAW_SCHEMA_DATA_1 = [
  {
    "key": "rawGoogleAdsAccountLinks",
    "logicalName": "RAW_Google_Ads_Account_Links",
    "purpose": "Manager → advertiser visibility/link state สำหรับ access preflight",
    "primaryField": "raw_account_link_key",
    "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_account_link_key", "Text", true, false, "Primary + Stable key", "google_ads:{manager_customer_id}:link:{customer_id}", "Stable manager-client relation key", null],
      ["manager_customer_id", "Text", true, false, "Identity component", "Manager customer ID", "Manager account identity", null],
      ["customer_id", "Text", true, false, "Identity component", "Selectable/client customer ID", "Advertiser identity", null],
      ["customer_name", "Text", false, true, "Not a key", "customer_client.descriptive_name / account selector", "Client account name", null],
      ["link_status", "SingleSelect", true, false, "Access state", "Derived: selectable / not_selectable / customer_client.status", "Visibility/link state", null],
      ["client_level", "Number", false, true, "Hierarchy metadata", "customer_client.level", "Depth below Manager", "0"],
      ["fetched_at", "DateTime", true, false, "Operational metadata", "Script clock", "UTC discovery timestamp", "yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json", "Text", false, true, "Audit payload", "Sanitized discovery row", "No credentials/tokens", null]
    ]
  },
  {
    "key": "rawGoogleAdsAccounts",
    "logicalName": "RAW_Google_Ads_Accounts",
    "purpose": "Advertising customer account identity/configuration",
    "primaryField": "raw_account_key",
    "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_account_key", "Text", true, false, "Primary + Stable key", "google_ads:{customer_id}:account", "Stable raw account key", null],
      ["ads_account_key", "Text", true, false, "Canonical stable key", "google_ads:{customer_id}:account:{customer_id}", "Key parity with MKT_Ads_Accounts", null],
      ["customer_id", "Text", true, false, "Identity component", "customer.id", "Google Ads Customer ID", null],
      ["descriptive_name", "Text", false, true, "Not a key", "customer.descriptive_name", "Account display name", null],
      ["currency_code", "Text", true, false, "Money context", "customer.currency_code", "ISO 4217 currency", null],
      ["time_zone", "Text", true, false, "Date context", "customer.time_zone", "Source reporting timezone", null],
      ["account_status", "Text", false, true, "Source state", "customer.status", "Exact Google source enum", null],
      ["is_manager", "Checkbox", true, false, "Semantic flag", "customer.manager", "True for manager account", null],
      ["is_test_account", "Checkbox", true, false, "Semantic flag", "customer.test_account", "Google test account flag", null],
      ["manager_customer_id", "Text", false, true, "Hierarchy identity", "Execution/login manager context", "Managing MCC ID", null],
      ["resource_name", "Text", false, true, "Source identifier", "customer.resource_name", "Google resource name", null],
      ["fetched_at", "DateTime", true, false, "Operational metadata", "Script clock", "UTC fetch timestamp", "yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at", "DateTime", true, false, "Reconciliation metadata", "Script clock when source confirms account", "Last successful source observation", "yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json", "Text", false, true, "Audit payload", "Sanitized customer row", "Raw-compatible audit data", null]
    ]
  },
  {
    "key": "rawGoogleAdsCampaignBudgets",
    "logicalName": "RAW_Google_Ads_Campaign_Budgets",
    "purpose": "Campaign budget resources ซึ่งอาจแชร์หลาย Campaign",
    "primaryField": "raw_campaign_budget_key",
    "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_campaign_budget_key", "Text", true, false, "Primary + Stable key", "google_ads:{customer_id}:campaign_budget:{campaign_budget_id}", "Stable budget key", null],
      ["customer_id", "Text", true, false, "Identity component", "customer.id/context", "Account identity", null],
      ["campaign_budget_id", "Text", true, false, "Identity component", "campaign_budget.id", "Budget identity", null],
      ["resource_name", "Text", false, true, "Source identifier", "campaign_budget.resource_name", "Google resource name", null],
      ["budget_name", "Text", false, true, "Not a key", "campaign_budget.name", "Budget display name", null],
      ["amount_micros", "Number", false, true, "Money source", "campaign_budget.amount_micros", "Daily budget amount in integer micros", "0"],
      ["total_amount_micros", "Number", false, true, "Money source", "campaign_budget.total_amount_micros", "Total campaign budget where supported", "0"],
      ["explicitly_shared", "Checkbox", false, true, "Configuration", "campaign_budget.explicitly_shared", "Budget intentionally shared", null],
      ["delivery_method", "Text", false, true, "Configuration", "campaign_budget.delivery_method", "Source delivery enum", null],
      ["period", "Text", false, true, "Configuration", "campaign_budget.period", "Budget period enum", null],
      ["fetched_at", "DateTime", true, false, "Operational metadata", "Script clock", "UTC fetch timestamp", "yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at", "DateTime", true, false, "Reconciliation metadata", "Script clock when observed", "Last source observation", "yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json", "Text", false, true, "Audit payload", "Sanitized campaign_budget row", "Audit payload", null]
    ]
  }
];
