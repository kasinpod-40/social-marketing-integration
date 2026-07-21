// Generated from Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx.
// Sanitized schema metadata only; no account IDs, credentials, tokens, or billing data.

export const GOOGLE_ADS_RAW_SCHEMA_DATA_4 = [
  {
    "key":"rawGoogleAdsAssetGroups","logicalName":"RAW_Google_Ads_Asset_Groups","purpose":"Performance Max Asset Group master","primaryField":"raw_asset_group_key","defaultViewName":"📋 All Records",
    "fields":[
      ["raw_asset_group_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:asset_group:{asset_group_id}","Stable raw Asset Group key",null],
      ["ads_asset_group_key","Text",true,false,"Canonical stable key","google_ads:{customer_id}:asset_group:{asset_group_id}","Key parity with MKT_Ads_AssetGroups",null],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["campaign_id","Text",true,false,"Parent identity","asset_group.campaign / campaign.id","Parent PMax Campaign",null],
      ["asset_group_id","Text",true,false,"Identity component","asset_group.id","Asset Group identity",null],
      ["asset_group_name","Text",false,true,"Not a key","asset_group.name","Asset Group name",null],
      ["status","Text",false,true,"Source state","asset_group.status","Exact source enum",null],
      ["primary_status","Text",false,true,"Source state","asset_group.primary_status","Serving-oriented status",null],
      ["final_urls_json","Text",false,true,"Destination metadata","asset_group.final_urls","JSON array",null],
      ["mobile_urls_json","Text",false,true,"Destination metadata","asset_group.final_mobile_urls","JSON array",null],
      ["resource_name","Text",false,true,"Source identifier","asset_group.resource_name","Google resource name",null],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at","DateTime",true,false,"Reconciliation metadata","Script clock when observed","Last observation","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized asset_group row","Audit payload",null]
    ]
  },
  {
    "key":"rawGoogleAdsAssetGroupAssets","logicalName":"RAW_Google_Ads_Asset_Group_Assets","purpose":"Link ระหว่าง PMax Asset Group กับ Asset","primaryField":"raw_asset_group_asset_key","defaultViewName":"📋 All Records",
    "fields":[
      ["raw_asset_group_asset_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:asset_group:{asset_group_id}:asset:{asset_id}:{field_type}","Stable Asset Group link key",null],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["campaign_id","Text",true,false,"Parent identity","asset_group.campaign","Campaign identity",null],
      ["asset_group_id","Text",true,false,"Parent identity","asset_group.id","Asset Group identity",null],
      ["asset_id","Text",true,false,"Asset identity","asset.id","Asset identity",null],
      ["field_type","Text",true,false,"Link identity","asset_group_asset.field_type","Asset role in Asset Group",null],
      ["status","Text",false,true,"Source state","asset_group_asset.status","Link status enum",null],
      ["performance_label","Text",false,true,"Performance metadata","asset_group_asset.performance_label","Performance label",null],
      ["pinned_field","Text",false,true,"Configuration","asset_group_asset.pinned_field","Pinned asset placement",null],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at","DateTime",true,false,"Reconciliation metadata","Script clock when observed","Last observation","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized asset_group_asset row","Audit payload",null]
    ]
  },
  {
    "key":"rawGoogleAdsConversionActions","logicalName":"RAW_Google_Ads_Conversion_Actions","purpose":"Conversion definition/configuration สำหรับเลือก approved conversion set","primaryField":"raw_conversion_action_key","defaultViewName":"📋 All Records",
    "fields":[
      ["raw_conversion_action_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:conversion_action:{conversion_action_id}","Stable conversion action key",null],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["conversion_action_id","Text",true,false,"Identity component","conversion_action.id","Conversion Action identity",null],
      ["conversion_action_name","Text",false,true,"Not a key","conversion_action.name","Display name",null],
      ["category","Text",false,true,"Classification","conversion_action.category","Google conversion category",null],
      ["conversion_type","Text",false,true,"Classification","conversion_action.type","Conversion source/type enum",null],
      ["status","Text",false,true,"Source state","conversion_action.status","Source status enum",null],
      ["primary_for_goal","Checkbox",false,true,"Goal semantics","conversion_action.primary_for_goal","Counts as primary goal",null],
      ["include_in_conversions_metric","Checkbox",false,true,"Metric semantics","conversion_action.include_in_conversions_metric","Included in Conversions column",null],
      ["default_value","Number",false,true,"Value configuration","conversion_action.value_settings.default_value","Configured default conversion value","0.00"],
      ["always_use_default_value","Checkbox",false,true,"Value configuration","conversion_action.value_settings.always_use_default_value","Always use default value",null],
      ["resource_name","Text",false,true,"Source identifier","conversion_action.resource_name","Google resource name",null],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at","DateTime",true,false,"Reconciliation metadata","Script clock when observed","Last observation","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized conversion_action row","Audit payload",null]
    ]
  }
];
