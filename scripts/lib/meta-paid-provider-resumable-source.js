import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';
import {
  META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION,
  META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES,
  META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET,
  META_PAID_PROVIDER_DIRECT_LARK_PERIOD,
  META_PAID_PROVIDER_DIRECT_LARK_TARGETS,
} from './meta-paid-provider-direct-lark-materializer.js';

export const META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION =
  'meta_paid_provider_resumable_source_v1';
export const META_PAID_PROVIDER_RECOVERY_PAGE_SIZE = 500;

const DATASETS = Object.freeze([
  'meta_ads.creatives.inventory',
  'meta_ads.performance.daily',
]);

export async function collectMetaPaidProviderResumableSource(input = {}) {
  const target = requireTarget(input.target);
  const sourceAccountId = normalizeAdAccountId(input.sourceAccountId);
  const repositoryHead = requireSha(input.repositoryHead);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const adapter = requireMethods(input.adapter, [
    'fetchAccount',
    'fetchCreativesPage',
    'fetchDailyInsightsPage',
  ], 'adapter');
  const checkpointRoot = resolve(requireText(input.checkpointRoot, 'checkpointRoot'));
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  await mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  await chmod(checkpointRoot, 0o700);

  const accountResource = await loadOrFetchAccount({
    checkpointRoot,
    target,
    sourceAccountId,
    repositoryHead,
    adapter,
    onProgress,
  });

  const creatives = await collectMetaPaidProviderResumablePages({
    checkpointRoot,
    target,
    sourceAccountId,
    repositoryHead,
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

  const daily = await collectMetaPaidProviderResumablePages({
    checkpointRoot,
    target,
    sourceAccountId,
    repositoryHead,
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
      creativeResumedFromPages: creatives.resumedFromPages,
      dailyPages: daily.pages,
      dailyRows: daily.rows.length,
      dailyResumedFromPages: daily.resumedFromPages,
      period: { ...META_PAID_PROVIDER_DIRECT_LARK_PERIOD },
      checkpointContractVersion: META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION,
    },
  });
}

export async function collectMetaPaidProviderResumablePages(input = {}) {
  const checkpointRoot = resolve(requireText(input.checkpointRoot, 'checkpointRoot'));
  const target = requireTarget(input.target);
  const sourceAccountId = normalizeAdAccountId(input.sourceAccountId);
  const repositoryHead = requireSha(input.repositoryHead);
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
  const datasetDir = join(checkpointRoot, target, datasetSlug(datasetKey));
  const pagesDir = join(datasetDir, 'pages');
  await mkdir(pagesDir, { recursive: true, mode: 0o700 });
  await chmod(datasetDir, 0o700);
  await chmod(pagesDir, 0o700);

  const statePath = join(datasetDir, 'state.json');
  const state = await readState(statePath, {
    target,
    sourceAccountId,
    repositoryHead,
    datasetKey,
  });
  const resumedFromPages = state.pagesCompleted;
  const rows = await loadCheckpointRows({
    pagesDir,
    state,
    target,
    datasetKey,
    maxRows,
  });

  if (state.completed === true) {
    onProgress({
      target,
      datasetKey,
      page: state.pagesCompleted,
      rows: rows.length,
      hasMore: false,
      resumedFromPages,
      stage: 'provider-checkpoint-complete',
    });
    return deepFreeze({ pages: state.pagesCompleted, rows, resumedFromPages });
  }

  let after = state.nextCursor;
  let visitedCursors = [...state.visitedCursors];

  for (let page = state.pagesCompleted + 1; page <= maxPages; page += 1) {
    onProgress({
      target,
      datasetKey,
      page,
      rows: rows.length,
      resumedFromPages,
      stage: 'provider-read-start',
    });

    let envelope;
    try {
      envelope = requireObject(
        await fetchPage({ after, visitedCursors: [...visitedCursors], page }),
        `${datasetKey} page`,
      );
    } catch (error) {
      if (isMetaAdsBusinessUseCaseRateLimit(error)) {
        throw resumableError(
          'Paid Meta provider rate limit reached; checkpoint is safe to resume without replaying completed pages',
          'META_PAID_PROVIDER_RATE_LIMIT_RESUMABLE',
          {
            target,
            datasetKey,
            pagesCompleted: state.pagesCompleted,
            rowCount: rows.length,
            resumeAvailable: true,
            graphCode: 80004,
            graphSubcode: 2446079,
          },
        );
      }
      throw error;
    }

    const pageRows = requireArray(envelope.rows, `${datasetKey}.rows`);
    const nextRowCount = rows.length + pageRows.length;
    if (nextRowCount > maxRows) {
      throw resumableError(
        'Paid Meta provider dataset exceeded the recovery row ceiling',
        'META_PAID_PROVIDER_DIRECT_LARK_ROW_LIMIT',
        { target, datasetKey, maxRows, observedRows: nextRowCount },
      );
    }

    const hasMore = envelope.hasMore === true;
    const nextCursor = hasMore
      ? requireText(envelope.nextCursor, `${datasetKey}.nextCursor`)
      : null;
    if (nextCursor && (nextCursor === after || visitedCursors.includes(nextCursor))) {
      throw resumableError(
        'Paid Meta provider pagination repeated a cursor',
        'META_PAID_PROVIDER_DIRECT_LARK_CURSOR_REPEATED',
        { target, datasetKey, page },
      );
    }
    if (hasMore && page === maxPages) {
      throw resumableError(
        'Paid Meta provider dataset exceeded the isolated recovery page ceiling',
        'META_PAID_PROVIDER_DIRECT_LARK_PAGE_LIMIT',
        { target, datasetKey, maxPages, observedRows: nextRowCount },
      );
    }

    await writePrivateJsonAtomic(join(pagesDir, pageFileName(page)), {
      contractVersion: META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION,
      target,
      datasetKey,
      page,
      rows: pageRows,
    });

    rows.push(...pageRows);
    if (after) visitedCursors.push(after);
    after = nextCursor;

    const nextState = createState({
      target,
      sourceAccountId,
      repositoryHead,
      datasetKey,
      pagesCompleted: page,
      rowCount: rows.length,
      completed: !hasMore,
      nextCursor: hasMore ? nextCursor : null,
      visitedCursors,
    });
    await writePrivateJsonAtomic(statePath, nextState);
    Object.assign(state, nextState);

    onProgress({
      target,
      datasetKey,
      page,
      pageRows: pageRows.length,
      rows: rows.length,
      hasMore,
      resumedFromPages,
      stage: 'provider-read-page',
    });

    if (!hasMore) {
      return deepFreeze({ pages: page, rows, resumedFromPages });
    }
  }

  throw resumableError(
    'Paid Meta provider pagination ended unexpectedly',
    'META_PAID_PROVIDER_DIRECT_LARK_PAGE_LIMIT',
    { target, datasetKey, maxPages },
  );
}

export function isMetaAdsBusinessUseCaseRateLimit(error) {
  return Number(error?.details?.graphCode) === 80004
    && Number(error?.details?.graphSubcode) === 2446079;
}

async function loadOrFetchAccount(input) {
  const targetDir = join(input.checkpointRoot, input.target);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  await chmod(targetDir, 0o700);
  const accountPath = join(targetDir, 'account.json');
  const existing = await readOptionalJson(accountPath);
  if (existing) {
    validateCheckpointIdentity(existing, {
      target: input.target,
      sourceAccountId: input.sourceAccountId,
      repositoryHead: input.repositoryHead,
      datasetKey: 'meta_ads.account.latest',
    });
    const resource = requireObject(existing.resource, 'checkpoint account resource');
    assertObservedAccountId(resource, input.sourceAccountId, input.target);
    input.onProgress({
      target: input.target,
      datasetKey: 'meta_ads.account.latest',
      page: 1,
      rows: 1,
      stage: 'provider-checkpoint-complete',
    });
    return deepFreeze(resource);
  }

  input.onProgress({
    target: input.target,
    datasetKey: 'meta_ads.account.latest',
    page: 1,
    stage: 'provider-read-start',
  });
  let envelope;
  try {
    envelope = await input.adapter.fetchAccount({ adAccountId: input.sourceAccountId });
  } catch (error) {
    if (isMetaAdsBusinessUseCaseRateLimit(error)) {
      throw resumableError(
        'Paid Meta provider rate limit reached before account checkpoint completed',
        'META_PAID_PROVIDER_RATE_LIMIT_RESUMABLE',
        {
          target: input.target,
          datasetKey: 'meta_ads.account.latest',
          pagesCompleted: 0,
          rowCount: 0,
          resumeAvailable: true,
          graphCode: 80004,
          graphSubcode: 2446079,
        },
      );
    }
    throw error;
  }
  const resource = requireObject(envelope?.resource, 'Meta Ads account resource');
  assertObservedAccountId(resource, input.sourceAccountId, input.target);
  await writePrivateJsonAtomic(accountPath, {
    contractVersion: META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION,
    repositoryHead: input.repositoryHead,
    target: input.target,
    sourceAccountId: input.sourceAccountId,
    datasetKey: 'meta_ads.account.latest',
    resource,
  });
  input.onProgress({
    target: input.target,
    datasetKey: 'meta_ads.account.latest',
    page: 1,
    rows: 1,
    stage: 'provider-read-page',
  });
  return deepFreeze(resource);
}

function assertObservedAccountId(resource, expected, target) {
  const observed = normalizeAdAccountId(resource.account_id ?? resource.id);
  if (observed !== expected) {
    throw resumableError(
      'Meta Ads provider account identity differs from the reviewed target mapping',
      'META_PAID_PROVIDER_DIRECT_LARK_ACCOUNT_IDENTITY_MISMATCH',
      { target },
    );
  }
}

async function readState(path, identity) {
  const existing = await readOptionalJson(path);
  if (!existing) return createState({
    ...identity,
    pagesCompleted: 0,
    rowCount: 0,
    completed: false,
    nextCursor: null,
    visitedCursors: [],
  });
  validateCheckpointIdentity(existing, identity);
  const pagesCompleted = boundedInteger(existing.pagesCompleted, 'pagesCompleted', 0, META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES);
  const rowCount = boundedInteger(existing.rowCount, 'rowCount', 0, META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET);
  const completed = existing.completed === true;
  const nextCursor = completed ? null : optionalText(existing.nextCursor);
  const visitedCursors = requireArray(existing.visitedCursors, 'visitedCursors')
    .map((cursor) => requireText(cursor, 'visitedCursor'));
  if (!completed && pagesCompleted > 0 && !nextCursor) {
    throw checkpointInvalid('Incomplete paid Meta checkpoint is missing its resume cursor', identity);
  }
  return createState({
    ...identity,
    pagesCompleted,
    rowCount,
    completed,
    nextCursor,
    visitedCursors,
  });
}

async function loadCheckpointRows({ pagesDir, state, target, datasetKey, maxRows }) {
  const rows = [];
  for (let page = 1; page <= state.pagesCompleted; page += 1) {
    const value = await readOptionalJson(join(pagesDir, pageFileName(page)));
    if (!value) throw checkpointInvalid('Paid Meta checkpoint page is missing', { target, datasetKey, page });
    if (value.contractVersion !== META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION
      || value.target !== target || value.datasetKey !== datasetKey || Number(value.page) !== page) {
      throw checkpointInvalid('Paid Meta checkpoint page identity mismatch', { target, datasetKey, page });
    }
    rows.push(...requireArray(value.rows, 'checkpoint.rows'));
    if (rows.length > maxRows) {
      throw checkpointInvalid('Paid Meta checkpoint rows exceed recovery ceiling', { target, datasetKey });
    }
  }
  if (rows.length !== state.rowCount) {
    throw checkpointInvalid('Paid Meta checkpoint row count does not reconcile', {
      target,
      datasetKey,
      expected: state.rowCount,
      observed: rows.length,
    });
  }
  return rows;
}

function createState(input) {
  return {
    contractVersion: META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION,
    repositoryHead: input.repositoryHead,
    target: input.target,
    sourceAccountId: input.sourceAccountId,
    datasetKey: input.datasetKey,
    period: { ...META_PAID_PROVIDER_DIRECT_LARK_PERIOD },
    pagesCompleted: input.pagesCompleted,
    rowCount: input.rowCount,
    completed: input.completed === true,
    nextCursor: input.nextCursor ?? null,
    visitedCursors: [...(input.visitedCursors ?? [])],
  };
}

function validateCheckpointIdentity(value, expected) {
  if (value.contractVersion !== META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION
    || value.repositoryHead !== expected.repositoryHead
    || value.target !== expected.target
    || normalizeAdAccountId(value.sourceAccountId) !== expected.sourceAccountId
    || value.datasetKey !== expected.datasetKey) {
    throw checkpointInvalid('Paid Meta checkpoint identity does not match this reviewed recovery', expected);
  }
  if (expected.datasetKey !== 'meta_ads.account.latest') {
    const period = requireObject(value.period, 'checkpoint.period');
    if (period.since !== META_PAID_PROVIDER_DIRECT_LARK_PERIOD.since
      || period.until !== META_PAID_PROVIDER_DIRECT_LARK_PERIOD.until) {
      throw checkpointInvalid('Paid Meta checkpoint period does not match July recovery', expected);
    }
  }
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw checkpointInvalid('Paid Meta checkpoint JSON is invalid', { path: 'private-checkpoint' });
    }
    throw error;
  }
}

