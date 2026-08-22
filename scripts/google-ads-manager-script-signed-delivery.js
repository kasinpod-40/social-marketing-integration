/**
 * Social MKT Google Ads Manager Script — sanitized signed-delivery artifact v1
 *
 * Repository artifact นี้ไม่มี Customer ID/Secret และไม่ได้คัดลอก Script 598 บรรทัด
 * ที่เคยผ่าน documented live review. ค่า Runtime อ่านจาก Script Properties เท่านั้น.
 *
 * ค่าเริ่มต้น:
 * - DRY_RUN
 * - Delivery disabled
 * - Read-only AdsApp.search()
 * - ไม่มี Schedule/Trigger creation และไม่มี Google Ads mutation
 */

const GOOGLE_ADS_SIGNED_DELIVERY = Object.freeze({
  schemaVersion: 'google_ads_manager_script_signed_delivery_v1',
  apiVersion: 'v24',
  endpointPath: '/v1/google-ads/manager-script/deliveries',
  modeDefault: 'DRY_RUN',
  deliveryEnabledDefault: false,
  bodyBytes: 524288,
  rowChunkBytes: 409600,
  rowsPerChunk: 500,
  chunksPerRun: 64,
  datasetLimits: Object.freeze({
    account: 1,
    campaigns: 500,
    assetGroups: 2000,
    adGroups: 2000,
    ads: 5000,
    youtubeAssets: 5000,
    campaignDailyMetrics: 10000,
  }),
});

const GOOGLE_ADS_GAQL = Object.freeze({
  account: `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.currency_code,
      customer.time_zone,
      customer.status,
      customer.manager,
      customer.test_account,
      customer.resource_name
    FROM customer
    LIMIT 1
  `,
  campaigns: `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.primary_status,
      campaign.serving_status,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      campaign.bidding_strategy_type,
      campaign.campaign_budget,
      campaign.resource_name
    FROM campaign
    ORDER BY campaign.id
  `,
  assetGroups: `
    SELECT
      asset_group.id,
      campaign.id,
      asset_group.name,
      asset_group.status,
      asset_group.resource_name
    FROM asset_group
    ORDER BY campaign.id, asset_group.id
  `,
  adGroups: `
    SELECT
      ad_group.id,
      campaign.id,
      ad_group.name,
      ad_group.status,
      ad_group.primary_status,
      ad_group.type,
      ad_group.resource_name
    FROM ad_group
    ORDER BY ad_group.id
  `,
  ads: `
    SELECT
      ad_group_ad.ad.id,
      ad_group.id,
      campaign.id,
      ad_group_ad.ad.name,
      ad_group_ad.status,
      ad_group_ad.primary_status,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.display_url,
      ad_group_ad.resource_name
    FROM ad_group_ad
    ORDER BY campaign.id, ad_group.id, ad_group_ad.ad.id
  `,
  youtubeAssets: `
    SELECT
      asset.id,
      asset.name,
      asset.type,
      asset.youtube_video_asset.youtube_video_id,
      asset.youtube_video_asset.youtube_video_title,
      asset.resource_name
    FROM asset
    WHERE asset.type = 'YOUTUBE_VIDEO'
    ORDER BY asset.id
  `,
  campaignDailyMetrics: `
    SELECT
      segments.date,
      campaign.id,
      campaign.advertising_channel_type,
      campaign.advertising_channel_sub_type,
      customer.currency_code,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.video_trueview_views,
      metrics.video_trueview_view_rate,
      metrics.trueview_average_cpv
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY segments.date, campaign.id
  `,
});

