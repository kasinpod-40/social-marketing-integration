/**
 * Google Ads Manager Script — read-only signed delivery v1.
 *
 * Default is DRY_RUN: reads one allowlisted advertiser, builds/validates the six-dataset
 * envelope and logs counts only. PREVIEW sends a signed envelope that the Worker validates
 * without Queue/Lark business writes. LIVE is manual-only; this file never creates a schedule.
 *
 * Script Properties (never commit values):
 * - MKT_GOOGLE_ADS_DELIVERY_URL
 * - MKT_GOOGLE_ADS_SIGNING_KEY_ID
 * - MKT_GOOGLE_ADS_SIGNING_SECRET (minimum 32 characters)
 */
var CONFIG = Object.freeze({
  EXECUTION_MODE: 'DRY_RUN', // DRY_RUN | PREVIEW | LIVE
  MANAGER_CUSTOMER_ID: '946-357-0541',
  MANAGER_CUSTOMER_ID_NORMALIZED: '9463570541',
  TARGET_CUSTOMER_ID: '566-233-2033',
  TARGET_CUSTOMER_ID_NORMALIZED: '5662332033',
  CUSTOMER_KEY: 'chemistry_k',
  ACCOUNT_KEY: 'chemistry_k',
  SOURCE_TIMEZONE: 'Asia/Bangkok',
  LOOKBACK_DAYS: 30,
  MAX_ATTEMPTS: 3,
  RETRY_BASE_MS: 1000,
  CONTRACT_PATH: '/v1/google-ads/deliveries'
});

function main() {
  assertExecutionMode_(CONFIG.EXECUTION_MODE);
  var target = selectExactlyOneTarget_();
  AdsManagerApp.select(target);
  assertSelectedTarget_();

  var fetchedAt = new Date().toISOString();
  var datasets = readDatasets_(fetchedAt);
  var deliveryId = Utilities.getUuid().toLowerCase();
  var envelope = {
    schemaVersion: 'google_ads_signed_delivery_v1',
    deliveryId: deliveryId,
    mode: CONFIG.EXECUTION_MODE === 'LIVE' ? 'LIVE' : 'PREVIEW',
    managerCustomerId: CONFIG.MANAGER_CUSTOMER_ID_NORMALIZED,
    customerId: CONFIG.TARGET_CUSTOMER_ID_NORMALIZED,
    customerKey: CONFIG.CUSTOMER_KEY,
    accountKey: CONFIG.ACCOUNT_KEY,
    fetchedAt: fetchedAt,
    sourceTimezone: CONFIG.SOURCE_TIMEZONE,
    datasetCounts: {
      account: 1,
      campaigns: datasets.campaigns.length,
      adGroups: datasets.adGroups.length,
      ads: datasets.ads.length,
      youtubeAssets: datasets.youtubeAssets.length,
      campaignDailyMetrics: datasets.campaignDailyMetrics.length
    },
    datasets: datasets
  };
  var body = JSON.stringify(envelope);
  var digest = sha256Hex_(body);

  Logger.log(JSON.stringify({
    ok: true,
    mode: CONFIG.EXECUTION_MODE,
    schemaVersion: envelope.schemaVersion,
    datasetCounts: envelope.datasetCounts,
    contentSha256Prefix: digest.slice(0, 12),
    externalDelivery: CONFIG.EXECUTION_MODE !== 'DRY_RUN'
  }));

  if (CONFIG.EXECUTION_MODE === 'DRY_RUN') return;
  sendSignedWithRetry_(body, envelope.deliveryId, digest);
}

function selectExactlyOneTarget_() {
  var selector = AdsManagerApp.accounts().withIds([CONFIG.TARGET_CUSTOMER_ID]);
  var iterator = selector.get();
  if (!iterator.hasNext()) throw new Error('TARGET_ACCOUNT_NOT_SELECTABLE');
  var account = iterator.next();
  if (iterator.hasNext()) throw new Error('TARGET_ACCOUNT_SELECTION_AMBIGUOUS');
  if (normalizeCustomerId_(account.getCustomerId()) !== CONFIG.TARGET_CUSTOMER_ID_NORMALIZED) {
    throw new Error('TARGET_ACCOUNT_IDENTITY_MISMATCH');
  }
  return account;
}

