// Generated from Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx.
// Sanitized schema metadata only; no account IDs, credentials, tokens, or billing data.

export const GOOGLE_ADS_RAW_SCHEMA_DATA_3 = [
  {
    "key": "rawGoogleAdsAds", "logicalName": "RAW_Google_Ads_Ads", "purpose": "Delivery Ad inventory; Ad แยกจาก Asset/Creative", "primaryField": "raw_ad_key", "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_ad_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:ad:{ad_id}","Stable raw Delivery Ad key",null],
      ["ads_ad_key","Text",true,false,"Canonical stable key","google_ads:{customer_id}:ad:{ad_id}","Key parity with MKT_Ads_Ads",null],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["campaign_id","Text",true,false,"Parent identity","campaign.id","Parent Campaign",null],
      ["ad_group_id","Text",true,false,"Parent identity","ad_group.id","Parent Ad Group",null],
      ["ad_id","Text",true,false,"Identity component","ad_group_ad.ad.id","Delivery Ad identity",null],
      ["ad_name","Text",false,true,"Not a key","ad_group_ad.ad.name where available","Ad display name",null],
      ["status","Text",false,true,"Source state","ad_group_ad.status","Delivery status enum",null],
      ["primary_status","Text",false,true,"Source state","ad_group_ad.primary_status","Serving-oriented status",null],
      ["ad_type","Text",false,true,"Configuration","ad_group_ad.ad.type","Google Ad type enum",null],
      ["final_urls_json","Text",false,true,"Destination metadata","ad_group_ad.ad.final_urls","JSON array of final URLs",null],
      ["display_url","Text",false,true,"Destination metadata","Ad-type-specific display URL","Source display URL",null],
      ["resource_name","Text",false,true,"Source identifier","ad_group_ad.resource_name","Google resource name",null],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at","DateTime",true,false,"Reconciliation metadata","Script clock when observed","Last source observation","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized ad_group_ad row","Audit payload",null]
    ]
  },
  {
    "key": "rawGoogleAdsAssets", "logicalName": "RAW_Google_Ads_Assets", "purpose": "Reusable asset/creative inventory รวม YouTube video asset", "primaryField": "raw_asset_key", "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_asset_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:asset:{asset_id}","Stable raw Asset key",null],
      ["ads_creative_key","Text",true,false,"Canonical stable key","google_ads:{customer_id}:creative:{asset_id}","Maps Google Asset to canonical Creative",null],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["asset_id","Text",true,false,"Identity component","asset.id","Google Asset identity",null],
      ["asset_name","Text",false,true,"Not a key","asset.name","Asset display name",null],
      ["asset_type","Text",true,false,"Configuration","asset.type","Google Asset type enum",null],
      ["source_content_id","Text",false,true,"External content identity","asset.youtube_video_asset.youtube_video_id","YouTube video ID for video assets",null],
      ["source_content_title","Text",false,true,"Metadata","asset.youtube_video_asset.youtube_video_title","YouTube video title",null],
      ["source_content_url","URL",false,true,"Derived metadata","https://www.youtube.com/watch?v={source_content_id}","Canonical YouTube URL",null],
      ["thumbnail_url","URL",false,true,"Derived metadata","https://i.ytimg.com/vi/{source_content_id}/hqdefault.jpg","Derived YouTube thumbnail",null],
      ["text_asset_content","Text",false,true,"Asset content","asset.text_asset.text","Text asset payload",null],
      ["final_urls_json","Text",false,true,"Destination metadata","asset.final_urls","JSON array of final URLs",null],
      ["resource_name","Text",false,true,"Source identifier","asset.resource_name","Google resource name",null],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at","DateTime",true,false,"Reconciliation metadata","Script clock when observed","Last source observation","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized asset row","Audit payload",null]
    ]
  },
  {
    "key": "rawGoogleAdsAdAssets", "logicalName": "RAW_Google_Ads_Ad_Assets", "purpose": "Link ระหว่าง Delivery Ad กับ reusable Asset", "primaryField": "raw_ad_asset_link_key", "defaultViewName": "📋 All Records",
    "fields": [
      ["raw_ad_asset_link_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:ad:{ad_id}:asset:{asset_id}:{field_type}","Stable many-to-many link key",null],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["campaign_id","Text",true,false,"Parent identity","campaign.id","Campaign identity",null],
      ["ad_group_id","Text",true,false,"Parent identity","ad_group.id","Ad Group identity",null],
      ["ad_id","Text",true,false,"Parent identity","ad_group_ad.ad.id","Ad identity",null],
      ["asset_id","Text",true,false,"Asset identity","asset.id / ad_group_ad_asset_view.asset","Asset identity",null],
      ["field_type","Text",true,false,"Link identity","ad_group_ad_asset_view.field_type","Asset role/field type",null],
      ["performance_label","Text",false,true,"Performance metadata","ad_group_ad_asset_view.performance_label","Asset performance label",null],
      ["policy_summary_status","Text",false,true,"Policy metadata","Policy summary when selectable","Policy status",null],
      ["source_view","Text",true,false,"Source contract","Adapter constant","Query/view used",null],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["last_seen_at","DateTime",true,false,"Reconciliation metadata","Script clock when observed","Last observation","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized link row","Audit payload",null]
    ]
  }
];
