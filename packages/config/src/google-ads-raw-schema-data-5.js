// Generated from Social_MKT_Data_Hub_Google_Ads_Blueprint_v0.13.0_RC1.xlsx.
// Sanitized schema metadata only; no account IDs, credentials, tokens, or billing data.

export const GOOGLE_ADS_RAW_SCHEMA_DATA_5 = [
  {
    "key":"rawGoogleAdsDaily","logicalName":"RAW_Google_Ads_Daily","purpose":"Daily base totals ตาม account/campaign/ad_group/ad/asset_group grain","primaryField":"raw_ads_daily_key","defaultViewName":"📋 All Records",
    "fields":[
      ["raw_ads_daily_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:{report_level}:{external_entity_id}:{metric_date}:{segment_key}","Stable daily report key",null],
      ["metric_date","DateTime",true,false,"Date identity","segments.date in account timezone","Source reporting date","yyyy-mm-dd"],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["report_level","SingleSelect",true,false,"Grain identity","Adapter constant per query","account/campaign/ad_group/ad/asset_group/asset",null],
      ["external_entity_id","Text",true,false,"Identity component","ID selected by report_level","Entity identity",null],
      ["campaign_id","Text",false,true,"Parent identity","campaign.id","Campaign identity",null],
      ["ad_group_id","Text",false,true,"Parent identity","ad_group.id","Ad Group identity",null],
      ["ad_id","Text",false,true,"Parent identity","ad_group_ad.ad.id","Ad identity",null],
      ["asset_group_id","Text",false,true,"Parent identity","asset_group.id","Asset Group identity",null],
      ["asset_id","Text",false,true,"Parent identity","asset.id","Asset identity",null],
      ["advertising_channel_type","Text",false,true,"Channel mapping","campaign.advertising_channel_type","Google channel enum",null],
      ["advertising_channel_sub_type","Text",false,true,"Channel mapping","campaign.advertising_channel_sub_type","Google subtype enum",null],
      ["ad_channel","SingleSelect",true,false,"Normalized dimension","Mapping rule","Client-facing ads channel",null],
      ["segment_key","Text",true,false,"Segment identity","all or deterministic segment serialization","Breakdown key",null],
      ["ad_network_type","Text",false,true,"Breakdown dimension","segments.ad_network_type","Network enum",null],
      ["ad_sub_network_type","Text",false,true,"Breakdown dimension","segments.ad_sub_network_type","Sub-network enum",null],
      ["device","Text",false,true,"Breakdown dimension","segments.device","Device enum",null],
      ["currency","Text",true,false,"Money context","customer.currency_code","ISO currency",null],
      ["cost_micros","Number",false,true,"Money source","metrics.cost_micros","Spend source of truth","0"],
      ["impressions","Number",false,true,"Metric","metrics.impressions","Delivered impressions","0"],
      ["clicks","Number",false,true,"Metric","metrics.clicks","Google Ads clicks","0"],
      ["interactions","Number",false,true,"Metric","metrics.interactions","Interactions under Google definition","0"],
      ["interaction_rate","Number",false,true,"Metric","metrics.interaction_rate","Interactions divided by eligible impressions","0.00%"],
      ["conversions","Number",false,true,"Metric","metrics.conversions","Conversions under configured Conversions column","0.00"],
      ["conversions_value","Number",false,true,"Raw money metric","metrics.conversions_value","Source currency-unit double","0.000000"],
      ["conversions_value_micros","Number",false,true,"Normalized money source","round(conversions_value*1000000)","Integer micros canonical source","0"],
      ["all_conversions","Number",false,true,"Metric","metrics.all_conversions","All conversions; broader than Conversions","0.00"],
      ["all_conversions_value","Number",false,true,"Raw money metric","metrics.all_conversions_value","All conversion value currency units","0.000000"],
      ["all_conversions_value_micros","Number",false,true,"Normalized money source","round(all_conversions_value*1000000)","Integer micros for all-conversion value","0"],
      ["video_trueview_views","Number",false,true,"Video metric","metrics.video_trueview_views","TrueView views","0"],
      ["video_trueview_view_rate","Number",false,true,"Video metric","metrics.video_trueview_view_rate","TrueView views / eligible impressions","0.00%"],
      ["trueview_average_cpv","Number",false,true,"Video money metric","metrics.trueview_average_cpv","Average amount paid per TrueView view","0.0000"],
      ["video_quartile_p25_rate","Number",false,true,"Video metric","metrics.video_quartile_p25_rate","Share of impressions reaching 25%","0.00%"],
      ["video_quartile_p50_rate","Number",false,true,"Video metric","metrics.video_quartile_p50_rate","Share of impressions reaching 50%","0.00%"],
      ["video_quartile_p75_rate","Number",false,true,"Video metric","metrics.video_quartile_p75_rate","Share of impressions reaching 75%","0.00%"],
      ["video_quartile_p100_rate","Number",false,true,"Video metric","metrics.video_quartile_p100_rate","Share of impressions reaching 100%","0.00%"],
      ["view_through_conversions","Number",false,true,"Conversion metric","metrics.view_through_conversions","Conversions after view without interaction","0"],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized reporting row","Audit payload",null]
    ]
  },
  {
    "key":"rawGoogleAdsConversionDaily","logicalName":"RAW_Google_Ads_Conversion_Daily","purpose":"Daily conversion rows แยก Conversion Action","primaryField":"raw_conversion_daily_key","defaultViewName":"📋 All Records",
    "fields":[
      ["raw_conversion_daily_key","Text",true,false,"Primary + Stable key","google_ads:{customer_id}:{report_level}:{external_entity_id}:{metric_date}:conversion:{conversion_action_id}","Stable conversion-detail key",null],
      ["metric_date","DateTime",true,false,"Date identity","segments.date","Source reporting date","yyyy-mm-dd"],
      ["customer_id","Text",true,false,"Identity component","customer context","Account identity",null],
      ["report_level","SingleSelect",true,false,"Grain identity","Adapter constant","campaign/ad_group/ad",null],
      ["external_entity_id","Text",true,false,"Identity component","Selected entity ID","Entity identity",null],
      ["campaign_id","Text",false,true,"Parent identity","campaign.id","Campaign identity",null],
      ["ad_group_id","Text",false,true,"Parent identity","ad_group.id","Ad Group identity",null],
      ["ad_id","Text",false,true,"Parent identity","ad_group_ad.ad.id","Ad identity",null],
      ["conversion_action_id","Text",true,false,"Conversion identity","segments.conversion_action parsed ID","Conversion Action identity",null],
      ["conversion_action_name","Text",false,true,"Classification","segments.conversion_action_name","Conversion Action name",null],
      ["conversion_action_category","Text",false,true,"Classification","segments.conversion_action_category","Google category enum",null],
      ["conversions","Number",false,true,"Metric","metrics.conversions","Conversions for this action","0.00"],
      ["conversions_value","Number",false,true,"Raw money metric","metrics.conversions_value","Value for this action","0.000000"],
      ["conversions_value_micros","Number",false,true,"Normalized money source","round(conversions_value*1000000)","Integer micros","0"],
      ["fetched_at","DateTime",true,false,"Operational metadata","Script clock","UTC fetch timestamp","yyyy-mm-dd hh:mm:ss"],
      ["source_payload_json","Text",false,true,"Audit payload","Sanitized conversion row","Audit payload",null]
    ]
  }
];
