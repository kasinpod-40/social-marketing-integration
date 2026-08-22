import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { stableSerialize } from '../../shared/src/hash/stable-fingerprint.js';

export const GOOGLE_ADS_MANAGER_DELIVERY_SCHEMA_VERSION =
  'google_ads_manager_script_signed_delivery_v1';
export const GOOGLE_ADS_MANAGER_DELIVERY_PATH =
  '/v1/google-ads/manager-script/deliveries';
export const GOOGLE_ADS_MANAGER_DELIVERY_MODES = Object.freeze(['PREVIEW', 'LIVE']);
export const GOOGLE_ADS_MANAGER_DATASET_KEYS = Object.freeze([
  'account',
  'campaigns',
  'assetGroups',
  'adGroups',
  'ads',
  'youtubeAssets',
  'campaignDailyMetrics',
]);
export const GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS = Object.freeze({
  bodyBytes: 524_288,
  rowsPerChunk: 500,
  chunksPerRun: 64,
  assemblyWindowMs: 2 * 60 * 60 * 1_000,
  clockSkewSeconds: 300,
  nonceRetentionSeconds: 900,
});
export const GOOGLE_ADS_MANAGER_DATASET_LIMITS = Object.freeze({
  account: 1,
  campaigns: 500,
  assetGroups: 2_000,
  adGroups: 2_000,
  ads: 5_000,
  youtubeAssets: 5_000,
  campaignDailyMetrics: 10_000,
});

const ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion',
  'runId',
  'mode',
  'runStartedAt',
  'fetchedAt',
  'managerCustomerId',
  'customerId',
  'customerKey',
  'accountKey',
  'sourceTimezone',
  'manifest',
  'dataset',
]);
const MANIFEST_ENTRY_FIELDS = Object.freeze(['totalRows', 'chunkCount']);
const DATASET_FIELDS = Object.freeze(['key', 'chunkIndex', 'chunkCount', 'totalRows', 'rows']);
const ROW_FIELDS = deepFreeze({
  account: [
    'customerId', 'descriptiveName', 'currencyCode', 'timeZone', 'status',
    'isManager', 'isTestAccount', 'resourceName',
  ],
  campaigns: [
    'campaignId', 'campaignName', 'status', 'primaryStatus', 'servingStatus',
    'advertisingChannelType', 'advertisingChannelSubType', 'startDate', 'endDate',
    'biddingStrategyType', 'campaignBudgetId', 'campaignBudgetResourceName', 'resourceName',
  ],
  assetGroups: [
    'assetGroupId', 'campaignId', 'assetGroupName', 'status', 'resourceName',
  ],
  adGroups: [
    'adGroupId', 'campaignId', 'adGroupName', 'status', 'primaryStatus', 'type',
    'resourceName',
  ],
  ads: [
    'adId', 'adGroupId', 'campaignId', 'adName', 'status', 'primaryStatus',
    'type', 'finalUrls', 'displayUrl', 'resourceName',
  ],
  youtubeAssets: [
    'assetId', 'assetName', 'status', 'assetType', 'youtubeVideoId',
    'youtubeVideoTitle', 'resourceName',
  ],
  campaignDailyMetrics: [
    'metricDate', 'reportLevel', 'externalEntityId', 'campaignId', 'adGroupId', 'adId',
    'advertisingChannelType', 'advertisingChannelSubType', 'adChannel', 'segmentKey',
    'currency', 'spendMicros', 'impressions', 'clicks', 'conversions',
    'conversionValueMicros', 'videoViews', 'videoViewRate', 'averageCpvMicros',
  ],
});
const AD_CHANNELS = Object.freeze([
  'google_search_ads',
  'google_display_ads',
  'youtube_ads',
  'google_other',
]);