function main() {
  const config = loadSignedDeliveryConfig_();
  if (config.mode !== 'DRY_RUN' && !config.deliveryEnabled) {
    throw new Error('Signed delivery is disabled in Script Properties');
  }
  selectExactAdvertiser_(config);
  const runStartedAt = new Date().toISOString();
  const datasets = readAllDatasets_();
  const planned = planSignedChunks_(datasets, config, runStartedAt);
  const summary = {
    mode: config.mode,
    deliveryEnabled: config.deliveryEnabled,
    datasetCounts: Object.fromEntries(
      Object.entries(datasets).map(([key, rows]) => [key, rows.length]),
    ),
    chunkCount: planned.chunks.length,
    truncated: false,
  };

  if (config.mode === 'DRY_RUN') {
    Logger.log(JSON.stringify(summary));
    return summary;
  }
  for (const chunk of planned.chunks) {
    deliverSignedChunk_(stampChunkForDelivery_(chunk), config);
  }
  Logger.log(JSON.stringify({
    mode: config.mode,
    deliveredChunks: planned.chunks.length,
    datasetCounts: summary.datasetCounts,
    truncated: false,
  }));
  return summary;
}

function loadSignedDeliveryConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const mode = optionalProperty_(properties, 'MKT_GOOGLE_ADS_MODE')
    || GOOGLE_ADS_SIGNED_DELIVERY.modeDefault;
  if (!['DRY_RUN', 'PREVIEW', 'LIVE'].includes(mode)) {
    throw new Error('MKT_GOOGLE_ADS_MODE is invalid');
  }
  const deliveryEnabled = readBooleanProperty_(
    properties,
    'MKT_GOOGLE_ADS_DELIVERY_ENABLED',
    GOOGLE_ADS_SIGNED_DELIVERY.deliveryEnabledDefault,
  );
  const config = {
    mode,
    deliveryEnabled,
    managerCustomerId: requireCustomerIdProperty_(
      properties,
      'MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID',
    ),
    customerId: requireCustomerIdProperty_(
      properties,
      'MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID',
    ),
    customerKey: requireProperty_(properties, 'MKT_GOOGLE_ADS_CUSTOMER_KEY'),
    accountKey: requireProperty_(properties, 'MKT_GOOGLE_ADS_ACCOUNT_KEY'),
    sourceTimezone: requireProperty_(properties, 'MKT_GOOGLE_ADS_SOURCE_TIMEZONE'),
    endpoint: optionalProperty_(properties, 'MKT_GOOGLE_ADS_DELIVERY_ENDPOINT'),
    keyId: optionalProperty_(properties, 'MKT_GOOGLE_ADS_SIGNING_KEY_ID'),
    signingSecret: optionalProperty_(properties, 'MKT_GOOGLE_ADS_SIGNING_SECRET'),
  };
  if (mode !== 'DRY_RUN') {
    assertDeliveryEndpoint_(config.endpoint);
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.keyId || '')) {
      throw new Error('MKT_GOOGLE_ADS_SIGNING_KEY_ID is invalid');
    }
    if (utf8Bytes_(config.signingSecret || '') < 32) {
      throw new Error('MKT_GOOGLE_ADS_SIGNING_SECRET is invalid');
    }
  }
  return Object.freeze(config);
}

function selectExactAdvertiser_(config) {
  const executionCustomerId = normalizeCustomerId_(
    AdsApp.currentAccount().getCustomerId(),
  );
  if (executionCustomerId !== config.managerCustomerId) {
    throw new Error('Manager execution identity mismatch');
  }
  const iterator = AdsManagerApp.accounts().withIds([config.customerId]).get();
  if (!iterator.hasNext()) throw new Error('Allowlisted advertiser is not selectable');
  const account = iterator.next();
  if (iterator.hasNext()) throw new Error('Advertiser allowlist resolved more than once');
  AdsManagerApp.select(account);
  const selected = normalizeCustomerId_(AdsApp.currentAccount().getCustomerId());
  if (selected !== config.customerId) throw new Error('Selected advertiser identity mismatch');
}

