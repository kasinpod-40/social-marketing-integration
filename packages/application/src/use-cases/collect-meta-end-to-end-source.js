import {
  getMetaBusinessDatasetContract,
  META_BUSINESS_CONNECTOR_KEYS,
} from '../../../config/src/meta-business-ingestion-contract.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const CONNECTOR_KEYS = new Set(Object.values(META_BUSINESS_CONNECTOR_KEYS));
// The Queue router fetches only one page per invocation. This is a whole-operation safety ceiling,
// not an invocation CPU/subrequest budget.
const MAX_PAGES = 2_500;

/**
 * Fetch one bounded Meta source unit. The caller persists returned nextState in the
 * existing resumable-work store and schedules continuation through the shared reliability path.
 * This module never writes D1/Lark and never sends a Queue message.
 */
export async function collectMetaEndToEndSourceUnit(input = {}) {
  const connectorKey = requireConnectorKey(input.connectorKey);
  const dataset = getMetaBusinessDatasetContract(
    connectorKey,
    requireText(input.datasetKey, 'datasetKey'),
  );
  const adapter = requireAdapter(input.adapters?.[connectorKey], connectorKey);
  const state = normalizeState(input.state);
  const identities = normalizeIdentities(input.identities);
  const dateRange = normalizeDateRange(input.dateRange);
  const maxPages = boundedInteger(input.maxPages ?? MAX_PAGES, 'maxPages', 1, MAX_PAGES);

  if (state.pageNumber > maxPages) {
    throw sourceError('Meta source pagination exceeded the durable page limit', {
      code: 'META_END_TO_END_PAGE_LIMIT',
      details: { connectorKey, datasetKey: dataset.key, maxPages },
    });
  }

  const result = await invokeDataset({
    connectorKey,
    datasetKey: dataset.key,
    adapter,
    state,
    identities,
    dateRange,
  });
  const rows = Object.freeze(result.rows.map((row) => requireObject(row, 'source row')));
  const nextCursor = optionalText(result.nextCursor);
  const hasMore = result.hasMore === true;
  if (hasMore && !nextCursor) {
    throw sourceError('Meta source reported more data without a durable cursor', {
      code: 'META_END_TO_END_CURSOR_MISSING',
      details: { connectorKey, datasetKey: dataset.key },
    });
  }
  if (nextCursor && (nextCursor === state.after || state.visitedCursors.includes(nextCursor))) {
    throw sourceError('Meta source returned a repeated durable cursor', {
      code: 'META_END_TO_END_CURSOR_REPEATED',
      details: { connectorKey, datasetKey: dataset.key },
    });
  }
  const complete = !hasMore;
  const emptyConfirmed = complete && rows.length === 0 && state.pageNumber === 1;
  const sourceStatus = emptyConfirmed && connectorKey === META_BUSINESS_CONNECTOR_KEYS.META_ADS
    ? 'no_data_confirmed'
    : (complete ? 'complete' : 'partial');
  const visitedCursors = state.after
    ? Object.freeze([...state.visitedCursors, state.after])
    : state.visitedCursors;
  const nextState = complete ? null : Object.freeze({
    after: nextCursor,
    visitedCursors,
    pageNumber: state.pageNumber + 1,
    sourceWatermark: maxWatermark(state.sourceWatermark, readWatermark(rows)),
    entityId: state.entityId,
  });

  return deepFreeze({
    schemaVersion: 'meta_end_to_end_source_unit_v1',
    connectorKey,
    datasetKey: dataset.key,
    unitKey: createUnitKey({ connectorKey, datasetKey: dataset.key, state, identities }),
    sourceAccountId: identities.sourceAccountId,
    sourceEntityId: state.entityId,
    rows,
    rowCount: rows.length,
    pageNumber: state.pageNumber,
    hasMore,
    nextCursor,
    sourceStatus,
    sourceWatermark: maxWatermark(
      state.sourceWatermark,
      readWatermark(rows),
    ),
    nextState,
  });
}

export function createMetaSourceCheckpoint(input = {}) {
  const unit = requireObject(input.unit, 'unit');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const completedAt = requireTimestamp(input.completedAt, 'completedAt');
  return deepFreeze({
    schemaVersion: 'meta_end_to_end_checkpoint_v1',
    cursorKey,
    connectorKey: requireConnectorKey(unit.connectorKey),
    datasetKey: requireText(unit.datasetKey, 'unit.datasetKey'),
    sourceAccountId: requireText(unit.sourceAccountId, 'unit.sourceAccountId'),
    sourceEntityId: optionalText(unit.sourceEntityId),
    after: unit.nextState?.after ?? null,
    pageNumber: unit.nextState?.pageNumber ?? unit.pageNumber,
    sourceWatermark: optionalText(unit.sourceWatermark),
    complete: unit.nextState === null,
    syncRunId,
    completedAt,
  });
}

