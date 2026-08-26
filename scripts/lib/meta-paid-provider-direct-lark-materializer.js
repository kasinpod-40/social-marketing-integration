import {
  buildMetaAdsWriteSet,
  projectMetaAdsDailyRowsForLark,
} from '../../packages/application/src/use-cases/build-meta-ads-write-set.js';
import { META_END_TO_END_LARK_TABLES } from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';
import {
  META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
  META_PAID_DIRECT_LARK_PERIOD,
  META_PAID_DIRECT_LARK_TABLE_KEYS,
  META_PAID_DIRECT_LARK_TARGETS,
} from './meta-paid-direct-lark-materializer.js';

export const META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION =
  'meta_paid_provider_direct_lark_materializer_v1';
export const META_PAID_PROVIDER_DIRECT_LARK_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_PAID_PROVIDER_DIRECT_LARK',
  value: 'RUN_META_PAID_PROVIDER_DIRECT_LARK',
});
export const META_PAID_PROVIDER_DIRECT_LARK_TARGETS = META_PAID_DIRECT_LARK_TARGETS;
export const META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS = META_PAID_DIRECT_LARK_TABLE_KEYS;
export const META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS =
  META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS;
export const META_PAID_PROVIDER_DIRECT_LARK_PERIOD = META_PAID_DIRECT_LARK_PERIOD;
export const META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES = 500;
export const META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET = 50_000;

const EXACT_LARK_CONTRACTS = Object.freeze(META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS.map((tableKey) => {
  const contract = META_END_TO_END_LARK_TABLES.find((entry) => entry.tableKey === tableKey);
  if (!contract) throw new Error(`Missing Meta Lark contract: ${tableKey}`);
  return contract;
}));

export async function collectMetaPaidProviderSource(input = {}) {
  const target = requireTarget(input.target);
  const sourceAccountId = normalizeAdAccountId(input.sourceAccountId);
  const repositoryHead = requireSha(input.repositoryHead);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const adapter = requireMethods(input.adapter, [
    'fetchAccount',
    'fetchCreativesPage',
    'fetchDailyInsightsPage',
  ], 'adapter');
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  onProgress({ target, datasetKey: 'meta_ads.account.latest', page: 1, stage: 'provider-read-start' });
  const accountEnvelope = await adapter.fetchAccount({ adAccountId: sourceAccountId });
  const accountResource = requireObject(accountEnvelope?.resource, 'Meta Ads account resource');
  const observedAccountId = normalizeAdAccountId(
    accountResource.account_id ?? accountResource.id,
  );
  if (observedAccountId !== sourceAccountId) {
    throw providerError(
      'Meta Ads provider account identity differs from the reviewed target mapping',
      'META_PAID_PROVIDER_DIRECT_LARK_ACCOUNT_IDENTITY_MISMATCH',
      { target },
    );
  }
  onProgress({ target, datasetKey: 'meta_ads.account.latest', page: 1, rows: 1, stage: 'provider-read-complete' });

  const creatives = await collectMetaPaidProviderPages({
    target,
    datasetKey: 'meta_ads.creatives.inventory',
    maxPages: input.maxPages,
    maxRows: input.maxRows,
    onProgress,
    fetchPage: ({ after, visitedCursors }) => adapter.fetchCreativesPage({
      adAccountId: sourceAccountId,
      after,
      visitedCursors,
    }),
  });
  const daily = await collectMetaPaidProviderPages({
    target,
    datasetKey: 'meta_ads.performance.daily',
    maxPages: input.maxPages,
    maxRows: input.maxRows,
    onProgress,
    fetchPage: ({ after, visitedCursors }) => adapter.fetchDailyInsightsPage({
      adAccountId: sourceAccountId,
      after,
      visitedCursors,
      since: META_PAID_PROVIDER_DIRECT_LARK_PERIOD.since,
      until: META_PAID_PROVIDER_DIRECT_LARK_PERIOD.until,
    }),
  });

  const operationSuffix = (await createStableFingerprint({
    schemaVersion: META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION,
    repositoryHead,
    target,
    sourceAccountId,
    period: META_PAID_PROVIDER_DIRECT_LARK_PERIOD,
  })).slice(0, 12);
  const operationId = [
    `meta-${target}-provider-direct`,
    META_PAID_PROVIDER_DIRECT_LARK_PERIOD.since.replaceAll('-', ''),
    META_PAID_PROVIDER_DIRECT_LARK_PERIOD.until.replaceAll('-', ''),
    operationSuffix,
  ].join('-');

  return deepFreeze({
    target,
    sourceAccountId,
    repositoryHead,
    operationId,
    workKey: `meta_ads:${target}:${operationId}`,
    requestedAt,
    accountResource,
    creatives: creatives.rows,
    dailyInsights: daily.rows,
    sourceSummary: {
      accountRows: 1,
      creativePages: creatives.pages,
      creativeRows: creatives.rows.length,
      dailyPages: daily.pages,
      dailyRows: daily.rows.length,
      period: { ...META_PAID_PROVIDER_DIRECT_LARK_PERIOD },
    },
  });
}