function readAllDatasets_() {
  const account = readQuery_(
    'account',
    GOOGLE_ADS_GAQL.account,
    mapAccountRow_,
  );
  if (account.length !== 1) throw new Error('Account dataset must contain exactly one row');
  const currency = account[0].currencyCode;
  return Object.freeze({
    account,
    campaigns: readQuery_('campaigns', GOOGLE_ADS_GAQL.campaigns, mapCampaignRow_),
    assetGroups: readQuery_('assetGroups', GOOGLE_ADS_GAQL.assetGroups, mapAssetGroupRow_),
    adGroups: readQuery_('adGroups', GOOGLE_ADS_GAQL.adGroups, mapAdGroupRow_),
    ads: readQuery_('ads', GOOGLE_ADS_GAQL.ads, mapAdRow_),
    youtubeAssets: readQuery_(
      'youtubeAssets',
      GOOGLE_ADS_GAQL.youtubeAssets,
      mapYoutubeAssetRow_,
    ),
    campaignDailyMetrics: readQuery_(
      'campaignDailyMetrics',
      GOOGLE_ADS_GAQL.campaignDailyMetrics,
      (row) => mapCampaignDailyRow_(row, currency),
    ),
  });
}

function readQuery_(datasetKey, query, mapper) {
  const iterator = AdsApp.search(query, {
    apiVersion: GOOGLE_ADS_SIGNED_DELIVERY.apiVersion,
  });
  const rows = [];
  const maximum = GOOGLE_ADS_SIGNED_DELIVERY.datasetLimits[datasetKey];
  while (iterator.hasNext()) {
    if (rows.length >= maximum) {
      throw new Error(`${datasetKey} exceeds the bounded v1 dataset cap`);
    }
    rows.push(mapper(iterator.next()));
  }
  return rows;
}

function mapAccountRow_(row) {
  return {
    customerId: idText_(readPath_(row, 'customer.id')),
    descriptiveName: textOrNull_(readPath_(row, 'customer.descriptiveName')),
    currencyCode: requiredText_(readPath_(row, 'customer.currencyCode'), 'currencyCode'),
    timeZone: requiredText_(readPath_(row, 'customer.timeZone'), 'timeZone'),
    status: textOrNull_(readPath_(row, 'customer.status')),
    isManager: Boolean(readPath_(row, 'customer.manager')),
    isTestAccount: Boolean(readPath_(row, 'customer.testAccount')),
    resourceName: textOrNull_(readPath_(row, 'customer.resourceName')),
  };
}

function mapCampaignRow_(row) {
  const budgetResource = textOrNull_(readPath_(row, 'campaign.campaignBudget'));
  return {
    campaignId: idText_(readPath_(row, 'campaign.id')),
    campaignName: textOrNull_(readPath_(row, 'campaign.name')),
    status: textOrNull_(readPath_(row, 'campaign.status')),
    primaryStatus: textOrNull_(readPath_(row, 'campaign.primaryStatus')),
    servingStatus: textOrNull_(readPath_(row, 'campaign.servingStatus')),
    advertisingChannelType: textOrNull_(readPath_(row, 'campaign.advertisingChannelType')),
    advertisingChannelSubType: textOrNull_(
      readPath_(row, 'campaign.advertisingChannelSubType'),
    ),
    startDate: null,
    endDate: null,
    biddingStrategyType: textOrNull_(readPath_(row, 'campaign.biddingStrategyType')),
    campaignBudgetId: resourceIdOrNull_(budgetResource),
    campaignBudgetResourceName: budgetResource,
    resourceName: textOrNull_(readPath_(row, 'campaign.resourceName')),
  };
}

function mapAssetGroupRow_(row) {
  return {
    assetGroupId: idText_(readPath_(row, 'assetGroup.id')),
    campaignId: idText_(readPath_(row, 'campaign.id')),
    assetGroupName: textOrNull_(readPath_(row, 'assetGroup.name')),
    status: textOrNull_(readPath_(row, 'assetGroup.status')),
    resourceName: textOrNull_(readPath_(row, 'assetGroup.resourceName')),
  };
}