export function validateGoogleAdsManagerDeliveryChunk(value, options = {}) {
  const envelope = exactObject(value, ENVELOPE_FIELDS, 'envelope');
  const identity = exactRuntimeIdentity(options.runtimeIdentity);
  requireEqual(envelope.schemaVersion, GOOGLE_ADS_MANAGER_DELIVERY_SCHEMA_VERSION, 'schemaVersion');
  const runId = requireUuidV4(envelope.runId, 'runId');
  const mode = requireChoice(envelope.mode, 'mode', GOOGLE_ADS_MANAGER_DELIVERY_MODES);
  const runStartedAt = requireUtcTimestamp(envelope.runStartedAt, 'runStartedAt');
  const fetchedAt = requireUtcTimestamp(envelope.fetchedAt, 'fetchedAt');
  if (fetchedAt < runStartedAt) throw invalid('fetchedAt cannot be before runStartedAt', { fieldName: 'fetchedAt' });
  if (fetchedAt - runStartedAt > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.assemblyWindowMs) {
    throw invalid('Signed delivery run exceeds the assembly window', { fieldName: 'fetchedAt' });
  }
  const headerTimestampSeconds = requireNonNegativeInteger(options.headerTimestampSeconds, 'headerTimestampSeconds');
  if (Math.abs(Math.trunc(fetchedAt / 1_000) - headerTimestampSeconds)
    > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.clockSkewSeconds) {
    throw invalid('fetchedAt does not match the signed request timestamp', { fieldName: 'fetchedAt' });
  }

  const managerCustomerId = requireCustomerId(envelope.managerCustomerId, 'managerCustomerId');
  const customerId = requireCustomerId(envelope.customerId, 'customerId');
  const customerKey = requireText(envelope.customerKey, 'customerKey');
  const accountKey = requireText(envelope.accountKey, 'accountKey');
  const sourceTimezone = requireText(envelope.sourceTimezone, 'sourceTimezone');
  requireEqual(managerCustomerId, identity.managerCustomerId, 'managerCustomerId');
  requireEqual(customerId, identity.customerId, 'customerId');
  requireEqual(customerKey, identity.customerKey, 'customerKey');
  requireEqual(accountKey, identity.accountKey, 'accountKey');
  requireEqual(sourceTimezone, identity.sourceTimezone, 'sourceTimezone');

  const manifest = validateManifest(envelope.manifest);
  const dataset = validateDataset(envelope.dataset, { customerId, sourceTimezone, manifest });
  return deepFreeze({
    ...envelope,
    runId,
    mode,
    managerCustomerId,
    customerId,
    customerKey,
    accountKey,
    sourceTimezone,
    manifest,
    dataset,
  });
}

export function createGoogleAdsManagerIdempotencyKey(envelope) {
  const value = exactObject(envelope, ENVELOPE_FIELDS, 'envelope');
  const dataset = exactObject(value.dataset, DATASET_FIELDS, 'dataset');
  return [
    'google-ads',
    requireUuidV4(value.runId, 'runId'),
    requireChoice(dataset.key, 'dataset.key', GOOGLE_ADS_MANAGER_DATASET_KEYS),
    requireNonNegativeInteger(dataset.chunkIndex, 'dataset.chunkIndex'),
  ].join(':');
}

export function validateGoogleAdsManagerDeliveryRun(values) {
  if (!Array.isArray(values) || values.length === 0) throw invalid('Signed delivery run requires at least one chunk');
  if (values.length > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.chunksPerRun) {
    throw invalid('Signed delivery run exceeds the maximum chunks per run');
  }

  const firstSource = exactObject(values[0], ENVELOPE_FIELDS, 'envelope');
  const runtimeIdentity = {
    managerCustomerId: firstSource.managerCustomerId,
    customerId: firstSource.customerId,
    customerKey: firstSource.customerKey,
    accountKey: firstSource.accountKey,
    sourceTimezone: firstSource.sourceTimezone,
  };
  const normalized = values.map((source) => {
    const envelope = exactObject(source, ENVELOPE_FIELDS, 'envelope');
    const fetchedAt = requireUtcTimestamp(envelope.fetchedAt, 'fetchedAt');
    return validateGoogleAdsManagerDeliveryChunk(envelope, {
      runtimeIdentity,
      headerTimestampSeconds: Math.trunc(fetchedAt / 1_000),
    });
  });
  const first = normalized[0];
  const manifestJson = stableSerialize(first.manifest);
  for (const envelope of normalized) {
    for (const fieldName of [
      'schemaVersion', 'runId', 'mode', 'runStartedAt', 'managerCustomerId',
      'customerId', 'customerKey', 'accountKey', 'sourceTimezone',
    ]) requireEqual(envelope[fieldName], first[fieldName], fieldName);
    requireEqual(stableSerialize(envelope.manifest), manifestJson, 'manifest');
  }

  const expectedChunkCount = GOOGLE_ADS_MANAGER_DATASET_KEYS
    .reduce((total, key) => total + first.manifest[key].chunkCount, 0);
  requireEqual(normalized.length, expectedChunkCount, 'run.chunkCount');

  const rowsByDataset = {};
  const counts = {};
  for (const datasetKey of GOOGLE_ADS_MANAGER_DATASET_KEYS) {
    const chunks = normalized
      .filter((envelope) => envelope.dataset.key === datasetKey)
      .sort((left, right) => left.dataset.chunkIndex - right.dataset.chunkIndex);
    const manifestEntry = first.manifest[datasetKey];
    requireEqual(chunks.length, manifestEntry.chunkCount, `${datasetKey}.chunkCount`);
    chunks.forEach((envelope, index) => requireEqual(envelope.dataset.chunkIndex, index, `${datasetKey}.chunkIndex`));
    const rows = chunks.flatMap((envelope) => envelope.dataset.rows);
    requireEqual(rows.length, manifestEntry.totalRows, `${datasetKey}.totalRows`);
    if (rows.length > 0) assertStableOrderAndUnique(datasetKey, rows);
    rowsByDataset[datasetKey] = rows;
    counts[datasetKey] = Object.freeze({ chunks: chunks.length, rows: rows.length });
  }

  validateRunRelations(rowsByDataset);
  return deepFreeze({
    runId: first.runId,
    mode: first.mode,
    expectedChunkCount,
    expectedRowCount: Object.values(counts).reduce((total, value) => total + value.rows, 0),
    datasets: counts,
  });
}

