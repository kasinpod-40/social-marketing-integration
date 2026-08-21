import {
  GOOGLE_ADS_MANAGER_DATASET_KEYS,
  validateGoogleAdsManagerDeliveryRun,
} from '../../../config/src/google-ads-manager-script-delivery-contract.js';
import {
  createAdsDailyRow,
} from '../../../domain/src/entities/ads.js';
import {
  createAdsEntityKey,
  createAdsFactKey,
  createCoverageEntityKey,
} from '../storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import {
  dateOnlyInTimeZoneToEpochMilliseconds,
} from '../../../shared/src/date/date-time.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const ENTITY_DATASETS = Object.freeze({
  account: 'account',
  campaigns: 'campaign',
  adGroups: 'ad_group',
  ads: 'ad',
  youtubeAssets: 'creative',
});

/** Reconstruct one bounded six-dataset run after transport authentication and cross-chunk validation. */
export function assembleGoogleAdsLiveRun(values) {
  const summary = validateGoogleAdsManagerDeliveryRun(values);
  if (summary.mode !== 'LIVE') {
    throw permanentError('Only Google Ads LIVE runs can enter business processing', {
      code: 'GOOGLE_ADS_PREVIEW_QUEUE_FORBIDDEN',
    });
  }
  const envelopes = values.map((value) => requireObject(value, 'envelope'));
  const first = envelopes[0];
  const datasets = {};
  for (const key of GOOGLE_ADS_MANAGER_DATASET_KEYS) {
    datasets[key] = Object.freeze(envelopes
      .filter((envelope) => envelope.dataset.key === key)
      .sort((left, right) => left.dataset.chunkIndex - right.dataset.chunkIndex)
      .flatMap((envelope) => envelope.dataset.rows));
  }
  return deepFreeze({
    schemaVersion: first.schemaVersion,
    runId: first.runId,
    mode: first.mode,
    runStartedAt: first.runStartedAt,
    fetchedAt: envelopes.reduce(
      (latest, envelope) => envelope.fetchedAt > latest ? envelope.fetchedAt : latest,
      first.fetchedAt,
    ),
    managerCustomerId: normalizeCustomerId(first.managerCustomerId),
    customerId: normalizeCustomerId(first.customerId),
    customerKey: first.customerKey,
    accountKey: first.accountKey,
    sourceTimezone: first.sourceTimezone,
    manifest: first.manifest,
    datasets,
    summary,
  });
}