function mapAdGroupRow_(row) {
  return {
    adGroupId: idText_(readPath_(row, 'adGroup.id')),
    campaignId: idText_(readPath_(row, 'campaign.id')),
    adGroupName: textOrNull_(readPath_(row, 'adGroup.name')),
    status: textOrNull_(readPath_(row, 'adGroup.status')),
    primaryStatus: textOrNull_(readPath_(row, 'adGroup.primaryStatus')),
    type: textOrNull_(readPath_(row, 'adGroup.type')),
    resourceName: textOrNull_(readPath_(row, 'adGroup.resourceName')),
  };
}

function mapAdRow_(row) {
  const finalUrls = readPath_(row, 'adGroupAd.ad.finalUrls');
  return {
    adId: idText_(readPath_(row, 'adGroupAd.ad.id')),
    adGroupId: idText_(readPath_(row, 'adGroup.id')),
    campaignId: idText_(readPath_(row, 'campaign.id')),
    adName: textOrNull_(readPath_(row, 'adGroupAd.ad.name')),
    status: textOrNull_(readPath_(row, 'adGroupAd.status')),
    primaryStatus: textOrNull_(readPath_(row, 'adGroupAd.primaryStatus')),
    type: textOrNull_(readPath_(row, 'adGroupAd.ad.type')),
    finalUrls: Array.isArray(finalUrls)
      ? finalUrls.map((value) => requiredText_(value, 'finalUrl')).slice(0, 20)
      : null,
    displayUrl: textOrNull_(readPath_(row, 'adGroupAd.ad.displayUrl')),
    resourceName: textOrNull_(readPath_(row, 'adGroupAd.resourceName')),
  };
}

function mapYoutubeAssetRow_(row) {
  return {
    assetId: idText_(readPath_(row, 'asset.id')),
    assetName: textOrNull_(readPath_(row, 'asset.name')),
    // Resource `asset` ไม่มี selectable status; linkage status เป็นคนละ Grain.
    status: null,
    assetType: requiredText_(readPath_(row, 'asset.type'), 'assetType'),
    youtubeVideoId: textOrNull_(readPath_(row, 'asset.youtubeVideoAsset.youtubeVideoId')),
    youtubeVideoTitle: textOrNull_(
      readPath_(row, 'asset.youtubeVideoAsset.youtubeVideoTitle'),
    ),
    resourceName: textOrNull_(readPath_(row, 'asset.resourceName')),
  };
}

function mapCampaignDailyRow_(row, currency) {
  const channelType = requiredText_(
    readPath_(row, 'campaign.advertisingChannelType'),
    'advertisingChannelType',
  );
  const campaignId = idText_(readPath_(row, 'campaign.id'));
  return {
    metricDate: requiredText_(readPath_(row, 'segments.date'), 'metricDate'),
    reportLevel: 'campaign',
    externalEntityId: campaignId,
    campaignId,
    adGroupId: null,
    adId: null,
    advertisingChannelType: channelType,
    advertisingChannelSubType: textOrNull_(
      readPath_(row, 'campaign.advertisingChannelSubType'),
    ),
    adChannel: deriveAdChannel_(channelType),
    segmentKey: 'all',
    currency,
    spendMicros: integerOrNull_(readPath_(row, 'metrics.costMicros')),
    impressions: integerOrNull_(readPath_(row, 'metrics.impressions')),
    clicks: integerOrNull_(readPath_(row, 'metrics.clicks')),
    conversions: numberOrNull_(readPath_(row, 'metrics.conversions')),
    conversionValueMicros: decimalToMicrosOrNull_(
      readPath_(row, 'metrics.conversionsValue'),
    ),
    videoViews: integerOrNull_(readPath_(row, 'metrics.videoTrueviewViews')),
    videoViewRate: numberOrNull_(readPath_(row, 'metrics.videoTrueviewViewRate')),
    averageCpvMicros: decimalToMicrosOrNull_(
      readPath_(row, 'metrics.trueviewAverageCpv'),
    ),
  };
}

