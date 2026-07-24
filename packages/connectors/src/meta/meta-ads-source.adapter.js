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

  async fetchDailyInsightsPage(input = {}) {
    const accountId = normalizeMetaAdAccountId(input.adAccountId);
    const range = normalizeMetaDateRange(input, ADS_DATE_CHUNK_DAYS);
    if (!range.since) throw new TypeError('Meta Ads Insights requires since/until');
    const dataset = contract('meta_ads.performance.daily');
    const query = dataset.queryContract;
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
        ...normalizeMetaPageOptions(input),
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
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: accountId,
      page,
    });
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

function assertDateInRange(value, range, fieldName) {
  const date = requireDateOnly(value, { label: `Meta Ads ${fieldName}` });
  if (date < range.since || date > range.until) {
    throw new TypeError(`Meta Ads ${fieldName} is outside the requested range`);
  }
}

function contract(datasetKey) {
  return getMetaBusinessDatasetContract(CONNECTOR_KEY, datasetKey);
}