function validateRunRelations(rowsByDataset) {
  const account = rowsByDataset.account;
  if (account.length !== 1) throw invalid('Signed delivery run requires exactly one account row');
  const campaignIds = new Set(rowsByDataset.campaigns.map((row) => row.campaignId));
  for (const row of rowsByDataset.assetGroups) {
    if (!campaignIds.has(row.campaignId)) throw invalid('Signed delivery asset group parent campaign is missing');
  }
  const adGroupCampaigns = new Map();
  for (const row of rowsByDataset.adGroups) {
    if (!campaignIds.has(row.campaignId)) throw invalid('Signed delivery ad group parent campaign is missing');
    adGroupCampaigns.set(row.adGroupId, row.campaignId);
  }
  for (const row of rowsByDataset.ads) {
    if (!campaignIds.has(row.campaignId) || adGroupCampaigns.get(row.adGroupId) !== row.campaignId) {
      throw invalid('Signed delivery ad parent relation is invalid');
    }
  }
  for (const row of rowsByDataset.campaignDailyMetrics) {
    if (!campaignIds.has(row.campaignId)) throw invalid('Signed delivery daily metric parent campaign is missing');
    if (row.currency !== account[0].currencyCode) {
      throw invalid('Signed delivery daily metric currency does not match account currency');
    }
  }
}

function validateManifest(value) {
  const manifest = exactObject(value, GOOGLE_ADS_MANAGER_DATASET_KEYS, 'manifest');
  let totalChunks = 0;
  const normalized = {};
  for (const datasetKey of GOOGLE_ADS_MANAGER_DATASET_KEYS) {
    const entry = exactObject(manifest[datasetKey], MANIFEST_ENTRY_FIELDS, `manifest.${datasetKey}`);
    const totalRows = requireNonNegativeInteger(entry.totalRows, `manifest.${datasetKey}.totalRows`);
    const chunkCount = requireNonNegativeInteger(entry.chunkCount, `manifest.${datasetKey}.chunkCount`);
    if (totalRows > GOOGLE_ADS_MANAGER_DATASET_LIMITS[datasetKey]) {
      throw invalid(`manifest.${datasetKey}.totalRows exceeds the v1 dataset cap`, { datasetKey });
    }
    if ((totalRows === 0) !== (chunkCount === 0)) {
      throw invalid(`manifest.${datasetKey} empty rows/chunks must match`, { datasetKey });
    }
    if (totalRows > 0 && chunkCount > totalRows) {
      throw invalid(`manifest.${datasetKey}.chunkCount cannot exceed totalRows`, { datasetKey });
    }
    if (datasetKey === 'account' && (totalRows !== 1 || chunkCount !== 1)) {
      throw invalid('manifest.account must contain exactly one row and one chunk');
    }
    totalChunks += chunkCount;
    normalized[datasetKey] = Object.freeze({ totalRows, chunkCount });
  }
  if (totalChunks > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.chunksPerRun) {
    throw invalid('manifest exceeds the maximum chunks per run', { totalChunks });
  }
  return deepFreeze(normalized);
}