function assertSelectedTarget_() {
  var selected = normalizeCustomerId_(AdsApp.currentAccount().getCustomerId());
  if (selected !== CONFIG.TARGET_CUSTOMER_ID_NORMALIZED) throw new Error('SELECTED_ACCOUNT_IDENTITY_MISMATCH');
}

function readDatasets_(fetchedAt) {
  var accountRows = collect_("SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status, customer.manager, customer.test_account, customer.resource_name FROM customer LIMIT 1");
  if (accountRows.length !== 1) throw new Error('ACCOUNT_DATASET_MUST_CONTAIN_ONE_ROW');
  var account = accountRows[0].customer;
  if (normalizeCustomerId_(account.id) !== CONFIG.TARGET_CUSTOMER_ID_NORMALIZED) throw new Error('ACCOUNT_QUERY_IDENTITY_MISMATCH');
  if (String(account.timeZone) !== CONFIG.SOURCE_TIMEZONE) throw new Error('ACCOUNT_TIMEZONE_MISMATCH');

  var dates = completedDateRange_(CONFIG.SOURCE_TIMEZONE, CONFIG.LOOKBACK_DAYS);
  var campaigns = collect_("SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.serving_status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy_type, campaign.campaign_budget, campaign.resource_name FROM campaign ORDER BY campaign.id LIMIT 500").map(mapCampaign_);
  var adGroups = collect_("SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.resource_name FROM ad_group ORDER BY ad_group.id LIMIT 2000").map(mapAdGroup_);
  var ads = collect_("SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.resource_name FROM ad_group_ad ORDER BY ad_group_ad.ad.id LIMIT 5000").map(mapAd_);
  var youtubeAssets = collect_("SELECT asset.id, asset.name, asset.type, asset.resource_name, asset.youtube_video_asset.youtube_video_id FROM asset WHERE asset.type = 'YOUTUBE_VIDEO' ORDER BY asset.id LIMIT 5000").map(mapYoutubeAsset_);
  var dailyQuery = "SELECT segments.date, customer.currency_code, campaign.id, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.video_views, metrics.video_view_rate, metrics.average_cpv FROM campaign WHERE segments.date BETWEEN '" + dates.start + "' AND '" + dates.end + "' ORDER BY segments.date, campaign.id LIMIT 10000";
  var campaignDailyMetrics = collect_(dailyQuery).map(mapDaily_);

  return {
    account: {
      customerId: normalizeCustomerId_(account.id),
      descriptiveName: nullableString_(account.descriptiveName),
      currencyCode: String(account.currencyCode),
      timeZone: String(account.timeZone),
      status: nullableString_(account.status),
      isManager: Boolean(account.manager),
      isTestAccount: Boolean(account.testAccount),
      resourceName: nullableString_(account.resourceName)
    },
    campaigns: campaigns,
    adGroups: adGroups,
    ads: ads,
    youtubeAssets: youtubeAssets,
    campaignDailyMetrics: campaignDailyMetrics
  };
}

function collect_(query) {
  var iterator = AdsApp.search(query);
  var rows = [];
  while (iterator.hasNext()) rows.push(iterator.next());
  return rows;
}