function planSignedChunks_(datasets, config, runStartedAt) {
  const chunkRows = {};
  const manifest = {};
  let totalChunks = 0;
  for (const [datasetKey, rows] of Object.entries(datasets)) {
    chunkRows[datasetKey] = splitBoundedRows_(rows);
    manifest[datasetKey] = {
      totalRows: rows.length,
      chunkCount: chunkRows[datasetKey].length,
    };
    totalChunks += chunkRows[datasetKey].length;
  }
  if (totalChunks > GOOGLE_ADS_SIGNED_DELIVERY.chunksPerRun) {
    throw new Error('Signed delivery exceeds the maximum chunks per run');
  }

  const runId = Utilities.getUuid().toLowerCase();
  const chunks = [];
  for (const datasetKey of Object.keys(datasets)) {
    const groups = chunkRows[datasetKey];
    for (let index = 0; index < groups.length; index += 1) {
      const envelope = {
        schemaVersion: GOOGLE_ADS_SIGNED_DELIVERY.schemaVersion,
        runId,
        mode: config.mode,
        runStartedAt,
        fetchedAt: new Date().toISOString(),
        managerCustomerId: config.managerCustomerId,
        customerId: config.customerId,
        customerKey: config.customerKey,
        accountKey: config.accountKey,
        sourceTimezone: config.sourceTimezone,
        manifest,
        dataset: {
          key: datasetKey,
          chunkIndex: index,
          chunkCount: groups.length,
          totalRows: datasets[datasetKey].length,
          rows: groups[index],
        },
      };
      const body = stableSerialize_(envelope);
      if (utf8Bytes_(body) > GOOGLE_ADS_SIGNED_DELIVERY.bodyBytes) {
        throw new Error(`${datasetKey} signed chunk exceeds the body byte limit`);
      }
      chunks.push(Object.freeze({ envelope, body }));
    }
  }
  return Object.freeze({ chunks: Object.freeze(chunks), manifest: Object.freeze(manifest) });
}

