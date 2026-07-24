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

const CONNECTOR_KEY = META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC;

/** GET-only Facebook Page source adapter; ไม่มี Method สำหรับ Publish/Mutation */
export class FacebookOrganicSourceAdapter {
  constructor(input = {}) {
    this.client = requireMetaReadClient(input.client);
  }

  async fetchAccount(input = {}) {
    const pageId = requireMetaExternalId(input.pageId, 'pageId');
    const dataset = contract('facebook.account.latest');
    const resource = await this.client.get(
      buildMetaDatasetPath(dataset, { page_id: pageId }),
      { fields: fieldsQuery(dataset) },
      { operationName: dataset.key },
    );
    assertMetaIdentity(resource?.id, pageId, 'META_FACEBOOK_PAGE_IDENTITY_MISMATCH');
    return deepFreeze({ datasetKey: dataset.key, sourceAccountId: pageId, resource });
  }

  async fetchContentPage(input = {}) {
    const pageId = requireMetaExternalId(input.pageId, 'pageId');
    const dataset = contract('facebook.content.inventory');
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset, { page_id: pageId }),
      { fields: fieldsQuery(dataset) },
      {
        ...normalizeMetaPageOptions(input),
        operationName: dataset.key,
      },
    );
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: pageId,
      page,
    });
  }

  async fetchContentInsightsPage(input = {}) {
    const pageId = requireMetaExternalId(input.pageId, 'pageId');
    const contentId = requireMetaExternalId(input.contentId, 'contentId');
    const dataset = contract('facebook.content.insights');
    return this.#fetchInsightsPage({
      input,
      dataset,
      pageId,
      sourceEntityId: contentId,
      pathValues: { content_id: contentId },
    });
  }

  async fetchAccountInsightsPage(input = {}) {
    const pageId = requireMetaExternalId(input.pageId, 'pageId');
    const dataset = contract('facebook.account.insights');
    return this.#fetchInsightsPage({
      input,
      dataset,
      pageId,
      sourceEntityId: pageId,
      pathValues: { page_id: pageId },
    });
  }

  async #fetchInsightsPage({ input, dataset, pageId, sourceEntityId, pathValues }) {
    const range = normalizeMetaDateRange(input);
    const period = optionalQueryToken(input.period, 'period');
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset, pathValues),
      {
        metric: metricQuery(dataset),
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
      sourceAccountId: pageId,
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
    throw new TypeError(`Facebook ${fieldName} must be a static query token`);
  }
  return value.trim();
}
