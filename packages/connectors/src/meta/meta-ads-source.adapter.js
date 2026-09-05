import {
  getMetaBusinessDatasetContract,
  META_BUSINESS_CONNECTOR_KEYS,
} from '../../../config/src/meta-business-ingestion-contract.js';
import {
  assertMetaIdentity,
  buildMetaDatasetPath,
  createMetaSourcePageEnvelope,
  deepFreeze,
  fieldsQuery,
  normalizeMetaAdAccountId,
  normalizeMetaDateRange,
  normalizeMetaPageOptions,
  requireMetaReadClient,
} from './meta-business-source.helpers.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const CONNECTOR_KEY = META_BUSINESS_CONNECTOR_KEYS.META_ADS;
const ENTITY_DATASETS = Object.freeze({
  campaigns: 'meta_ads.campaigns.inventory',
  adSets: 'meta_ads.ad_sets.inventory',
  ads: 'meta_ads.ads.inventory',
  creatives: 'meta_ads.creatives.inventory',
});
const ADS_DATE_CHUNK_DAYS = 31;
const ADS_MAX_HISTORY_DAYS = 366;
const ADS_HISTORY_CURSOR_PREFIX = 'mkt_meta_ads_history_v1?';

/** GET-only Meta Marketing source adapter; ไม่มี Method สำหรับ Campaign/Ad mutation */
export class MetaAdsSourceAdapter {
  constructor(input = {}) {
    this.client = requireMetaReadClient(input.client);
  }

  async fetchAccount(input = {}) {
    const accountId = normalizeMetaAdAccountId(input.adAccountId);
    const dataset = contract('meta_ads.account.latest');
    const resource = await this.client.get(
      buildMetaDatasetPath(dataset, { ad_account_id: accountId }),
      { fields: fieldsQuery(dataset) },
      { operationName: dataset.key },
    );
    assertMetaIdentity(
      normalizeMetaAdAccountId(resource?.account_id ?? resource?.id, 'providerAdAccountId'),
      accountId,
      'META_AD_ACCOUNT_IDENTITY_MISMATCH',
    );
    return deepFreeze({ datasetKey: dataset.key, sourceAccountId: accountId, resource });
  }

  async fetchCampaignsPage(input = {}) {
    return this.#fetchEntityPage('campaigns', input);
  }

  async fetchAdSetsPage(input = {}) {
    return this.#fetchEntityPage('adSets', input);
  }

  async fetchAdsPage(input = {}) {
    return this.#fetchEntityPage('ads', input);
  }

  async fetchCreativesPage(input = {}) {
    return this.#fetchEntityPage('creatives', input);
  }

  async fetchActivityCreative(input = {}) {
    const accountId = normalizeMetaAdAccountId(input.adAccountId);
    const adId = requireNumericId(input.adId, 'adId');
    const dataset = contract('meta_ads.creatives.activity_scoped');
    const resource = await this.client.get(
      adId,
      { fields: fieldsQuery(dataset) },
      { operationName: dataset.key },
    );
    assertMetaIdentity(requireNumericId(resource?.id, 'providerAdId'), adId, 'META_AD_IDENTITY_MISMATCH');
    assertMetaIdentity(
      normalizeMetaAdAccountId(resource?.account_id, 'providerAdAccountId'),
      accountId,
      'META_AD_ACCOUNT_IDENTITY_MISMATCH',
    );
    const creative = resource?.creative;
    return deepFreeze({
      datasetKey: dataset.key,
      sourceAccountId: accountId,
      resource: creative && typeof creative === 'object' ? { ...creative } : null,
    });
  }

  async fetchDailyInsightsPage(input = {}) {
    const accountId = normalizeMetaAdAccountId(input.adAccountId);
    const requestedRange = normalizeMetaDateRange(input, ADS_MAX_HISTORY_DAYS);
    if (!requestedRange.since) throw new TypeError('Meta Ads Insights requires since/until');
    const dataset = contract('meta_ads.performance.daily');
    const query = dataset.queryContract;

    // Preserve the reviewed single-chunk contract byte-for-byte for existing/pinned operations.
    if (inclusiveDays(requestedRange) <= ADS_DATE_CHUNK_DAYS) {
      const page = await this.#fetchDailyChunk({
        accountId,
        dataset,
        query,
        range: requestedRange,
        after: input.after,
        visitedCursors: input.visitedCursors,
      });
      return createMetaSourcePageEnvelope({
        datasetKey: dataset.key,
        sourceAccountId: accountId,
        page,
      });
    }

    const cursor = decodeAdsHistoryCursor(input.after, requestedRange);
    const page = await this.#fetchDailyChunk({
      accountId,
      dataset,
      query,
      range: { since: cursor.chunkSince, until: cursor.chunkUntil },
      after: cursor.providerAfter,
      visitedCursors: [],
    });
    const next = nextAdsHistoryCursor({
      requestedRange,
      cursor,
      providerHasMore: page.hasMore,
      providerNextCursor: page.nextCursor,
    });
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: accountId,
      page: {
        rows: page.rows,
        hasMore: next !== null,
        nextCursor: next,
      },
    });
  }

  async #fetchDailyChunk({ accountId, dataset, query, range, after, visitedCursors }) {
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset, { ad_account_id: accountId }),
      {
        fields: fieldsQuery(dataset),
        level: query.level,
        time_increment: query.timeIncrement,
        breakdowns: query.breakdowns.join(','),
        action_breakdowns: query.actionBreakdowns.join(','),
        time_range: JSON.stringify({ since: range.since, until: range.until }),
      },
      {
        after,
        visitedCursors,
        operationName: dataset.key,
      },
    );
    for (const row of page.rows) {
      assertMetaIdentity(
        normalizeMetaAdAccountId(row?.account_id, 'insights.account_id'),
        accountId,
        'META_AD_ACCOUNT_IDENTITY_MISMATCH',
      );
      assertDateInRange(row?.date_start, range, 'date_start');
      assertDateInRange(row?.date_stop, range, 'date_stop');
    }
    return page;
  }

  async #fetchEntityPage(datasetName, input) {
    const accountId = normalizeMetaAdAccountId(input.adAccountId);
    const dataset = contract(ENTITY_DATASETS[datasetName]);
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset, { ad_account_id: accountId }),
      { fields: fieldsQuery(dataset) },
      {
        ...normalizeMetaPageOptions(input),
        operationName: dataset.key,
      },
    );
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: accountId,
      page,
    });
  }
}