function splitBoundedRows_(rows) {
  if (rows.length === 0) return [];
  const chunks = [];
  let current = [];
  for (const row of rows) {
    const candidate = current.concat([row]);
    const candidateBytes = utf8Bytes_(stableSerialize_(candidate));
    if (
      current.length > 0
      && (
        candidate.length > GOOGLE_ADS_SIGNED_DELIVERY.rowsPerChunk
        || candidateBytes > GOOGLE_ADS_SIGNED_DELIVERY.rowChunkBytes
      )
    ) {
      chunks.push(current);
      current = [row];
    } else {
      current = candidate;
    }
    if (utf8Bytes_(stableSerialize_(current)) > GOOGLE_ADS_SIGNED_DELIVERY.rowChunkBytes) {
      throw new Error('One source row exceeds the bounded chunk byte limit');
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function stampChunkForDelivery_(chunk) {
  const envelope = {
    ...chunk.envelope,
    fetchedAt: new Date().toISOString(),
  };
  const body = stableSerialize_(envelope);
  if (utf8Bytes_(body) > GOOGLE_ADS_SIGNED_DELIVERY.bodyBytes) {
    throw new Error(`${envelope.dataset.key} signed chunk exceeds the body byte limit`);
  }
  return Object.freeze({ envelope: Object.freeze(envelope), body });
}

function deliverSignedChunk_(chunk, config) {
  const idempotencyKey = [
    'google-ads',
    chunk.envelope.runId,
    chunk.envelope.dataset.key,
    chunk.envelope.dataset.chunkIndex,
  ].join(':');
  const contentSha256 = sha256Hex_(chunk.body);
  const retryDelaysMs = [1000, 2000, 4000];
  let lastError = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = createNonce_();
    const signingInput = [
      'MKT-HMAC-SHA256-V1',
      'POST',
      GOOGLE_ADS_SIGNED_DELIVERY.endpointPath,
      timestamp,
      nonce,
      idempotencyKey,
      contentSha256,
    ].join('\n');
    const signature = bytesToHex_(Utilities.computeHmacSha256Signature(
      signingInput,
      config.signingSecret,
      Utilities.Charset.UTF_8,
    ));

    try {
      const response = UrlFetchApp.fetch(config.endpoint, {
        method: 'post',
        contentType: 'application/json',
        payload: chunk.body,
        muteHttpExceptions: true,
        headers: {
          'x-mkt-key-id': config.keyId,
          'x-mkt-timestamp': timestamp,
          'x-mkt-nonce': nonce,
          'x-mkt-idempotency-key': idempotencyKey,
          'x-mkt-content-sha256': contentSha256,
          'x-mkt-signature': `sha256=${signature}`,
        },
      });
      const status = response.getResponseCode();
      if (status >= 200 && status < 300) return;
      if (status !== 429 && status < 500) {
        throw new Error(`Signed delivery failed permanently with HTTP ${status}`);
      }
      lastError = new Error(`Signed delivery retryable HTTP ${status}`);
    } catch (error) {
      lastError = error;
      if (/permanently/.test(String(error && error.message))) throw error;
    }

    if (attempt < retryDelaysMs.length) Utilities.sleep(retryDelaysMs[attempt]);
  }
  throw lastError || new Error('Signed delivery failed without a classified result');
}

function stableSerialize_(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON rejects non-finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize_(item === undefined ? null : item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize_(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Canonical JSON rejects ${typeof value}`);
}

function createNonce_() {
  const hex = Utilities.getUuid().replace(/-/g, '');
  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function sha256Hex_(value) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8,
  ));
}

function bytesToHex_(bytes) {
  return bytes.map((byte) => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function utf8Bytes_(value) {
  return Utilities.newBlob(String(value)).getBytes().length;
}

function assertDeliveryEndpoint_(value) {
  const endpoint = requiredText_(value, 'delivery endpoint');
  if (
    !endpoint.startsWith('https://')
    || !endpoint.endsWith(GOOGLE_ADS_SIGNED_DELIVERY.endpointPath)
    || endpoint.includes('?')
    || endpoint.includes('#')
  ) {
    throw new Error('MKT_GOOGLE_ADS_DELIVERY_ENDPOINT is invalid');
  }
}

function readPath_(value, path) {
  let current = value;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return null;
    current = current[part];
  }
  return current === undefined ? null : current;
}

function deriveAdChannel_(value) {
  const channel = String(value).toUpperCase();
  if (channel === 'SEARCH') return 'google_search_ads';
  if (channel === 'DISPLAY') return 'google_display_ads';
  if (channel === 'VIDEO') return 'youtube_ads';
  return 'google_other';
}

function resourceIdOrNull_(value) {
  if (value === null) return null;
  const parts = String(value).split('/');
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function idText_(value) {
  const text = requiredText_(value, 'id');
  if (!/^\d+$/.test(text)) throw new Error('Google Ads ID must contain digits only');
  return text;
}

function integerOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error('Metric must be a non-negative safe integer');
  }
  return number;
}

function numberOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error('Metric must be a non-negative finite number');
  }
  return number;
}

function decimalToMicrosOrNull_(value) {
  const number = numberOrNull_(value);
  if (number === null) return null;
  const micros = Math.round(number * 1000000);
  if (!Number.isSafeInteger(micros)) throw new Error('Money micros exceed safe integer range');
  return micros;
}

function textOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function requiredText_(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
}

function normalizeCustomerId_(value) {
  return String(value || '').replace(/\D/g, '');
}

function requireCustomerIdProperty_(properties, name) {
  const value = normalizeCustomerId_(requireProperty_(properties, name));
  if (!/^\d{10}$/.test(value)) throw new Error(`${name} must contain exactly 10 digits`);
  return value;
}

function requireProperty_(properties, name) {
  const value = optionalProperty_(properties, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalProperty_(properties, name) {
  const value = properties.getProperty(name);
  return value === null || String(value).trim() === '' ? null : String(value).trim();
}

function readBooleanProperty_(properties, name, fallback) {
  const value = optionalProperty_(properties, name);
  if (value === null) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}
