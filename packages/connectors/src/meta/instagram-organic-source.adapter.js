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
  metricQuery,
  normalizeMetaDateRange,
  normalizeMetaPageOptions,
  requireMetaExternalId,
  requireMetaReadClient,
} from './meta-business-source.helpers.js';

const CONNECTOR_KEY = META_BUSINESS_CONNECTOR_KEYS.INSTAGRAM_ORGANIC;

/** GET-only Instagram Login source adapter; Identity authority คือ `/me` เท่านั้น */
export class InstagramOrganicSourceAdapter {
  constructor(input = {}) {
    this.client = requireMetaReadClient(input.client);
  }

  async fetchAccount(input = {}) {
    const accountId = requireMetaExternalId(input.accountId, 'accountId');
    const dataset = contract('instagram.account.latest');
    const resource = await this.client.get(
      buildMetaDatasetPath(dataset),
      { fields: fieldsQuery(dataset) },
      { operationName: dataset.key },
    );
    assertMetaIdentity(
      resource?.user_id ?? resource?.id,
      accountId,
      'META_INSTAGRAM_ACCOUNT_IDENTITY_MISMATCH',
    );
    return deepFreeze({ datasetKey: dataset.key, sourceAccountId: accountId, resource });
  }

  async fetchContentPage(input = {}) {
    const accountId = requireMetaExternalId(input.accountId, 'accountId');
    const dataset = contract('instagram.content.inventory');
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset),
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

  async fetchContentInsightsPage(input = {}) {
    const accountId = requireMetaExternalId(input.accountId, 'accountId');
    const mediaId = requireMetaExternalId(input.mediaId, 'mediaId');
    const dataset = contract('instagram.content.insights');
    return this.#fetchInsightsPage({
      input,
      dataset,
      accountId,
      sourceEntityId: mediaId,
      pathValues: { media_id: mediaId },
    });
  }

  async fetchAccountInsightsPage(input = {}) {
    const accountId = requireMetaExternalId(input.accountId, 'accountId');
    const dataset = contract('instagram.account.insights');
    return this.#fetchInsightsPage({
      input,
      dataset,
      accountId,
      sourceEntityId: accountId,
      pathValues: {},
    });
  }

  async #fetchInsightsPage({ input, dataset, accountId, sourceEntityId, pathValues }) {
    const range = normalizeMetaDateRange(input);
    const metricType = optionalQueryToken(input.metricType, 'metricType');
    const period = optionalQueryToken(input.period, 'period');
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset, pathValues),
      {
        metric: metricQuery(dataset),
        ...(metricType ? { metric_type: metricType } : {}),
        ...(period ? { period } : {}),
        ...(range.since ? { since: range.since, until: range.until } : {}),
      },
      {
        ...normalizeMetaPageOptions(input),
        operationName: dataset.key,
      },
    );
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: accountId,
      sourceEntityId,
      page,
    });
  }
}

function contract(datasetKey) {
  return getMetaBusinessDatasetContract(CONNECTOR_KEY, datasetKey);
}

function optionalQueryToken(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(value.trim())) {
    throw new TypeError(`Instagram ${fieldName} must be a static query token`);
  }
  return value.trim();
}
