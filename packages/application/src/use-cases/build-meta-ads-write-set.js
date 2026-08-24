import {
  normalizeMetaAdsDailyFixture,
  normalizeMetaAdsEntityFixture,
} from './normalize-meta-ads-source.js';
import {
  calculateAdsDerivedMetrics,
  createAdsEntityKey as createCanonicalAdsEntityKey,
} from '../../../domain/src/entities/ads.js';
import {
  createAdsEntityKey,
  createCoverageEntityKey,
  validateStorageRow,
} from '../storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';

const DATASETS = Object.freeze([
  Object.freeze({ key: 'account', entityType: 'account', inputField: 'accountResource' }),
  Object.freeze({ key: 'campaigns', entityType: 'campaign', inputField: 'campaigns' }),
  Object.freeze({ key: 'ad_sets', entityType: 'ad_group', inputField: 'adSets' }),
  Object.freeze({ key: 'ads', entityType: 'ad', inputField: 'ads' }),
  Object.freeze({ key: 'creatives', entityType: 'creative', inputField: 'creatives' }),
]);
const ENTITY_SCOPE_MODES = new Set(['full_inventory', 'report_range']);
const LARK_PROJECTION_MODES = new Set(['detailed', 'curated_reports']);

/** Build Shared RAW, Canonical Lark and D1 rows for one complete Meta Ads snapshot. */
export async function buildMetaAdsWriteSet(input = {}) {
  const accountId = requireText(input.accountId, 'accountId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const operationId = requireText(input.operationId, 'operationId');
  const fetchedAt = requireTimestamp(input.fetchedAt, 'fetchedAt');
  const completedAt = requireTimestamp(input.completedAt ?? fetchedAt, 'completedAt');
  const sourceRevision = optionalText(input.sourceRevision) ?? operationId;
  const accountTimezone = requireText(input.accountTimezone, 'accountTimezone');
  const currency = requireCurrency(input.currency);
  const sourceWatermark = optionalText(input.sourceWatermark);
  const entityScopeMode = requireChoice(
    input.entityScopeMode ?? 'full_inventory',
    'entityScopeMode',
    ENTITY_SCOPE_MODES,
  );
  const larkProjectionMode = requireChoice(
    input.larkProjectionMode ?? 'detailed',
    'larkProjectionMode',
    LARK_PROJECTION_MODES,
  );
  const curatedLark = larkProjectionMode === 'curated_reports';
  const periodStart = entityScopeMode === 'report_range'
    ? requireDate(input.periodStart, 'periodStart')
    : null;
  const periodEnd = entityScopeMode === 'report_range'
    ? requireDate(input.periodEnd, 'periodEnd')
    : null;
  if (periodStart && periodStart > periodEnd) throw new TypeError('periodStart cannot be after periodEnd');

  const resourcesByDataset = {
    accountResource: [requireObject(input.accountResource, 'accountResource')],
    campaigns: requireArray(input.campaigns ?? [], 'campaigns'),
    adSets: requireArray(input.adSets ?? [], 'adSets'),
    ads: requireArray(input.ads ?? [], 'ads'),
    creatives: requireArray(input.creatives ?? [], 'creatives'),
  };

  const rawEntities = [];
  const d1Entities = [];
  const coverageRuns = [];
  const coverageEntities = [];
  const canonical = {
    adsAccounts: [],
    adsCampaigns: [],
    adsAdGroups: [],
    adsAds: [],
    adsCreatives: [],
    adsDaily: [],
  };

  const entityDatasets = DATASETS;
  for (const dataset of entityDatasets) {
    const resources = resourcesByDataset[dataset.inputField];
    const coverageRunId = `${operationId}:meta_ads:${accountId}:${dataset.key}`;
    for (const resource of resources) {
      const normalized = normalizeMetaAdsEntityFixture({
        entityType: dataset.entityType,
        accountId,
        resource,
        fetchedAt,
        syncRunId,
      });
      rawEntities.push(normalized.rawRow);
      const metadataHash = await createStableFingerprint({
        schemaVersion: 'meta_ads_entity_metadata_v1',
        ...normalized.entityCandidate,
      });
      d1Entities.push(validateStorageRow('ads_entity_state', {
        entity_key: createAdsEntityKey({
          platform: 'meta_ads',
          account_key: accountKey,
          entity_type: dataset.entityType,
          external_entity_id: normalized.entityCandidate.externalEntityId,
        }),
        customer_key: customerKey,
        platform: 'meta_ads',
        account_key: accountKey,
        source_account_id: accountId,
        entity_type: dataset.entityType,
        external_entity_id: normalized.entityCandidate.externalEntityId,
        parent_campaign_id: normalized.entityCandidate.parentCampaignId,
        parent_ad_group_id: normalized.entityCandidate.parentAdGroupId,
        parent_ad_id: dataset.entityType === 'creative' ? null : optionalText(resource.ad_id),
        external_creative_id: normalized.entityCandidate.externalCreativeId,
        entity_name: normalized.entityCandidate.entityName,
        status: normalized.entityCandidate.status,
        objective: normalized.entityCandidate.objective,
        currency: normalized.entityCandidate.currency ?? currency,
        timezone: normalized.entityCandidate.timezone ?? accountTimezone,
        source_updated_at: normalized.entityCandidate.sourceUpdatedAt,
        first_seen_at: fetchedAt,
        last_seen_at: fetchedAt,
        source_availability_status: 'available',
        metadata_hash: metadataHash,
        last_coverage_run_id: coverageRunId,
        last_sync_run_id: syncRunId,
        created_at: completedAt,
        updated_at: completedAt,
      }));
      coverageEntities.push(coverageEntity({
        coverageRunId,
        entityType: dataset.entityType,
        externalEntityId: normalized.entityCandidate.externalEntityId,
        sourceRevision,
        observedAt: fetchedAt,
        createdAt: completedAt,
      }));
      appendCanonicalEntity(canonical, {
        dataset,
        accountId,
        accountTimezone,
        currency,
        fetchedAt,
        resource,
        candidate: normalized.entityCandidate,
      });
    }
    coverageRuns.push(coverageRun({
      coverageRunId,
      syncRunId,
      customerKey,
      accountKey,
      datasetKey: dataset.entityType === 'account'
        ? 'meta_ads.account.latest'
        : `meta_ads.${dataset.key}.${entityScopeMode === 'report_range' ? 'activity' : 'inventory'}`,
      metricSemantics: 'snapshot',
      scopeMode: dataset.entityType === 'account' ? 'full_inventory' : entityScopeMode,
      periodStart: dataset.entityType === 'account' ? null : periodStart,
      periodEnd: dataset.entityType === 'account' ? null : periodEnd,
      sourceTimezone: accountTimezone,
      expected: resources.length,
      sourceWatermark,
      sourceRevision,
      startedAt: fetchedAt,
      completedAt,
    }));
  }

  const rawDaily = [];
  const d1DailyFacts = [];
  const dailyInputs = requireArray(input.dailyInsights ?? [], 'dailyInsights');
  const dailyCoverageRunId = `${operationId}:meta_ads:${accountId}:performance_daily`;
  for (const resource of dailyInputs) {
    const normalized = normalizeMetaAdsDailyFixture({
      accountId,
      accountKey,
      accountTimezone,
      currency,
      resource,
      fetchedAt,
      syncRunId,
    });
    rawDaily.push(normalized.rawRow);
    const sourcePayloadHash = await createStableFingerprint({
      schemaVersion: 'meta_ads_daily_source_v1',
      resource,
    });
    d1DailyFacts.push(validateStorageRow('ads_daily_facts', {
      ads_fact_key: normalized.factCandidate.adsFactKey,
      customer_key: customerKey,
      platform: 'meta_ads',
      account_key: accountKey,
      source_account_id: accountId,
      report_level: normalized.factCandidate.reportLevel,
      entity_type: normalized.factCandidate.entityType,
      external_entity_id: normalized.factCandidate.externalEntityId,
      external_campaign_id: normalized.factCandidate.externalCampaignId,
      external_ad_group_id: normalized.factCandidate.externalAdGroupId,
      external_ad_id: normalized.factCandidate.externalAdId,
      external_creative_id: normalized.rawRow.external_creative_id,
      metric_date: normalized.factCandidate.metricDate,
      account_timezone: accountTimezone,
      breakdown_key: normalized.factCandidate.breakdownKey,
      segment_key: normalized.factCandidate.segmentKey,
      ad_channel: normalized.factCandidate.adChannel,
      currency,
      spend_micros: normalized.factCandidate.spendMicros,
      impressions: normalized.factCandidate.impressions,
      reach: normalized.factCandidate.reach,
      clicks: normalized.factCandidate.clicks,
      conversions: null,
      conversion_value_micros: null,
      video_views: null,
      video_view_rate: null,
      average_cpv_micros: null,
      actions_json: normalized.factCandidate.actionsJson,
      breakdown_json: normalized.rawRow.breakdown_json,
      data_status: 'revisable',
      coverage_run_id: dailyCoverageRunId,
      source_revision: sourceRevision,
      source_payload_hash: sourcePayloadHash,
      fetched_at: fetchedAt,
      sync_run_id: syncRunId,
      created_at: completedAt,
      updated_at: completedAt,
    }));
    coverageEntities.push(coverageEntity({
      coverageRunId: dailyCoverageRunId,
      entityType: 'ad_daily',
      externalEntityId: `${normalized.factCandidate.externalEntityId}:${normalized.factCandidate.metricDate}:${normalized.factCandidate.breakdownKey}`,
      sourceRevision,
      observedAt: fetchedAt,
      createdAt: completedAt,
    }));
  }

  coverageRuns.push(coverageRun({
    coverageRunId: dailyCoverageRunId,
    syncRunId,
    customerKey,
    accountKey,
    datasetKey: 'meta_ads.performance.daily',
    metricSemantics: 'period',
    scopeMode: 'report_range',
    sourceTimezone: accountTimezone,
    expected: dailyInputs.length,
    periodStart: periodStart ?? minimum(d1DailyFacts.map((row) => row.metric_date)),
    periodEnd: periodEnd ?? maximum(d1DailyFacts.map((row) => row.metric_date)),
    sourceWatermark,
    sourceRevision,
    startedAt: fetchedAt,
    completedAt,
  }));
  const canonicalDaily = aggregateCanonicalDaily({
    rawDaily,
    accountId,
    accountTimezone,
    currency,
  });
  canonical.adsDaily.push(...canonicalDaily);

  return deepFreeze({
    schemaVersion: 'meta_ads_write_set_v1',
    connectorKey: 'meta_ads',
    operationId,
    context: {
      customerKey,
      platform: 'meta_ads',
      accountKey,
      sourceAccountId: accountId,
      sourceTimezone: accountTimezone,
      fetchedAt,
      syncRunId,
      sourceRevision,
    },
    raw: {
      organicAccounts: [],
      organicContent: [],
      organicMetrics: [],
      adsEntities: rawEntities,
      adsDaily: curatedLark ? [] : rawDaily,
    },
    canonical: {
      accounts: [],
      accountDaily: [],
      content: [],
      contentDaily: [],
      ...canonical,
    },
    d1: {
      organicHistoryBatch: null,
      accountDailyFacts: [],
      adsEntities: d1Entities,
      adsDailyFacts: d1DailyFacts,
      coverageRuns,
      coverageEntities,
    },
    reconciliation: {
      sourceEntityRows: entityDatasets.reduce(
        (total, dataset) => total + resourcesByDataset[dataset.inputField].length,
        0,
      ),
      rawEntityRows: rawEntities.length,
      d1EntityRows: d1Entities.length,
      sourceDailyRows: dailyInputs.length,
      rawDailyRows: curatedLark ? 0 : rawDaily.length,
      d1DailyRows: d1DailyFacts.length,
      canonicalDailyRows: canonical.adsDaily.length,
      detailedDailyRows: d1DailyFacts.length,
      entityScopeMode,
      larkProjectionMode: curatedLark ? 'curated_reports' : 'detailed',
      campaignsStatus: resourcesByDataset.campaigns.length === 0 ? 'no_data_confirmed' : 'complete',
      spendStatus: dailyInputs.length === 0 ? 'no_data_confirmed' : 'revisable',
    },
  });
}

function appendCanonicalEntity(canonical, input) {
  const { dataset, accountId, accountTimezone, currency, fetchedAt, resource, candidate } = input;
  const key = createCanonicalAdsEntityKey({
    platform: 'meta_ads',
    accountId,
    entityType: dataset.entityType,
    externalEntityId: candidate.externalEntityId,
  });
  if (dataset.entityType === 'account') {
    canonical.adsAccounts.push(compact({
      ads_account_key: key,
      platform: 'meta_ads',
      account_id: accountId,
      account_name: candidate.entityName ?? resource.name,
      currency,
      timezone: accountTimezone,
      status: candidate.status,
      manager_account_id: null,
      is_test_account: null,
      account_link_status: 'selectable',
    }));
  } else if (dataset.entityType === 'campaign') {
    canonical.adsCampaigns.push(compact({
      ads_campaign_key: key,
      platform: 'meta_ads',
      ad_channel: null,
      account_id: accountId,
      external_campaign_id: candidate.externalEntityId,
      campaign_name: candidate.entityName,
      objective: candidate.objective,
      status: candidate.status,
      channel_subtype: null,
      start_date: optionalDateEpoch(resource.start_time, accountTimezone),
      end_date: optionalDateEpoch(resource.stop_time ?? resource.end_time, accountTimezone),
      bidding_strategy_type: optionalText(resource.bid_strategy),
    }));
  } else if (dataset.entityType === 'ad_group') {
    canonical.adsAdGroups.push(compact({
      ads_ad_group_key: key,
      platform: 'meta_ads',
      account_id: accountId,
      external_campaign_id: candidate.parentCampaignId,
      external_ad_group_id: candidate.externalEntityId,
      ad_group_name: candidate.entityName,
      status: candidate.status,
      ad_group_type: 'ad_set',
    }));
  } else if (dataset.entityType === 'ad') {
    canonical.adsAds.push(compact({
      ads_ad_key: key,
      platform: 'meta_ads',
      ad_channel: null,
      account_id: accountId,
      external_campaign_id: candidate.parentCampaignId,
      external_ad_group_id: candidate.parentAdGroupId,
      external_ad_id: candidate.externalEntityId,
      external_creative_id: candidate.externalCreativeId,
      ad_name: candidate.entityName,
      status: candidate.status,
      landing_page_url: optionalText(resource.landing_page_url),
      organic_content_id: optionalText(resource.effective_object_story_id),
      source_updated_at: candidate.sourceUpdatedAt,
      last_sync_at: fetchedAt,
    }));
  } else if (dataset.entityType === 'creative') {
    canonical.adsCreatives.push(compact({
      ads_creative_key: key,
      platform: 'meta_ads',
      account_id: accountId,
      external_creative_id: candidate.externalEntityId,
      creative_name: candidate.entityName,
      creative_type: normalizeMetaCreativeType(resource.object_type ?? resource.asset_type),
      status: candidate.status,
      source_content_id: optionalText(resource.effective_object_story_id),
      source_updated_at: candidate.sourceUpdatedAt,
    }));
  }
}

function normalizeMetaCreativeType(value) {
  const type = optionalText(value)?.toUpperCase();
  if (type === 'VIDEO') return 'video';
  if (['IMAGE', 'PHOTO'].includes(type)) return 'image';
  if (['CAROUSEL', 'CAROUSEL_CONTAINER'].includes(type)) return 'carousel';
  return 'other';
}

function aggregateCanonicalDaily(input) {
  const byIdentity = new Map();
  for (const row of input.rawDaily) {
    const key = `${row.external_entity_id}:${row.metric_date}`;
    const current = byIdentity.get(key) ?? {
      externalEntityId: row.external_entity_id,
      metricDate: row.metric_date,
      externalCampaignId: row.external_campaign_id,
      externalAdGroupId: row.external_ad_group_id,
      externalAdId: row.external_ad_id,
      externalCreativeId: row.external_creative_id,
      channels: new Set(),
      spendMicros: 0,
      spendObserved: false,
      impressions: 0,
      impressionsObserved: false,
      reach: 0,
      reachObserved: false,
      clicks: 0,
      clicksObserved: false,
    };
    if (row.ad_channel) current.channels.add(row.ad_channel);
    accumulate(current, 'spendMicros', 'spendObserved', row.spend_micros);
    accumulate(current, 'impressions', 'impressionsObserved', row.impressions);
    accumulate(current, 'reach', 'reachObserved', row.reach);
    accumulate(current, 'clicks', 'clicksObserved', row.clicks);
    byIdentity.set(key, current);
  }

  return [...byIdentity.values()].map((value) => {
    const metrics = {
      spend_micros: value.spendObserved ? value.spendMicros : null,
      impressions: value.impressionsObserved ? value.impressions : null,
      reach: value.channels.size <= 1 && value.reachObserved ? value.reach : null,
      clicks: value.clicksObserved ? value.clicks : null,
      conversions: null,
      conversion_value_micros: null,
    };
    return compact({
      ads_daily_key: `${createCanonicalAdsEntityKey({
        platform: 'meta_ads',
        accountId: input.accountId,
        entityType: 'ad',
        externalEntityId: value.externalEntityId,
      })}:${value.metricDate}`,
      metric_date: dateOnlyInTimeZoneToEpochMilliseconds(value.metricDate, input.accountTimezone, {
        label: 'Meta Ads metricDate',
      }),
      platform: 'meta_ads',
      ad_channel: value.channels.size === 1 ? [...value.channels][0] : null,
      account_id: input.accountId,
      entity_type: 'ad',
      external_entity_id: value.externalEntityId,
      external_campaign_id: value.externalCampaignId,
      external_ad_group_id: value.externalAdGroupId,
      external_ad_id: value.externalAdId,
      external_creative_id: value.externalCreativeId,
      currency: input.currency,
      ...metrics,
      spend: metrics.spend_micros === null ? null : metrics.spend_micros / 1_000_000,
      conversion_value: null,
      ...calculateAdsDerivedMetrics(metrics),
    });
  });
}

function coverageRun(input) {
  const status = input.expected === 0 ? 'no_data_confirmed' : 'complete';
  return validateStorageRow('data_coverage_runs', {
    coverage_run_id: input.coverageRunId,
    sync_run_id: input.syncRunId,
    customer_key: input.customerKey,
    platform: 'meta_ads',
    account_key: input.accountKey,
    dataset_key: input.datasetKey,
    metric_semantics: input.metricSemantics,
    scope_mode: input.scopeMode,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    source_timezone: input.sourceTimezone,
    status,
    expected_entities: input.expected,
    observed_entities: input.expected,
    expected_rows: input.expected,
    observed_rows: input.expected,
    written_rows: input.expected,
    failed_rows: 0,
    source_watermark: input.sourceWatermark,
    revisable_until: input.metricSemantics === 'period'
      ? input.completedAt + (35 * 24 * 60 * 60 * 1_000)
      : null,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    error_code: null,
    created_at: input.completedAt,
    updated_at: input.completedAt,
  });
}

function coverageEntity(input) {
  return validateStorageRow('data_coverage_entities', {
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

function accumulate(target, valueField, observedField, value) {
  if (value === null || value === undefined) return;
  target[valueField] += Number(value);
  target[observedField] = true;
}

function optionalDateEpoch(value, timeZone) {
  const text = optionalText(value);
  if (!text) return null;
  const date = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  return dateOnlyInTimeZoneToEpochMilliseconds(date, timeZone, { label: 'Meta Ads entity date' });
}

function minimum(values) {
  const sorted = values.filter(Boolean).sort();
  return sorted[0] ?? null;
}

function maximum(values) {
  const sorted = values.filter(Boolean).sort();
  return sorted.at(-1) ?? null;
}

function compact(value) {
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined && nested !== null)));
}

function requireCurrency(value) {
  const text = requireText(value, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(text)) throw new TypeError('currency must be ISO-4217');
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.has(text)) throw new TypeError(`${fieldName} is unsupported`);
  return text;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
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
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
