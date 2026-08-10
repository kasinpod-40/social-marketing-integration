import {
  getMetaBusinessDatasetContract,
  META_BUSINESS_CONNECTOR_KEYS,
  META_BUSINESS_INGESTION_CONTRACT,
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
const DAY_MS = 86_400_000;
const DAILY_CONTENT_LOOKBACK_DAYS = META_BUSINESS_INGESTION_CONTRACT.history.dashboardLookbackDays;

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
    const range = normalizeMetaDateRange(input);
    const inventoryRange = facebookContentInventoryRange(range);
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset, { page_id: pageId }),
      {
        fields: fieldsQuery(dataset),
        ...inventoryRange,
      },
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
    const query = {
      metric: metricQuery(dataset),
      ...(period ? { period } : {}),
      ...(range.since ? { since: range.since, until: range.until } : {}),
    };
    const options = {
      ...normalizeMetaPageOptions(input),
      operationName: dataset.key,
    };
    const page = dataset.paginated
      ? await this.client.getPage(
        buildMetaDatasetPath(dataset, pathValues),
        query,
        options,
      )
      : singleResponsePage(await this.client.get(
        buildMetaDatasetPath(dataset, pathValues),
        query,
        { operationName: dataset.key },
      ));
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: pageId,
      sourceEntityId,
      page,
    });
  }
}

/**
 * A one-day Facebook run is a daily observation boundary, not a one-day publication boundary.
 * Discover the bounded Dashboard lookback so existing recent Content is observed even when nothing
 * was published on the target day. Multi-day history retains the explicit caller publication range.
 */
function facebookContentInventoryRange(range) {
  if (!range.since) return Object.freeze({});
  if (range.since === range.until) {
    return Object.freeze({
      since: shiftDateOnly(range.until, -(DAILY_CONTENT_LOOKBACK_DAYS - 1)),
      until: facebookContentExclusiveUntil(range.until),
    });
  }
  return Object.freeze({
    since: range.since,
    until: facebookContentExclusiveUntil(range.until),
  });
}

function facebookContentExclusiveUntil(inclusiveUntil) {
  return shiftDateOnly(inclusiveUntil, 1);
}

function shiftDateOnly(value, days) {
  const epochMs = Date.parse(`${value}T00:00:00.000Z`);
  const shifted = new Date(epochMs + days * DAY_MS).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(shifted)) {
    throw new RangeError('Facebook content date could not be shifted');
  }
  return shifted;
}

function singleResponsePage(payload) {
  if (!Array.isArray(payload?.data)) {
    throw new TypeError('Meta non-paginated metric response requires data array');
  }
  return Object.freeze({
    rows: Object.freeze(payload.data),
    hasMore: false,
    nextCursor: null,
  });
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