export async function collectMetaPaidProviderPages(input = {}) {
  const target = requireTarget(input.target);
  const datasetKey = requireDatasetKey(input.datasetKey);
  const fetchPage = requireFunction(input.fetchPage, 'fetchPage');
  const maxPages = boundedInteger(
    input.maxPages ?? META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES,
    'maxPages',
    1,
    META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES,
  );
  const maxRows = boundedInteger(
    input.maxRows ?? META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET,
    'maxRows',
    1,
    META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET,
  );
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const rows = [];
  const visitedCursors = [];
  let after = null;

  for (let page = 1; page <= maxPages; page += 1) {
    onProgress({ target, datasetKey, page, rows: rows.length, stage: 'provider-read-start' });
    const envelope = requireObject(
      await fetchPage({ after, visitedCursors: [...visitedCursors], page }),
      `${datasetKey} page`,
    );
    const pageRows = requireArray(envelope.rows, `${datasetKey}.rows`);
    rows.push(...pageRows);
    if (rows.length > maxRows) {
      throw providerError(
        'Paid Meta provider dataset exceeded the recovery row ceiling',
        'META_PAID_PROVIDER_DIRECT_LARK_ROW_LIMIT',
        { target, datasetKey, maxRows, observedRows: rows.length },
      );
    }
    onProgress({
      target,
      datasetKey,
      page,
      pageRows: pageRows.length,
      rows: rows.length,
      hasMore: envelope.hasMore === true,
      stage: 'provider-read-page',
    });
    if (envelope.hasMore !== true) {
      return deepFreeze({ pages: page, rows });
    }
    const nextCursor = requireText(envelope.nextCursor, `${datasetKey}.nextCursor`);
    if (nextCursor === after || visitedCursors.includes(nextCursor)) {
      throw providerError(
        'Paid Meta provider pagination repeated a cursor',
        'META_PAID_PROVIDER_DIRECT_LARK_CURSOR_REPEATED',
        { target, datasetKey, page },
      );
    }
    if (page === maxPages) {
      throw providerError(
        'Paid Meta provider dataset exceeded the isolated recovery page ceiling',
        'META_PAID_PROVIDER_DIRECT_LARK_PAGE_LIMIT',
        { target, datasetKey, maxPages, observedRows: rows.length },
      );
    }
    if (after) visitedCursors.push(after);
    after = nextCursor;
  }

  throw providerError(
    'Paid Meta provider pagination ended unexpectedly',
    'META_PAID_PROVIDER_DIRECT_LARK_PAGE_LIMIT',
    { target, datasetKey, maxPages },
  );
}