function validateDataset(value, context) {
  const dataset = exactObject(value, DATASET_FIELDS, 'dataset');
  const key = requireChoice(dataset.key, 'dataset.key', GOOGLE_ADS_MANAGER_DATASET_KEYS);
  const chunkIndex = requireNonNegativeInteger(dataset.chunkIndex, 'dataset.chunkIndex');
  const chunkCount = requirePositiveInteger(dataset.chunkCount, 'dataset.chunkCount');
  const totalRows = requirePositiveInteger(dataset.totalRows, 'dataset.totalRows');
  const manifestEntry = context.manifest[key];
  requireEqual(chunkCount, manifestEntry.chunkCount, 'dataset.chunkCount');
  requireEqual(totalRows, manifestEntry.totalRows, 'dataset.totalRows');
  if (chunkIndex >= chunkCount) throw invalid('dataset.chunkIndex is outside the declared chunk range', { datasetKey: key, chunkIndex });
  if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) throw invalid('dataset.rows must be a non-empty array');
  if (dataset.rows.length > GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.rowsPerChunk) {
    throw invalid('dataset.rows exceeds the per-chunk row cap', { datasetKey: key, rows: dataset.rows.length });
  }
  if (dataset.rows.length > totalRows) throw invalid('dataset.rows cannot exceed the manifest totalRows', { datasetKey: key });
  const rows = dataset.rows.map((row, index) => validateRow(key, row, index, context));
  assertStableOrderAndUnique(key, rows);
  return deepFreeze({ key, chunkIndex, chunkCount, totalRows, rows });
}

function validateRow(datasetKey, value, index, context) {
  const label = `${datasetKey}[${index}]`;
  const row = exactObject(value, ROW_FIELDS[datasetKey], label);
  switch (datasetKey) {
    case 'account':
      requireCustomerId(row.customerId, `${label}.customerId`);
      requireEqual(row.customerId, context.customerId, `${label}.customerId`);
      optionalText(row.descriptiveName, `${label}.descriptiveName`);
      requireCurrency(row.currencyCode, `${label}.currencyCode`);
      requireEqual(requireText(row.timeZone, `${label}.timeZone`), context.sourceTimezone, `${label}.timeZone`);
      optionalText(row.status, `${label}.status`);
      requireBoolean(row.isManager, `${label}.isManager`);
      if (row.isManager !== false) throw invalid(`${label}.isManager must be false`);
      requireBoolean(row.isTestAccount, `${label}.isTestAccount`);
      optionalText(row.resourceName, `${label}.resourceName`);
      break;
    case 'campaigns':
      requireId(row.campaignId, `${label}.campaignId`);
      validateOptionalTextFields(row, label, ROW_FIELDS.campaigns.filter((field) => !['campaignId', 'startDate', 'endDate'].includes(field)));
      optionalDate(row.startDate, `${label}.startDate`);
      optionalDate(row.endDate, `${label}.endDate`);
      break;
    case 'assetGroups':
      requireId(row.assetGroupId, `${label}.assetGroupId`);
      requireId(row.campaignId, `${label}.campaignId`);
      validateOptionalTextFields(row, label, ROW_FIELDS.assetGroups.filter((field) => !['assetGroupId', 'campaignId'].includes(field)));
      break;
    case 'adGroups':
      requireId(row.adGroupId, `${label}.adGroupId`);
      requireId(row.campaignId, `${label}.campaignId`);
      validateOptionalTextFields(row, label, ROW_FIELDS.adGroups.filter((field) => !['adGroupId', 'campaignId'].includes(field)));
      break;
    case 'ads':
      requireId(row.adId, `${label}.adId`);
      requireId(row.adGroupId, `${label}.adGroupId`);
      requireId(row.campaignId, `${label}.campaignId`);
      validateOptionalTextFields(row, label, ROW_FIELDS.ads.filter((field) => !['adId', 'adGroupId', 'campaignId', 'finalUrls'].includes(field)));
      validateFinalUrls(row.finalUrls, `${label}.finalUrls`);
      break;
    case 'youtubeAssets':
      requireId(row.assetId, `${label}.assetId`);
      validateOptionalTextFields(row, label, ROW_FIELDS.youtubeAssets.filter((field) => !['assetId', 'assetType'].includes(field)));
      requireEqual(row.assetType, 'YOUTUBE_VIDEO', `${label}.assetType`);
      break;
    case 'campaignDailyMetrics':
      validateCampaignDailyRow(row, label);
      break;
    default:
      throw invalid(`Unsupported dataset: ${datasetKey}`);
  }
  return deepFreeze({ ...row });
}

