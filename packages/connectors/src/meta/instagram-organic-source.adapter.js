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
    this.contentDateRange = normalizeConfiguredDateRange(input.contentDateRange);
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
    const range = requestedContentDateRange(input, this.contentDateRange);
    const page = await this.client.getPage(
      buildMetaDatasetPath(dataset),
      { fields: fieldsQuery(dataset) },
      {
        ...normalizeMetaPageOptions(input),
        operationName: dataset.key,
      },
    );
    const boundedPage = boundInstagramContentPage(page, range);
    return createMetaSourcePageEnvelope({
      datasetKey: dataset.key,
      sourceAccountId: accountId,
      page: boundedPage,
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

/**
 * Instagram `/me/media` does not accept the same bounded history query as Facebook.
 * The edge is newest-first, so filter exact dates and retire pagination only after
 * the lower boundary is crossed. Invalid or non-monotonic timestamps fail closed.
 */
export function boundInstagramContentPage(page = {}, dateRange = null) {
  if (!Array.isArray(page.rows)) throw new TypeError('Instagram content page requires rows');
  if (typeof page.hasMore !== 'boolean') {
    throw new TypeError('Instagram content page requires hasMore boolean');
  }
  const range = dateRange ? normalizeMetaDateRange(dateRange) : Object.freeze({ since: null, until: null });
  if (!range.since) return deepFreeze({
    rows: page.rows,
    hasMore: page.hasMore,
    nextCursor: page.hasMore ? page.nextCursor : null,
  });

  let previousInstant = null;
  let crossedLowerBoundary = false;
  const rows = [];
  for (const row of page.rows) {
    const instant = requireInstagramTimestamp(row?.timestamp);
    if (previousInstant !== null && instant > previousInstant) {
      throw new TypeError('Instagram content inventory must remain newest-first');
    }
    previousInstant = instant;
    const date = new Date(instant).toISOString().slice(0, 10);
    if (date < range.since) crossedLowerBoundary = true;
    if (date >= range.since && date <= range.until) rows.push(row);
  }

  const hasMore = page.hasMore && !crossedLowerBoundary;
  return deepFreeze({
    rows,
    hasMore,
    nextCursor: hasMore ? page.nextCursor : null,
  });
}

function requestedContentDateRange(input, configured) {
  const hasExplicit = input?.since !== null
    && input?.since !== undefined
    && input?.since !== ''
    || input?.until !== null
    && input?.until !== undefined
    && input?.until !== '';
  if (hasExplicit) return normalizeMetaDateRange(input);
  return configured;
}

function normalizeConfiguredDateRange(value) {
  if (value === null || value === undefined) return null;
  const range = normalizeMetaDateRange(value);
  return range.since ? range : null;
}

function requireInstagramTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Instagram content inventory requires timestamp');
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) {
    throw new TypeError('Instagram content inventory timestamp is invalid');
  }
  return instant;
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