export async function buildMetaPaidProviderLarkWriteSet(sourceInput) {
  const source = requireObject(sourceInput, 'source');
  const target = requireTarget(source.target);
  const sourceAccountId = normalizeAdAccountId(source.sourceAccountId);
  const accountResource = requireObject(source.accountResource, 'source.accountResource');
  const operationId = requireText(source.operationId, 'source.operationId');
  const requestedAt = requireTimestamp(source.requestedAt, 'source.requestedAt');

  const writeSet = await buildMetaAdsWriteSet({
    accountId: sourceAccountId,
    accountKey: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: `meta:meta_ads:${target}:${operationId}`,
    operationId,
    fetchedAt: requestedAt,
    completedAt: requestedAt,
    sourceRevision: operationId,
    accountTimezone: requireText(accountResource.timezone_name, 'Meta Ads account timezone_name'),
    currency: requireText(accountResource.currency, 'Meta Ads account currency'),
    sourceWatermark: null,
    entityScopeMode: 'report_range',
    larkProjectionMode: 'curated_reports',
    periodStart: META_PAID_PROVIDER_DIRECT_LARK_PERIOD.since,
    periodEnd: META_PAID_PROVIDER_DIRECT_LARK_PERIOD.until,
    accountResource,
    campaigns: [],
    adSets: [],
    ads: [],
    creatives: requireArray(source.creatives, 'source.creatives'),
    dailyInsights: requireArray(source.dailyInsights, 'source.dailyInsights'),
  });

  const observedKeys = EXACT_LARK_CONTRACTS.map((contract) => contract.tableKey);
  if (JSON.stringify(observedKeys) !== JSON.stringify(META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS)) {
    throw providerError(
      'Paid Meta provider direct Lark contracts escaped the exact two-table scope',
      'META_PAID_PROVIDER_DIRECT_LARK_SCOPE_INVALID',
      { observedTableKeys: observedKeys },
    );
  }
  return writeSet;
}

export async function planMetaPaidProviderLarkTarget(input = {}) {
  const target = requireTarget(input.target);
  const writeSet = requireObject(input.writeSet, 'writeSet');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tables = requireObject(input.tables, 'tables');
  const items = [];

  for (const contract of EXACT_LARK_CONTRACTS) {
    const rows = projectRowsForLarkContract(readPath(writeSet, contract.path), contract.tableKey);
    const tableId = requireText(tables[contract.tableKey], `tables.${contract.tableKey}`);
    const plan = await syncEngine.planByKey({
      repository,
      tableId,
      keyField: contract.keyField,
      rows,
    });
    const duplicateInputRows = nonNegativeInteger(
      plan?.duplicateInputRows ?? 0,
      `${contract.tableKey}.duplicateInputRows`,
    );
    if (duplicateInputRows !== 0) {
      throw providerError(
        'Paid Meta provider direct Lark input contains duplicate stable keys',
        'META_PAID_PROVIDER_DIRECT_LARK_DUPLICATE',
        { target, tableKey: contract.tableKey, duplicateInputRows },
      );
    }
    items.push({
      tableKey: contract.tableKey,
      keyField: contract.keyField,
      expected: rows.length,
      plan,
    });
  }
  return Object.freeze({ target, items: Object.freeze(items) });
}

export async function executeMetaPaidProviderLarkPlan(input = {}) {
  const planned = requireObject(input.planned, 'planned');
  const target = requireTarget(planned.target);
  const syncEngine = requireMethods(input.syncEngine, ['executePlan'], 'syncEngine');
  const beforeWriteChunk = typeof input.beforeWriteChunk === 'function'
    ? input.beforeWriteChunk
    : async () => undefined;
  const results = [];

  for (const item of requireArray(planned.items, 'planned.items')) {
    const result = await syncEngine.executePlan(item.plan, { beforeWriteChunk });
    results.push(normalizeLarkResult({ target, item, result }));
  }
  return Object.freeze(results);
}