function validateCampaignDailyRow(row, label) {
  requireDate(row.metricDate, `${label}.metricDate`);
  requireEqual(row.reportLevel, 'campaign', `${label}.reportLevel`);
  const campaignId = requireId(row.campaignId, `${label}.campaignId`);
  requireEqual(requireId(row.externalEntityId, `${label}.externalEntityId`), campaignId, `${label}.externalEntityId`);
  requireNull(row.adGroupId, `${label}.adGroupId`);
  requireNull(row.adId, `${label}.adId`);
  const advertisingChannelType = requireText(row.advertisingChannelType, `${label}.advertisingChannelType`);
  optionalText(row.advertisingChannelSubType, `${label}.advertisingChannelSubType`);
  const adChannel = requireChoice(row.adChannel, `${label}.adChannel`, AD_CHANNELS);
  requireEqual(adChannel, deriveAdChannel(advertisingChannelType), `${label}.adChannel`);
  requireEqual(row.segmentKey, 'all', `${label}.segmentKey`);
  requireCurrency(row.currency, `${label}.currency`);
  for (const field of ['spendMicros', 'impressions', 'clicks', 'conversionValueMicros', 'videoViews', 'averageCpvMicros']) {
    optionalNonNegativeInteger(row[field], `${label}.${field}`);
  }
  optionalNonNegativeNumber(row.conversions, `${label}.conversions`);
  optionalRatio(row.videoViewRate, `${label}.videoViewRate`);
}

function assertStableOrderAndUnique(datasetKey, rows) {
  const identities = new Set();
  let previous = null;
  for (const row of rows) {
    const identity = rowIdentity(datasetKey, row);
    if (identities.has(identity)) throw invalid(`${datasetKey} contains a duplicate row identity`, { datasetKey });
    identities.add(identity);
    const order = rowOrder(datasetKey, row);
    if (previous && compareOrder(previous, order) >= 0) throw invalid(`${datasetKey} rows are not in strict stable order`, { datasetKey });
    previous = order;
  }
}

function rowIdentity(datasetKey, row) {
  switch (datasetKey) {
    case 'account': return row.customerId;
    case 'campaigns': return row.campaignId;
    case 'assetGroups': return row.assetGroupId;
    case 'adGroups': return row.adGroupId;
    case 'ads': return `${row.adGroupId}:${row.adId}`;
    case 'youtubeAssets': return row.assetId;
    case 'campaignDailyMetrics': return `${row.metricDate}:${row.campaignId}:${row.segmentKey}`;
    default: throw invalid(`Unsupported dataset: ${datasetKey}`);
  }
}

function rowOrder(datasetKey, row) {
  switch (datasetKey) {
    case 'account': return [idOrder(row.customerId)];
    case 'campaigns': return [idOrder(row.campaignId)];
    case 'assetGroups': return [idOrder(row.campaignId), idOrder(row.assetGroupId)];
    case 'adGroups': return [idOrder(row.adGroupId)];
    case 'ads': return [idOrder(row.campaignId), idOrder(row.adGroupId), idOrder(row.adId)];
    case 'youtubeAssets': return [idOrder(row.assetId)];
    case 'campaignDailyMetrics': return [row.metricDate, idOrder(row.campaignId), row.segmentKey];
    default: throw invalid(`Unsupported dataset: ${datasetKey}`);
  }
}

function compareOrder(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function idOrder(value) {
  const text = requireId(value, 'id');
  return `${String(text.length).padStart(3, '0')}:${text}`;
}

function deriveAdChannel(value) {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'SEARCH') return 'google_search_ads';
  if (normalized === 'DISPLAY') return 'google_display_ads';
  if (normalized === 'VIDEO') return 'youtube_ads';
  return 'google_other';
}