async function invokeDataset(input) {
  const commonPage = {
    after: input.state.after,
    visitedCursors: input.state.visitedCursors,
  };
  const accountId = input.identities.sourceAccountId;

  switch (input.datasetKey) {
    case 'facebook.account.latest':
      return node(await input.adapter.fetchAccount({ pageId: accountId }));
    case 'facebook.content.inventory':
      return page(await input.adapter.fetchContentPage({
        pageId: accountId,
        ...commonPage,
        ...input.dateRange,
      }));
    case 'facebook.content.insights':
      return page(await input.adapter.fetchContentInsightsPage({
        pageId: accountId,
        contentId: requireText(input.state.entityId, 'state.entityId'),
        ...commonPage,
        ...input.dateRange,
      }));
    case 'facebook.account.insights':
      return page(await input.adapter.fetchAccountInsightsPage({
        pageId: accountId,
        ...commonPage,
        ...input.dateRange,
      }));
    case 'instagram.account.latest':
      return node(await input.adapter.fetchAccount({ accountId }));
    case 'instagram.content.inventory':
      return page(await input.adapter.fetchContentPage({
        accountId,
        ...commonPage,
        ...input.dateRange,
      }));
    case 'instagram.content.insights':
      return page(await input.adapter.fetchContentInsightsPage({
        accountId,
        mediaId: requireText(input.state.entityId, 'state.entityId'),
        ...commonPage,
        ...input.dateRange,
      }));
    case 'instagram.account.insights':
      return page(await input.adapter.fetchAccountInsightsPage({
        accountId,
        ...commonPage,
        ...input.dateRange,
      }));
    case 'meta_ads.account.latest':
      return node(await input.adapter.fetchAccount({ adAccountId: accountId }));
    case 'meta_ads.campaigns.inventory':
      return page(await input.adapter.fetchCampaignsPage({ adAccountId: accountId, ...commonPage }));
    case 'meta_ads.ad_sets.inventory':
      return page(await input.adapter.fetchAdSetsPage({ adAccountId: accountId, ...commonPage }));
    case 'meta_ads.ads.inventory':
      return page(await input.adapter.fetchAdsPage({ adAccountId: accountId, ...commonPage }));
    case 'meta_ads.creatives.inventory':
      return page(await input.adapter.fetchCreativesPage({ adAccountId: accountId, ...commonPage }));
    case 'meta_ads.performance.daily':
      return page(await input.adapter.fetchDailyInsightsPage({
        adAccountId: accountId,
        ...commonPage,
        ...requireDateRange(input.dateRange),
      }));
    default:
      throw sourceError(`Unsupported Meta business dataset: ${input.datasetKey}`, {
        code: 'META_END_TO_END_DATASET_UNSUPPORTED',
      });
  }
}

function node(value) {
  const resource = requireObject(value?.resource, 'node resource');
  return Object.freeze({ rows: Object.freeze([resource]), hasMore: false, nextCursor: null });
}

function page(value) {
  const rows = value?.rows;
  if (!Array.isArray(rows)) {
    throw sourceError('Meta source page envelope is invalid', {
      code: 'META_END_TO_END_SOURCE_ENVELOPE_INVALID',
    });
  }
  return Object.freeze({
    rows,
    hasMore: value?.hasMore === true,
    nextCursor: value?.nextCursor ?? null,
  });
}

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const visitedCursors = Array.isArray(state.visitedCursors)
    ? [...new Set(state.visitedCursors.map((item) => requireText(item, 'visitedCursor')))]
    : [];
  return Object.freeze({
    after: optionalText(state.after),
    visitedCursors: Object.freeze(visitedCursors),
    pageNumber: boundedInteger(state.pageNumber ?? 1, 'state.pageNumber', 1, MAX_PAGES + 1),
    sourceWatermark: optionalText(state.sourceWatermark),
    entityId: optionalText(state.entityId),
  });
}

function normalizeIdentities(value) {
  const input = requireObject(value, 'identities');
  return Object.freeze({
    sourceAccountId: requireText(input.sourceAccountId, 'identities.sourceAccountId'),
  });
}

function normalizeDateRange(value) {
  if (value === null || value === undefined) return Object.freeze({});
  const range = requireObject(value, 'dateRange');
  const since = optionalDate(range.since, 'dateRange.since');
  const until = optionalDate(range.until, 'dateRange.until');
  if ((since === null) !== (until === null)) {
    throw sourceError('Meta source date range requires both since and until', {
      code: 'META_END_TO_END_DATE_RANGE_INVALID',
    });
  }
  if (since && since > until) {
    throw sourceError('Meta source since cannot be after until', {
      code: 'META_END_TO_END_DATE_RANGE_INVALID',
    });
  }
  return Object.freeze(since ? { since, until } : {});
}

function requireDateRange(value) {
  if (!value?.since || !value?.until) {
    throw sourceError('Meta Ads daily source requires a bounded date range', {
      code: 'META_END_TO_END_DATE_RANGE_REQUIRED',
    });
  }
  return value;
}

function createUnitKey({ connectorKey, datasetKey, state, identities }) {
  return [
    connectorKey,
    datasetKey,
    identities.sourceAccountId,
    state.entityId ?? 'account',
    `page_${state.pageNumber}`,
    state.after ?? 'start',
  ].join(':');
}

function readWatermark(rows) {
  let watermark = null;
  for (const row of rows) {
    for (const field of ['updated_time', 'timestamp', 'created_time', 'date_stop', 'date_start']) {
      const value = optionalText(row?.[field]);
      if (value && (!watermark || value > watermark)) watermark = value;
    }
  }
  return watermark;
}

function maxWatermark(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left > right ? left : right;
}

function requireConnectorKey(value) {
  const key = requireText(value, 'connectorKey');
  if (!CONNECTOR_KEYS.has(key)) {
    throw sourceError(`Unsupported Meta connector: ${key}`, {
      code: 'META_END_TO_END_CONNECTOR_UNSUPPORTED',
    });
  }
  return key;
}

function requireAdapter(value, connectorKey) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`Meta source adapter is required for ${connectorKey}`);
  }
  return value;
}

function optionalDate(value, fieldName) {
  const text = optionalText(value);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw sourceError(`${fieldName} must be YYYY-MM-DD`, {
      code: 'META_END_TO_END_DATE_RANGE_INVALID',
    });
  }
  return text;
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw sourceError(`${fieldName} must be an integer from ${minimum} to ${maximum}`, {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
    });
  }
  return number;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
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

function sourceError(message, options = {}) {
  return permanentError(message, options);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