/** Build every D1 row before the first write. */
export async function buildGoogleAdsD1WriteSet(input = {}) {
  const run = requireRun(input.run);
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const now = requireTimestamp(input.now, 'now');
  const fetchedAt = Date.parse(run.fetchedAt);
  const account = run.datasets.account[0];
  const coverageRuns = [];
  const coverageEntities = [];
  const entities = [];
  const dailyFacts = [];

  for (const [datasetKey, entityType] of Object.entries(ENTITY_DATASETS)) {
    const sourceRows = run.datasets[datasetKey];
    const coverageRunId = coverageId(run.runId, datasetKey);
    const normalized = datasetKey === 'account'
      ? [entityCandidate({ run, account, row: account, entityType, externalId: run.customerId })]
      : sourceRows.map((row) => entityCandidate({
        run,
        account,
        row,
        entityType,
        externalId: externalIdFor(datasetKey, row),
      }));

    for (const candidate of normalized) {
      const metadataHash = await fingerprint(candidate.metadata);
      entities.push(Object.freeze({
        entity_key: createAdsEntityKey({
          platform: 'google_ads',
          account_key: run.accountKey,
          entity_type: candidate.entityType,
          external_entity_id: candidate.externalEntityId,
        }),
        customer_key: run.customerKey,
        platform: 'google_ads',
        account_key: run.accountKey,
        source_account_id: run.customerId,
        entity_type: candidate.entityType,
        external_entity_id: candidate.externalEntityId,
        parent_campaign_id: candidate.parentCampaignId,
        parent_ad_group_id: candidate.parentAdGroupId,
        parent_ad_id: candidate.parentAdId,
        external_creative_id: candidate.externalCreativeId,
        entity_name: candidate.entityName,
        status: candidate.status,
        objective: candidate.objective,
        currency: candidate.currency,
        timezone: candidate.timezone,
        source_updated_at: null,
        first_seen_at: fetchedAt,
        last_seen_at: fetchedAt,
        source_availability_status: 'available',
        metadata_hash: metadataHash,
        last_coverage_run_id: coverageRunId,
        last_sync_run_id: syncRunId,
        created_at: now,
        updated_at: now,
      }));
      coverageEntities.push(coverageEntity({
        coverageRunId,
        entityType: candidate.entityType,
        externalEntityId: candidate.externalEntityId,
        sourceRevision: run.runId,
        observedAt: fetchedAt,
        createdAt: now,
      }));
    }
    coverageRuns.push(coverageRun({
      run,
      syncRunId,
      coverageRunId,
      datasetKey,
      metricSemantics: 'snapshot',
      scopeMode: 'full_inventory',
      expected: normalized.length,
      startedAt: Date.parse(run.runStartedAt),
      completedAt: now,
      sourceWatermark: run.runId,
      now,
    }));
  }

  const dailyCoverageRunId = coverageId(run.runId, 'campaignDailyMetrics');
  for (const row of run.datasets.campaignDailyMetrics) {
    const sourcePayloadHash = await fingerprint(row);
    const externalEntityId = requireText(row.externalEntityId, 'externalEntityId');
    const segmentKey = identityPart(row.segmentKey ?? 'all');
    dailyFacts.push(Object.freeze({
      ads_fact_key: createAdsFactKey({
        platform: 'google_ads',
        account_key: run.accountKey,
        report_level: 'campaign',
        external_entity_id: externalEntityId,
        metric_date: row.metricDate,
        breakdown_key: 'all',
        segment_key: segmentKey,
      }),
      customer_key: run.customerKey,
      platform: 'google_ads',
      account_key: run.accountKey,
      source_account_id: run.customerId,
      report_level: 'campaign',
      entity_type: 'campaign',
      external_entity_id: externalEntityId,
      external_campaign_id: row.campaignId,
      external_ad_group_id: null,
      external_ad_id: null,
      external_creative_id: null,
      metric_date: row.metricDate,
      account_timezone: run.sourceTimezone,
      breakdown_key: 'all',
      segment_key: segmentKey,
      ad_channel: row.adChannel,
      currency: row.currency,
      spend_micros: nullableInteger(row.spendMicros),
      impressions: nullableInteger(row.impressions),
      reach: null,
      clicks: nullableInteger(row.clicks),
      conversions: nullableNumber(row.conversions),
      conversion_value_micros: nullableInteger(row.conversionValueMicros),
      video_views: nullableInteger(row.videoViews),
      video_view_rate: nullableNumber(row.videoViewRate),
      average_cpv_micros: nullableInteger(row.averageCpvMicros),
      actions_json: null,
      breakdown_json: null,
      data_status: 'revisable',
      coverage_run_id: dailyCoverageRunId,
      source_revision: run.runId,
      source_payload_hash: sourcePayloadHash,
      fetched_at: fetchedAt,
      sync_run_id: syncRunId,
      created_at: now,
      updated_at: now,
    }));
    coverageEntities.push(coverageEntity({
      coverageRunId: dailyCoverageRunId,
      entityType: 'campaign_daily',
      externalEntityId: `${externalEntityId}:${row.metricDate}:${segmentKey}`,
      sourceRevision: run.runId,
      observedAt: fetchedAt,
      createdAt: now,
    }));
  }
  const dates = run.datasets.campaignDailyMetrics.map((row) => row.metricDate).sort();
  coverageRuns.push(coverageRun({
    run,
    syncRunId,
    coverageRunId: dailyCoverageRunId,
    datasetKey: 'campaignDailyMetrics',
    metricSemantics: 'period',
    scopeMode: 'report_range',
    expected: dailyFacts.length,
    periodStart: dates[0] ?? null,
    periodEnd: dates.at(-1) ?? null,
    startedAt: Date.parse(run.runStartedAt),
    completedAt: now,
    sourceWatermark: run.runId,
    now,
  }));

  return deepFreeze({
    entities,
    dailyFacts,
    conversionFacts: [],
    coverageRuns,
    coverageEntities,
  });
}