function mapCampaign_(row) {
  return {
    campaignId: String(row.campaign.id),
    campaignName: nullableString_(row.campaign.name),
    status: nullableString_(row.campaign.status),
    primaryStatus: nullableString_(row.campaign.primaryStatus),
    servingStatus: nullableString_(row.campaign.servingStatus),
    advertisingChannelType: String(row.campaign.advertisingChannelType),
    advertisingChannelSubType: nullableString_(row.campaign.advertisingChannelSubType),
    // Live UAT rejected the two optional campaign date fields; keep schema-null.
    startDate: null,
    endDate: null,
    biddingStrategyType: nullableString_(row.campaign.biddingStrategyType),
    campaignBudgetId: resourceId_(row.campaign.campaignBudget),
    campaignBudgetResourceName: nullableString_(row.campaign.campaignBudget),
    resourceName: nullableString_(row.campaign.resourceName)
  };
}
function mapAdGroup_(row) {
  return {
    adGroupId: String(row.adGroup.id),
    campaignId: String(row.campaign.id),
    adGroupName: nullableString_(row.adGroup.name),
    status: nullableString_(row.adGroup.status),
    primaryStatus: null,
    type: nullableString_(row.adGroup.type),
    resourceName: nullableString_(row.adGroup.resourceName)
  };
}
function mapAd_(row) {
  return {
    adId: String(row.adGroupAd.ad.id),
    adGroupId: String(row.adGroup.id),
    campaignId: String(row.campaign.id),
    adName: nullableString_(row.adGroupAd.ad.name),
    status: nullableString_(row.adGroupAd.status),
    primaryStatus: null,
    type: nullableString_(row.adGroupAd.ad.type),
    finalUrls: null,
    displayUrl: null,
    resourceName: nullableString_(row.adGroupAd.resourceName)
  };
}
function mapYoutubeAsset_(row) {
  return {
    assetId: String(row.asset.id),
    assetName: nullableString_(row.asset.name),
    status: null,
    assetType: 'YOUTUBE_VIDEO',
    youtubeVideoId: String(row.asset.youtubeVideoAsset.youtubeVideoId),
    youtubeVideoTitle: null,
    resourceName: nullableString_(row.asset.resourceName)
  };
}
function mapDaily_(row) {
  return {
    metricDate: String(row.segments.date),
    reportLevel: 'campaign',
    externalEntityId: String(row.campaign.id),
    campaignId: String(row.campaign.id),
    adGroupId: null,
    adId: null,
    advertisingChannelType: String(row.campaign.advertisingChannelType),
    advertisingChannelSubType: nullableString_(row.campaign.advertisingChannelSubType),
    adChannel: adChannel_(row.campaign.advertisingChannelType),
    segmentKey: 'all',
    currency: String(row.customer.currencyCode),
    spendMicros: nullableInteger_(row.metrics.costMicros),
    impressions: nullableInteger_(row.metrics.impressions),
    clicks: nullableInteger_(row.metrics.clicks),
    conversions: nullableNumber_(row.metrics.conversions),
    conversionValueMicros: currencyToMicros_(row.metrics.conversionsValue),
    videoViews: nullableInteger_(row.metrics.videoViews),
    videoViewRate: nullableNumber_(row.metrics.videoViewRate),
    averageCpvMicros: currencyToMicros_(row.metrics.averageCpv)
  };
}

function sendSignedWithRetry_(body, deliveryId, digest) {
  var properties = PropertiesService.getScriptProperties();
  var endpoint = requireProperty_(properties, 'MKT_GOOGLE_ADS_DELIVERY_URL');
  var keyId = requireProperty_(properties, 'MKT_GOOGLE_ADS_SIGNING_KEY_ID');
  var secret = requireProperty_(properties, 'MKT_GOOGLE_ADS_SIGNING_SECRET');
  if (secret.length < 32) throw new Error('SIGNING_SECRET_TOO_SHORT');
  if (!/^https:\/\/[^/?#]+\/v1\/google-ads\/deliveries$/.test(endpoint)) {
    throw new Error('DELIVERY_URL_MUST_BE_EXACT_HTTPS_CONTRACT_PATH');
  }
  var idempotencyKey = 'google-ads:' + deliveryId;

  for (var attempt = 1; attempt <= CONFIG.MAX_ATTEMPTS; attempt += 1) {
    var timestamp = String(Math.floor(Date.now() / 1000));
    var nonce = nonce_();
    var signingInput = ['MKT-HMAC-SHA256-V1', 'POST', CONFIG.CONTRACT_PATH, timestamp, nonce, idempotencyKey, digest].join('\n');
    var signature = 'sha256=' + bytesToHex_(Utilities.computeHmacSha256Signature(signingInput, secret));
    var response;
    try {
      response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        payload: body,
        muteHttpExceptions: true,
        headers: {
          'X-MKT-Key-Id': keyId,
          'X-MKT-Timestamp': timestamp,
          'X-MKT-Nonce': nonce,
          'X-MKT-Idempotency-Key': idempotencyKey,
          'X-MKT-Content-SHA256': digest,
          'X-MKT-Signature': signature
        }
      });
    } catch (error) {
      if (attempt === CONFIG.MAX_ATTEMPTS) throw error;
      Utilities.sleep(CONFIG.RETRY_BASE_MS * Math.pow(2, attempt - 1));
      continue;
    }
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      Logger.log(JSON.stringify({ ok: true, deliveryStatus: status, attempt: attempt }));
      return;
    }
    if ((status === 429 || status >= 500) && attempt < CONFIG.MAX_ATTEMPTS) {
      Utilities.sleep(CONFIG.RETRY_BASE_MS * Math.pow(2, attempt - 1));
      continue;
    }
    throw new Error('DELIVERY_REJECTED_HTTP_' + status);
  }
}