function exactRuntimeIdentity(value) {
  const identity = exactObject(value, [
    'managerCustomerId', 'customerId', 'customerKey', 'accountKey', 'sourceTimezone',
  ], 'runtimeIdentity');
  return Object.freeze({
    managerCustomerId: requireCustomerId(identity.managerCustomerId, 'runtimeIdentity.managerCustomerId'),
    customerId: requireCustomerId(identity.customerId, 'runtimeIdentity.customerId'),
    customerKey: requireText(identity.customerKey, 'runtimeIdentity.customerKey'),
    accountKey: requireText(identity.accountKey, 'runtimeIdentity.accountKey'),
    sourceTimezone: requireText(identity.sourceTimezone, 'runtimeIdentity.sourceTimezone'),
  });
}

function exactObject(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${label} must be an object`, { fieldName: label });
  }
  const expected = new Set(fields);
  const actual = Object.keys(value);
  const unknown = actual.filter((field) => !expected.has(field));
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (unknown.length > 0 || missing.length > 0) {
    throw invalid(`${label} fields do not match the v1 contract`, { fieldName: label, unknown, missing });
  }
  return value;
}

function validateOptionalTextFields(row, label, fields) {
  for (const field of fields) optionalText(row[field], `${label}.${field}`);
}

function validateFinalUrls(value, fieldName) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 20) {
    throw invalid(`${fieldName} must be null or an array of at most 20 URLs`, { fieldName });
  }
  for (const item of value) requireText(item, fieldName);
  return value;
}

function requireUuidV4(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text)) {
    throw invalid(`${fieldName} must be a UUID v4`, { fieldName });
  }
  return text;
}

function requireCustomerId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{10}$/u.test(text)) throw invalid(`${fieldName} must be a 10-digit Google Ads customer ID`, { fieldName });
  return text;
}

function requireId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d+$/u.test(text)) throw invalid(`${fieldName} must contain digits only`, { fieldName });
  return text;
}

function requireCurrency(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[A-Z]{3}$/u.test(text)) throw invalid(`${fieldName} must be an uppercase currency code`, { fieldName });
  return text;
}

function requireUtcTimestamp(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text)) {
    throw invalid(`${fieldName} must be an exact UTC RFC3339 millisecond timestamp`, { fieldName });
  }
  const timestamp = Date.parse(text);
  if (!Number.isSafeInteger(timestamp)) throw invalid(`${fieldName} is invalid`, { fieldName });
  return timestamp;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))) {
    throw invalid(`${fieldName} must be YYYY-MM-DD`, { fieldName });
  }
  return text;
}

function optionalDate(value, fieldName) {
  if (value === null) return null;
  return requireDate(value, fieldName);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${fieldName} must be a non-empty string`, { fieldName });
  return value.trim();
}

function optionalText(value, fieldName) {
  if (value === null) return null;
  return requireText(value, fieldName);
}

function requireBoolean(value, fieldName) {
  if (typeof value !== 'boolean') throw invalid(`${fieldName} must be boolean`, { fieldName });
  return value;
}

function requireNull(value, fieldName) {
  if (value !== null) throw invalid(`${fieldName} must be null`, { fieldName });
  return null;
}

function requireNonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${fieldName} must be a non-negative safe integer`, { fieldName });
  return value;
}

function requirePositiveInteger(value, fieldName) {
  const number = requireNonNegativeInteger(value, fieldName);
  if (number === 0) throw invalid(`${fieldName} must be positive`, { fieldName });
  return number;
}

function optionalNonNegativeInteger(value, fieldName) {
  if (value === null) return null;
  return requireNonNegativeInteger(value, fieldName);
}

function optionalNonNegativeNumber(value, fieldName) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(`${fieldName} must be a non-negative finite number or null`, { fieldName });
  }
  return value;
}

function optionalRatio(value, fieldName) {
  const number = optionalNonNegativeNumber(value, fieldName);
  if (number !== null && number > 1) throw invalid(`${fieldName} must be between zero and one`, { fieldName });
  return number;
}

function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.includes(text)) throw invalid(`${fieldName} is not supported by the v1 contract`, { fieldName });
  return text;
}

function requireEqual(actual, expected, fieldName) {
  if (actual !== expected) throw invalid(`${fieldName} does not match the signed-delivery contract`, { fieldName });
  return actual;
}

function invalid(message, details = {}) {
  return permanentError(message, { code: 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID', details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}