/** Build only customer-facing Canonical Lark rows; D1 owns raw/source facts. */
export function buildGoogleAdsLarkWriteSet(input = {}) {
  const run = requireRun(input.run);
  const account = run.datasets.account[0];
  const campaignById = new Map(run.datasets.campaigns.map((row) => [row.campaignId, row]));

  const accounts = [compact({
    ads_account_key: canonicalEntityKey(run.customerId, 'account', run.customerId),
    platform: 'google_ads',
    account_id: run.customerId,
    account_name: account.descriptiveName,
    currency: account.currencyCode,
    timezone: account.timeZone,
    status: normalizeGoogleAdsStatus(account.status),
    manager_account_id: run.managerCustomerId,
    is_test_account: account.isTestAccount,
    account_link_status: 'selectable',
  })];
  const campaigns = run.datasets.campaigns.map((row) => compact({
    ads_campaign_key: canonicalEntityKey(run.customerId, 'campaign', row.campaignId),
    platform: 'google_ads',
    ad_channel: mapCanonicalAdChannel(row.advertisingChannelType, row.advertisingChannelSubType),
    account_id: run.customerId,
    external_campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    objective: row.advertisingChannelSubType,
    status: normalizeGoogleAdsStatus(row.status),
    channel_subtype: row.advertisingChannelSubType,
    start_date: larkOptionalDate(row.startDate, run.sourceTimezone, 'Google Ads campaign startDate'),
    end_date: larkOptionalDate(row.endDate, run.sourceTimezone, 'Google Ads campaign endDate'),
    bidding_strategy_type: row.biddingStrategyType,
  }));
  const adGroups = run.datasets.adGroups.map((row) => compact({
    ads_ad_group_key: canonicalEntityKey(run.customerId, 'ad_group', row.adGroupId),
    platform: 'google_ads',
    account_id: run.customerId,
    external_campaign_id: row.campaignId,
    external_ad_group_id: row.adGroupId,
    ad_group_name: row.adGroupName,
    status: normalizeGoogleAdsStatus(row.status),
    ad_group_type: row.type,
  }));
  const ads = run.datasets.ads.map((row) => compact({
    ads_ad_key: canonicalEntityKey(run.customerId, 'ad', row.adId),
    platform: 'google_ads',
    account_id: run.customerId,
    external_campaign_id: row.campaignId,
    external_ad_group_id: row.adGroupId,
    external_ad_id: row.adId,
    external_creative_id: null,
    ad_name: row.adName,
    status: normalizeGoogleAdsStatus(row.status),
    ad_type: row.type,
    final_url: firstArrayValue(row.finalUrls),
  }));
  const creatives = run.datasets.youtubeAssets.map((row) => compact({
    ads_creative_key: canonicalEntityKey(run.customerId, 'creative', row.assetId),
    platform: 'google_ads',
    account_id: run.customerId,
    external_creative_id: row.assetId,
    creative_name: row.assetName,
    creative_type: mapCreativeType(row.assetType),
    status: normalizeGoogleAdsStatus(row.status),
    source_content_id: row.youtubeVideoId,
  }));
  const daily = run.datasets.campaignDailyMetrics.map((row) => {
    const canonical = createAdsDailyRow({
      platform: 'google_ads',
      accountId: run.customerId,
      entityType: row.reportLevel ?? 'campaign',
      externalEntityId: row.externalEntityId,
      metricDate: row.metricDate,
      sourceTimezone: run.sourceTimezone,
      adChannel: canonicalDailyChannel(row, campaignById),
      externalCampaignId: row.campaignId,
      externalAdGroupId: row.adGroupId,
      externalAdId: row.adId,
      externalCreativeId: null,
      currency: row.currency,
      spendMicros: row.spendMicros,
      impressions: row.impressions,
      reach: null,
      clicks: row.clicks,
      conversions: row.conversions,
      conversionValueMicros: row.conversionValueMicros,
    });
    return compact({
      ...canonical,
      video_views: nullableInteger(row.videoViews),
      video_view_rate: nullableNumber(row.videoViewRate),
      average_cpv: microsToCurrencyUnits(row.averageCpvMicros),
    });
  });

  return deepFreeze({
    canonical: { accounts, campaigns, adGroups, ads, creatives, daily },
  });
}