async function writePrivateJsonAtomic(path, value) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

function pageFileName(page) {
  return `page-${String(page).padStart(6, '0')}.json`;
}

function datasetSlug(datasetKey) {
  return datasetKey.replaceAll('.', '-').replaceAll('_', '-');
}

function requireDatasetKey(value) {
  const key = requireText(value, 'datasetKey');
  if (!DATASETS.includes(key)) throw new TypeError(`Unsupported paid Meta provider dataset: ${key}`);
  return key;
}

function requireTarget(value) {
  const target = requireText(value, 'target');
  if (!META_PAID_PROVIDER_DIRECT_LARK_TARGETS.includes(target)) {
    throw resumableError('Paid Meta provider target is invalid', 'META_PAID_PROVIDER_DIRECT_LARK_TARGET_INVALID', { target });
  }
  return target;
}

function normalizeAdAccountId(value) {
  const normalized = requireText(value, 'sourceAccountId').replace(/^act_/iu, '');
  if (!/^\d+$/u.test(normalized)) throw new TypeError('sourceAccountId must be numeric');
  return normalized;
}

function requireSha(value) {
  const text = requireText(value, 'repositoryHead');
  if (!/^[0-9a-f]{40}$/u.test(text)) throw new TypeError('repositoryHead must be a full SHA');
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive timestamp`);
  return number;
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${fieldName} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} must be non-empty text`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'optionalText');
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`${fieldName} must be a function`);
  return value;
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} must be a function`);
  }
  return object;
}

function checkpointInvalid(message, details) {
  return resumableError(message, 'META_PAID_PROVIDER_CHECKPOINT_INVALID', details);
}

function resumableError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidProviderResumableSourceError';
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