export function validateMetaPaidProviderLarkResults(resultsInput, options = {}) {
  const results = requireArray(resultsInput, 'results');
  const observedTableKeys = results.map((entry) => entry?.tableKey ?? null);
  if (JSON.stringify(observedTableKeys) !== JSON.stringify(META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS)) {
    throw providerError(
      'Paid Meta provider direct Lark result escaped the exact two-table scope',
      'META_PAID_PROVIDER_DIRECT_LARK_SCOPE_INVALID',
      { observedTableKeys },
    );
  }
  for (const entry of results) {
    const expected = nonNegativeInteger(entry.expected, 'result.expected');
    const created = nonNegativeInteger(entry.created, 'result.created');
    const updated = nonNegativeInteger(entry.updated, 'result.updated');
    const skipped = nonNegativeInteger(entry.skipped, 'result.skipped');
    if (created + updated + skipped !== expected || entry.duplicateInputRows !== 0) {
      throw providerError(
        'Paid Meta provider direct Lark reconciliation is incomplete',
        'META_PAID_PROVIDER_DIRECT_LARK_RECONCILIATION_INVALID',
        { tableKey: entry.tableKey, expected, created, updated, skipped },
      );
    }
    if (options.idempotent === true && (created !== 0 || updated !== 0 || skipped !== expected)) {
      throw providerError(
        'Paid Meta provider direct Lark replay was not idempotent',
        'META_PAID_PROVIDER_DIRECT_LARK_IDEMPOTENCY_INVALID',
        { tableKey: entry.tableKey, expected, created, updated, skipped },
      );
    }
  }
  return true;
}

export function summarizeMetaPaidProviderSource(sourceInput) {
  const source = requireObject(sourceInput, 'source');
  return deepFreeze({
    target: requireTarget(source.target),
    operationId: requireText(source.operationId, 'source.operationId'),
    sourceAccountId: normalizeAdAccountId(source.sourceAccountId),
    sourceSummary: structuredClone(requireObject(source.sourceSummary, 'source.sourceSummary')),
  });
}

function normalizeLarkResult({ target, item, result }) {
  const expected = nonNegativeInteger(item.expected, `${item.tableKey}.expected`);
  const created = nonNegativeInteger(result?.created ?? 0, `${item.tableKey}.created`);
  const updated = nonNegativeInteger(result?.updated ?? 0, `${item.tableKey}.updated`);
  const skipped = nonNegativeInteger(result?.skipped ?? 0, `${item.tableKey}.skipped`);
  const duplicateInputRows = nonNegativeInteger(
    result?.duplicateInputRows ?? 0,
    `${item.tableKey}.duplicateInputRows`,
  );
  if (created + updated + skipped !== expected || duplicateInputRows !== 0) {
    throw providerError(
      'Paid Meta provider direct Lark execution did not reconcile the complete table payload',
      'META_PAID_PROVIDER_DIRECT_LARK_RECONCILIATION_INVALID',
      { target, tableKey: item.tableKey, expected, created, updated, skipped, duplicateInputRows },
    );
  }
  return Object.freeze({
    tableKey: item.tableKey,
    expected,
    created,
    updated,
    skipped,
    duplicateInputRows,
  });
}

function projectRowsForLarkContract(rows, tableKey) {
  if (tableKey !== 'mktAdsDaily') return rows;
  return projectMetaAdsDailyRowsForLark(rows);
}

function readPath(value, path) {
  let current = value;
  for (const segment of String(path).split('.')) current = current?.[segment];
  return requireArray(current, path);
}

function requireDatasetKey(value) {
  const key = requireText(value, 'datasetKey');
  if (!['meta_ads.creatives.inventory', 'meta_ads.performance.daily'].includes(key)) {
    throw new TypeError(`Unsupported paid Meta provider dataset: ${key}`);
  }
  return key;
}

function normalizeAdAccountId(value) {
  return requireText(value, 'sourceAccountId').replace(/^act_/iu, '');
}

function requireTarget(value) {
  const target = requireText(value, 'target');
  if (!META_PAID_PROVIDER_DIRECT_LARK_TARGETS.includes(target)) {
    throw providerError(
      'Paid Meta provider direct Lark target is invalid',
      'META_PAID_PROVIDER_DIRECT_LARK_TARGET_INVALID',
      { target },
    );
  }
  return target;
}

function requireSha(value) {
  const text = requireText(value, 'repositoryHead');
  if (!/^[0-9a-f]{40}$/u.test(text)) throw new TypeError('repositoryHead must be a full Git SHA');
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
  return number;
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return object;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`${fieldName} must be a function`);
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`${fieldName} is required`);
  }
  const text = String(value).trim();
  if (text === '') throw new TypeError(`${fieldName} is required`);
  return text;
}

function providerError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidProviderDirectLarkError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