function entityCandidate({ run, account, row, entityType, externalId }) {
  const metadata = compact({
    entityType,
    externalId,
    parentCampaignId: row.campaignId ?? null,
    parentAdGroupId: row.adGroupId ?? null,
    entityName: row.descriptiveName ?? row.campaignName ?? row.adGroupName ?? row.adName ?? row.assetName ?? null,
    status: row.status ?? null,
    objective: row.advertisingChannelSubType ?? null,
    currency: account.currencyCode,
    timezone: account.timeZone,
    resourceName: row.resourceName ?? null,
  });
  return Object.freeze({
    entityType,
    externalEntityId: externalId,
    parentCampaignId: entityType === 'campaign' ? null : row.campaignId ?? null,
    parentAdGroupId: entityType === 'ad' ? row.adGroupId ?? null : null,
    parentAdId: null,
    externalCreativeId: null,
    entityName: metadata.entityName,
    status: metadata.status,
    objective: metadata.objective,
    currency: account.currencyCode,
    timezone: account.timeZone,
    metadata,
  });
}

function coverageRun(input) {
  return Object.freeze({
    coverage_run_id: input.coverageRunId,
    sync_run_id: input.syncRunId,
    customer_key: input.run.customerKey,
    platform: 'google_ads',
    account_key: input.run.accountKey,
    dataset_key: input.datasetKey,
    metric_semantics: input.metricSemantics,
    scope_mode: input.scopeMode,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    source_timezone: input.run.sourceTimezone,
    status: 'complete',
    expected_entities: input.expected,
    observed_entities: input.expected,
    expected_rows: input.expected,
    observed_rows: input.expected,
    written_rows: input.expected,
    failed_rows: 0,
    source_watermark: input.sourceWatermark,
    revisable_until: input.datasetKey === 'campaignDailyMetrics'
      ? input.completedAt + (35 * 24 * 60 * 60 * 1_000)
      : null,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    error_code: null,
    created_at: input.now,
    updated_at: input.now,
  });
}

function coverageEntity(input) {
  return Object.freeze({
    coverage_entity_key: createCoverageEntityKey({
      coverage_run_id: input.coverageRunId,
      entity_type: input.entityType,
      external_entity_id: input.externalEntityId,
    }),
    coverage_run_id: input.coverageRunId,
    entity_type: input.entityType,
    external_entity_id: input.externalEntityId,
    observation_status: 'observed',
    source_revision: input.sourceRevision,
    observed_at: input.observedAt,
    created_at: input.createdAt,
  });
}

function coverageId(runId, datasetKey) {
  return `google_ads:${runId}:${datasetKey}`;
}

function externalIdFor(datasetKey, row) {
  const field = {
    campaigns: 'campaignId',
    adGroups: 'adGroupId',
    ads: 'adId',
    youtubeAssets: 'assetId',
  }[datasetKey];
  return requireText(row?.[field], field);
}

function canonicalEntityKey(accountId, entityType, externalId) {
  return ['google_ads', accountId, entityType, externalId].join(':');
}

function larkMetricDate(metricDate, sourceTimezone) {
  return dateOnlyInTimeZoneToEpochMilliseconds(metricDate, sourceTimezone, {
    label: 'Google Ads metricDate',
  });
}