function completedDateRange_(timezone, days) {
  var end = new Date(Date.now() - 86400000);
  var start = new Date(end.getTime() - ((days - 1) * 86400000));
  return { start: Utilities.formatDate(start, timezone, 'yyyy-MM-dd'), end: Utilities.formatDate(end, timezone, 'yyyy-MM-dd') };
}
function sha256Hex_(text) { return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function nonce_() { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Date.now()), false).replace(/=+$/g, '').slice(0, 43); }
function bytesToHex_(bytes) { return bytes.map(function(value) { var normalized = value < 0 ? value + 256 : value; return ('0' + normalized.toString(16)).slice(-2); }).join(''); }
function normalizeCustomerId_(value) { return String(value).replace(/-/g, ''); }
function nullableString_(value) { return value === null || value === undefined || value === '' ? null : String(value); }
function nullableInteger_(value) {
  if (value === null || value === undefined || value === '') return null;
  var number = Number(value);
  if (!isFinite(number) || number < 0 || Math.floor(number) !== number || !Number.isSafeInteger(number)) throw new Error('UNSAFE_INTEGER_METRIC');
  return number;
}
function nullableNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  var number = Number(value);
  if (!isFinite(number) || number < 0) throw new Error('INVALID_DECIMAL_METRIC');
  return number;
}
function currencyToMicros_(value) {
  if (value === null || value === undefined || value === '') return null;
  var text = String(value).trim();
  var match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error('INVALID_CURRENCY_DECIMAL');
  var whole = match[1];
  var fraction = match[2] || '';
  var exponent = match[3] ? Number(match[3]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error('CURRENCY_EXPONENT_OUT_OF_RANGE');
  var digits = (whole + fraction).replace(/^0+(?=\d)/, '');
  var scale = exponent - fraction.length + 6;
  var microsText;
  if (scale >= 0) {
    microsText = digits + new Array(scale + 1).join('0');
  } else {
    var keep = digits.length + scale;
    var retained = keep > 0 ? digits.slice(0, keep) : '0';
    var discarded = keep >= 0 ? digits.slice(keep) : new Array((-keep) + 1).join('0') + digits;
    microsText = incrementDecimalText_(retained, discarded.charAt(0) >= '5');
  }
  microsText = microsText.replace(/^0+(?=\d)/, '');
  var micros = Number(microsText);
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error('CURRENCY_MICROS_OUT_OF_RANGE');
  return micros;
}
function incrementDecimalText_(value, shouldIncrement) {
  if (!shouldIncrement) return value;
  var digits = value.split('');
  for (var index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== '9') { digits[index] = String(Number(digits[index]) + 1); return digits.join(''); }
    digits[index] = '0';
  }
  return '1' + digits.join('');
}
function resourceId_(value) { var text = nullableString_(value); if (!text) return null; var parts = text.split('/'); return /^\d+$/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : null; }
function adChannel_(type) { var value = String(type); if (value === 'VIDEO') return 'youtube_ads'; if (value === 'SEARCH') return 'google_search_ads'; return 'google_display_ads'; }
function requireProperty_(properties, key) { var value = properties.getProperty(key); if (!value) throw new Error('MISSING_SCRIPT_PROPERTY_' + key); return value; }
function assertExecutionMode_(mode) { if (['DRY_RUN', 'PREVIEW', 'LIVE'].indexOf(mode) === -1) throw new Error('INVALID_EXECUTION_MODE'); }