function requireNumericId(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must be numeric`);
  return text;
}

export function encodeAdsHistoryCursor(input = {}) {
  const values = new URLSearchParams({
    rootSince: requireDateOnly(input.rootSince, { label: 'Meta Ads history rootSince' }),
    rootUntil: requireDateOnly(input.rootUntil, { label: 'Meta Ads history rootUntil' }),
    chunkSince: requireDateOnly(input.chunkSince, { label: 'Meta Ads history chunkSince' }),
    chunkUntil: requireDateOnly(input.chunkUntil, { label: 'Meta Ads history chunkUntil' }),
    providerAfter: optionalCursor(input.providerAfter) ?? '',
  });
  return `${ADS_HISTORY_CURSOR_PREFIX}${values.toString()}`;
}

export function decodeAdsHistoryCursor(value, requestedRange) {
  const range = normalizeMetaDateRange(requestedRange, ADS_MAX_HISTORY_DAYS);
  if (!range.since) throw new TypeError('Meta Ads history range is required');
  if (value === null || value === undefined || value === '') {
    return deepFreeze({
      chunkSince: range.since,
      chunkUntil: minDate(addDays(range.since, ADS_DATE_CHUNK_DAYS - 1), range.until),
      providerAfter: null,
    });
  }
  if (typeof value !== 'string' || !value.startsWith(ADS_HISTORY_CURSOR_PREFIX)) {
    throw new TypeError('Meta Ads multi-month history cursor is invalid');
  }
  const params = new URLSearchParams(value.slice(ADS_HISTORY_CURSOR_PREFIX.length));
  const rootSince = requireDateOnly(params.get('rootSince'), { label: 'Meta Ads history rootSince' });
  const rootUntil = requireDateOnly(params.get('rootUntil'), { label: 'Meta Ads history rootUntil' });
  const chunkSince = requireDateOnly(params.get('chunkSince'), { label: 'Meta Ads history chunkSince' });
  const chunkUntil = requireDateOnly(params.get('chunkUntil'), { label: 'Meta Ads history chunkUntil' });
  if (rootSince !== range.since || rootUntil !== range.until) {
    throw new TypeError('Meta Ads history cursor belongs to another date range');
  }
  if (chunkSince < range.since || chunkUntil > range.until || chunkUntil < chunkSince) {
    throw new TypeError('Meta Ads history cursor chunk is outside the requested range');
  }
  if (inclusiveDays({ since: chunkSince, until: chunkUntil }) > ADS_DATE_CHUNK_DAYS) {
    throw new TypeError('Meta Ads history cursor exceeds the 31-day chunk contract');
  }
  return deepFreeze({
    chunkSince,
    chunkUntil,
    providerAfter: optionalCursor(params.get('providerAfter')),
  });
}

function nextAdsHistoryCursor({ requestedRange, cursor, providerHasMore, providerNextCursor }) {
  if (providerHasMore) {
    return encodeAdsHistoryCursor({
      rootSince: requestedRange.since,
      rootUntil: requestedRange.until,
      chunkSince: cursor.chunkSince,
      chunkUntil: cursor.chunkUntil,
      providerAfter: requireProviderCursor(providerNextCursor),
    });
  }
  if (cursor.chunkUntil >= requestedRange.until) return null;
  const chunkSince = addDays(cursor.chunkUntil, 1);
  const chunkUntil = minDate(
    addDays(chunkSince, ADS_DATE_CHUNK_DAYS - 1),
    requestedRange.until,
  );
  return encodeAdsHistoryCursor({
    rootSince: requestedRange.since,
    rootUntil: requestedRange.until,
    chunkSince,
    chunkUntil,
    providerAfter: null,
  });
}

function inclusiveDays(range) {
  return Math.floor(
    (Date.parse(`${range.until}T00:00:00Z`) - Date.parse(`${range.since}T00:00:00Z`))
      / 86_400_000,
  ) + 1;
}

function addDays(value, amount) {
  const instant = Date.parse(`${value}T00:00:00Z`) + amount * 86_400_000;
  return new Date(instant).toISOString().slice(0, 10);
}

function minDate(left, right) {
  return left < right ? left : right;
}

function optionalCursor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Meta Ads history provider cursor is invalid');
  }
  return value.trim();
}

function requireProviderCursor(value) {
  const cursor = optionalCursor(value);
  if (!cursor || cursor.startsWith(ADS_HISTORY_CURSOR_PREFIX)) {
    throw new TypeError('Meta Ads history provider cursor is invalid');
  }
  return cursor;
}

function assertDateInRange(value, range, fieldName) {
  const date = requireDateOnly(value, { label: `Meta Ads ${fieldName}` });
  if (date < range.since || date > range.until) {
    throw new TypeError(`Meta Ads ${fieldName} is outside the requested range`);
  }
}

function contract(datasetKey) {
  return getMetaBusinessDatasetContract(CONNECTOR_KEY, datasetKey);
}