function larkOptionalDate(value, sourceTimezone, label) {
  const date = optionalText(value);
  return date === null
    ? null
    : dateOnlyInTimeZoneToEpochMilliseconds(date, sourceTimezone, { label });
}

function mapCanonicalAdChannel(value, subtype, fallback = null) {
  const normalized = optionalText(value)?.toUpperCase();
  const normalizedSubtype = optionalText(subtype)?.toUpperCase();
  if (normalized === 'SEARCH') return 'google_search_ads';
  if (normalized === 'DISPLAY' && (normalizedSubtype?.includes('DEMAND_GEN')
    || normalizedSubtype?.includes('DISCOVERY'))) return 'google_demand_gen_ads';
  if (normalized === 'DISPLAY') return 'google_display_ads';
  if (normalized === 'VIDEO') return 'youtube_ads';
  if (normalized === 'DEMAND_GEN'
    || normalizedSubtype?.includes('DEMAND_GEN')
    || normalizedSubtype?.includes('DISCOVERY')) return 'google_demand_gen_ads';
  if (normalized === 'PERFORMANCE_MAX') return 'google_performance_max_ads';
  if (normalized === 'SHOPPING') return 'google_shopping_ads';
  if (normalized === 'APP' || normalized === 'MULTI_CHANNEL') return 'google_app_ads';
  return normalizeCanonicalAdChannel(fallback);
}

function canonicalDailyChannel(row, campaignById) {
  const campaign = campaignById.get(row.campaignId);
  return mapCanonicalAdChannel(
    campaign?.advertisingChannelType,
    campaign?.advertisingChannelSubType,
    row.adChannel,
  );
}

function normalizeCanonicalAdChannel(value) {
  const channel = optionalText(value)?.toLowerCase();
  if ([
    'youtube_ads',
    'google_search_ads',
    'google_display_ads',
    'google_demand_gen_ads',
    'google_performance_max_ads',
    'google_shopping_ads',
    'google_app_ads',
    'google_other_ads',
  ].includes(channel)) return channel;
  if (channel === 'google_other') return 'google_other_ads';
  return 'google_other_ads';
}

function normalizeGoogleAdsStatus(value) {
  const status = optionalText(value)?.toUpperCase();
  if (status === 'ENABLED') return 'active';
  if (status === 'PAUSED') return 'paused';
  if (['REMOVED', 'CANCELED', 'CANCELLED', 'CLOSED', 'ENDED'].includes(status)) return 'removed';
  return 'unknown';
}

function mapCreativeType(value) {
  const type = optionalText(value)?.toUpperCase();
  if (type === 'YOUTUBE_VIDEO' || type === 'VIDEO') return 'video';
  if (type === 'IMAGE') return 'image';
  if (type === 'CAROUSEL') return 'carousel';
  return 'other';
}

function firstArrayValue(value) {
  return Array.isArray(value) ? optionalText(value[0]) : null;
}

function microsToCurrencyUnits(value) {
  const micros = nullableInteger(value);
  return micros === null ? null : micros / 1_000_000;
}

async function fingerprint(value) {
  return createStableFingerprint(value, {
    digestImpl: globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle),
  });
}

function compact(value) {
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)));
}

function identityPart(value) {
  return requireText(value, 'identityPart').replaceAll(':', '=');
}

function nullableInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('metric must be a non-negative safe integer');
  return number;
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError('metric must be a non-negative finite number');
  return number;
}

function normalizeCustomerId(value) {
  return requireText(value, 'customerId').replaceAll('-', '');
}

function requireRun(value) {
  const run = requireObject(value, 'run');
  for (const field of ['runId', 'runStartedAt', 'fetchedAt', 'customerId', 'customerKey', 'accountKey', 'sourceTimezone']) {
    requireText(run[field], field);
  }
  if (!run.datasets || typeof run.datasets !== 'object') throw new TypeError('run.datasets is required');
  return run;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}